/** PTY session bridge for the standalone desktop Terminal page.
 *
 *  Electron main spawns one `tanwords-pty` daemon per terminal session and
 *  speaks its framed stdio protocol (see app/core/src/bin/tanwords-pty.rs):
 *
 *    daemon → main   `H` handshake · `D` output · `X` exit
 *    main → daemon   `I` input · `R` resize · `C` close
 *
 *  Frame layout, both directions: `[opcode: u8][len u32 LE][payload…]`. `I`/`D`
 *  payloads are raw bytes; `R` is four `u32 LE` values (cols, rows and the
 *  logical-pixel viewport width/height).
 *
 *  The renderer never talks to this daemon directly — the window is sandboxed
 *  (contextIsolation + sandbox), and the daemon speaks stdio, not HTTP. So main
 *  is the middle layer: it keeps each child alive, forwards keyboard input down
 *  and terminal output/exit up, and tears a session down on close so no shell
 *  ever lingers. */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

type SessionSink = (event: string, payload: unknown) => void;

interface PtySession {
  id: string;
  child: ChildProcessWithoutNullStreams;
  dec: Decoder;
  ready: Promise<{ shell: string; cwd: string; pid: number }>;
  resolveReady: (v: { shell: string; cwd: string; pid: number }) => void;
  rejectReady: (reason: Error) => void;
  readySettled: boolean;
  closing: boolean;
  exitEmitted: boolean;
  readyTimer: ReturnType<typeof setTimeout> | null;
  outputBackpressured: boolean;
  stdoutPaused: boolean;
}

const HANDSHAKE_TIMEOUT_MS = 5_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_INPUT_BASE64_CHARS = 2 * 1024 * 1024;
const MAX_PTY_DIMENSION = 65_535;
// A TanWords PTY is a new terminal boundary, not a child pane of whichever
// terminal happened to launch Electron during development. Leaking these
// markers makes capability-driven apps (notably Yazi) select Apple Terminal,
// tmux, Kitty, etc. and emit the wrong graphics protocol.
const INHERITED_TERMINAL_MARKERS = [
  "ITERM_SESSION_ID",
  "KITTY_LISTEN_ON",
  "KITTY_PUBLIC_KEY",
  "KITTY_WINDOW_ID",
  "KONSOLE_DBUS_SERVICE",
  "KONSOLE_DBUS_SESSION",
  "KONSOLE_VERSION",
  "LC_TERMINAL",
  "LC_TERMINAL_VERSION",
  "STY",
  "TABBY_CONFIG_DIRECTORY",
  "TERM_SESSION_ID",
  "TMUX",
  "TMUX_PANE",
  "VSCODE_INJECTION",
  "WARP_HONOR_PS1",
  "WEZTERM_EXECUTABLE",
  "WEZTERM_PANE",
  "WT_PROFILE_ID",
  "WT_SESSION",
  "WT_Session",
  "ZELLIJ",
  "ZELLIJ_PANE_ID",
  "ZELLIJ_SESSION_NAME",
  "GHOSTTY_RESOURCES_DIR",
] as const;
const sessions = new Map<string, PtySession>();
let nextId = 1;
let sink: SessionSink | null = null;
let outputPaused = false;

export function setTerminalEventSink(fn: SessionSink) {
  sink = fn;
}

function emit(event: string, payload: unknown) {
  sink?.(event, payload);
}

function binaryName(): string {
  return process.platform === "win32" ? "tanwords-pty.exe" : "tanwords-pty";
}

/** Resolve the PTY daemon binary. Packaged builds ship it via `extraResources`
 *  (core/tanwords-pty); dev/CI use whichever of `core/target/{release,debug}`
 *  was built. Mirrors sidecar.ts: prefer the *newer* build, release winning a
 *  tie, so `bun run dev` (debug) and `bun run package` (release) both behave. */
function resolvePtyBinary(): string {
  const name = binaryName();
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "core", name);
  }
  const coreDir = path.join(app.getAppPath(), "core");
  const release = path.join(coreDir, "target", "release", name);
  const debug = path.join(coreDir, "target", "debug", name);
  const mtime = (p: string): number => {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return -1;
    }
  };
  const r = mtime(release);
  const d = mtime(debug);
  if (r < 0 && d < 0) return debug;
  return r >= d ? release : debug;
}

/** Incremental frame decoder: feed stdout, get whole `[op, payload]` frames. */
class Decoder {
  private buf = Buffer.alloc(0);
  /** Drain as many complete frames as are buffered. */
  ingest(chunk: Buffer): Array<{ op: number; payload: Buffer }> {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: Array<{ op: number; payload: Buffer }> = [];
    for (;;) {
      if (this.buf.length < 5) break;
      const op = this.buf[0];
      const len = this.buf.readUInt32LE(1);
      if (len > MAX_FRAME_BYTES) {
        throw new Error(`[terminal] daemon frame exceeds ${MAX_FRAME_BYTES} bytes`);
      }
      if (this.buf.length < 5 + len) break;
      out.push({ op, payload: this.buf.subarray(5, 5 + len) });
      this.buf = this.buf.subarray(5 + len);
    }
    return out;
  }
}

function settleReadyError(session: PtySession, error: Error) {
  if (session.readySettled) return;
  session.readySettled = true;
  if (session.readyTimer) clearTimeout(session.readyTimer);
  session.readyTimer = null;
  session.rejectReady(error);
}

/** End one unexpectedly broken session exactly once. A renderer only learns an
 * id after the handshake, so pre-handshake failures reject `terminalSpawn`
 * instead of also emitting an unusable exit event. */
function failSession(session: PtySession, error: Error, code = 1) {
  if (session.closing) return;
  const rendererKnowsSession = session.readySettled;
  settleReadyError(session, error);
  session.closing = true;
  sessions.delete(session.id);
  if (rendererKnowsSession && !session.exitEmitted) {
    session.exitEmitted = true;
    emit("pty:exit", { id: session.id, code, error: error.message });
  }
  if (!session.child.killed) session.child.kill();
}

function writeSessionFrame(session: PtySession, frame: Buffer) {
  if (session.closing || session.child.stdin.destroyed) return;
  try {
    session.child.stdin.write(frame);
  } catch (error) {
    failSession(session, error instanceof Error ? error : new Error(String(error)));
  }
}

/** Keep global window suspension and per-terminal renderer backpressure from
 * fighting over the same Readable. Node's pause/resume calls are idempotent,
 * but tracking the state avoids needless stream churn during rapid drains. */
function syncSessionOutputPause(session: PtySession) {
  const paused = outputPaused || session.outputBackpressured;
  if (paused === session.stdoutPaused) return;
  session.stdoutPaused = paused;
  if (paused) session.child.stdout.pause();
  else session.child.stdout.resume();
}

function clampPtyDimension(value: number, minimum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(MAX_PTY_DIMENSION, Math.max(minimum, Math.floor(value)));
}

function terminalEnvironment(
  cols: number,
  rows: number,
  pixelWidth: number,
  pixelHeight: number,
  shellPath: string,
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const marker of INHERITED_TERMINAL_MARKERS) delete env[marker];
  // A GUI launch (Finder/Dock/LaunchServices) never sources the shell profile
  // that normally sets LANG, so Electron's own env is usually locale-less.
  // Without a UTF-8 locale, readline/ncurses-based programs in the shell can
  // fall back to single-byte decoding and mangle any multi-byte text they
  // handle internally (including their own clipboard yank/copy).
  const hasUtf8Locale = /\.UTF-8$/i.test(env.LC_ALL ?? "") || /\.UTF-8$/i.test(env.LANG ?? "");
  return {
    ...env,
    ...(hasUtf8Locale ? {} : { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" }),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "TanWords",
    TERM_PROGRAM_VERSION: app.getVersion(),
    PTY_COLS: String(cols),
    PTY_ROWS: String(rows),
    PTY_PIXEL_WIDTH: String(pixelWidth),
    PTY_PIXEL_HEIGHT: String(pixelHeight),
    ...(shellPath ? { PTY_SHELL: shellPath } : {}),
  };
}

/** Encode one outbound frame: `[op][len u32 LE][payload]`. */
function encodeFrame(op: number, payload: Buffer): Buffer {
  const h = Buffer.alloc(5);
  h[0] = op;
  h.writeUInt32LE(payload.length, 1);
  return Buffer.concat([h, payload]);
}

export type TerminalSessionInfo = { id: string; shell: string; cwd: string; pid: number };

/** Ask the PTY helper which shell it would launch without an override. The
 * helper owns that platform policy (including Git Bash discovery on Windows),
 * so the value shown in Settings cannot drift from the actual terminal. */
export function terminalDefaultShell(): string {
  const bin = resolvePtyBinary();
  if (!fs.existsSync(bin)) return "";
  const result = spawnSync(bin, ["--print-default-shell"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3_000,
  });
  if (result.status !== 0 || result.error) return "";
  const shell = result.stdout.trim();
  return /[\u0000-\u001f\u007f]/.test(shell) ? "" : shell.slice(0, 2048);
}

/** Spawn a fresh shell session. Resolves only once the daemon's `H` handshake
 *  has landed, so callers (and the renderer) know the shell is ready to type
 *  into. Throws if the daemon can't be found or dies before handshaking. */
export async function terminalSpawn(
  opts: {
    cols?: number;
    rows?: number;
    pixelWidth?: number;
    pixelHeight?: number;
    shellPath?: string;
  },
): Promise<TerminalSessionInfo> {
  const cols = clampPtyDimension(opts.cols ?? 80, 2);
  const rows = clampPtyDimension(opts.rows ?? 24, 1);
  const pixelWidth = clampPtyDimension(opts.pixelWidth ?? 0, 0);
  const pixelHeight = clampPtyDimension(opts.pixelHeight ?? 0, 0);
  const bin = resolvePtyBinary();
  if (!fs.existsSync(bin)) {
    throw new Error(
      `[terminal] daemon binary not found at ${bin} — run \`bun run core:build\` (or \`cargo build\` in app/core) first.`,
    );
  }

  const shellPath = typeof opts.shellPath === "string"
    ? opts.shellPath.replace(/\0/g, "").trim().slice(0, 2048)
    : "";
  if (shellPath && !fs.existsSync(shellPath)) {
    throw new Error(`[terminal] configured shell was not found at ${shellPath}`);
  }

  const child = spawn(bin, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: terminalEnvironment(cols, rows, pixelWidth, pixelHeight, shellPath),
  });

  const id = String(nextId++);
  let resolveReady!: (v: { shell: string; cwd: string; pid: number }) => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<{ shell: string; cwd: string; pid: number }>((res, reject) => {
    resolveReady = res;
    rejectReady = reject;
  });

  const session: PtySession = {
    id,
    child,
    dec: new Decoder(),
    ready,
    resolveReady,
    rejectReady,
    readySettled: false,
    closing: false,
    exitEmitted: false,
    readyTimer: null,
    outputBackpressured: false,
    stdoutPaused: false,
  };
  sessions.set(id, session);

  session.readyTimer = setTimeout(() => {
    failSession(session, new Error(`[terminal] PTY did not become ready within ${HANDSHAKE_TIMEOUT_MS}ms`));
  }, HANDSHAKE_TIMEOUT_MS);
  session.readyTimer.unref?.();

  child.stdout.on("data", (d: Buffer) => {
    try {
      for (const f of session.dec.ingest(d)) {
        handleDaemonFrame(session, f.op, f.payload);
      }
    } catch (error) {
      failSession(session, error instanceof Error ? error : new Error(String(error)));
    }
  });
  syncSessionOutputPause(session);

  // Every piped stream needs an error listener. In particular, writing after a
  // helper crash can raise EPIPE on stdin; without this listener Node treats it
  // as an uncaught EventEmitter error and can terminate Electron main.
  child.stdin.on("error", (error) => failSession(session, error));
  child.stdout.on("error", (error) => failSession(session, error));
  // Drain diagnostics so a full stderr pipe cannot deadlock the helper. The
  // helper writes here only on protocol/startup failures, so retain a bounded
  // excerpt in logs rather than reflecting it into the terminal stream.
  child.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8", 0, 4096).trim();
    if (message) console.error("[terminal] daemon stderr:", message);
  });
  child.stderr.on("error", (error) => {
    if (!session.closing) console.error("[terminal] daemon stderr error:", error);
  });

  child.on("close", (code, signal) => {
    if (session.closing) return;
    const suffix = signal ? ` (signal ${signal})` : code == null ? "" : ` (code ${code})`;
    failSession(session, new Error(`[terminal] PTY helper exited unexpectedly${suffix}`), code || 1);
  });
  child.on("error", (err) => {
    console.error("[terminal] daemon error:", err);
    failSession(session, err);
  });

  return { id, ...(await ready) };

  // --- local helpers bound to this session -------------------------------
  function handleDaemonFrame(s: PtySession, op: number, payload: Buffer) {
    if (op === 0x48) {
      // H — handshake JSON {shell,cwd,pid}.
      try {
        const j = JSON.parse(payload.toString("utf8")) as {
          shell?: string;
          cwd?: string;
          pid?: number;
        };
        if (!s.readySettled) {
          s.readySettled = true;
          if (s.readyTimer) clearTimeout(s.readyTimer);
          s.readyTimer = null;
          s.resolveReady({ shell: j.shell ?? "", cwd: j.cwd ?? "", pid: j.pid ?? 0 });
        }
      } catch (error) {
        failSession(
          s,
          new Error(`[terminal] invalid PTY handshake: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    } else if (op === 0x44) {
      // D — raw terminal output. Electron's structured clone transports typed
      // arrays directly, avoiding Base64 expansion and renderer-side decoding.
      if (!s.closing) {
        emit("pty:data", {
          id: s.id,
          data: new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
        });
      }
    } else if (op === 0x58) {
      // X — shell exited.
      if (!s.closing) {
        let code = 0;
        try {
          const value = JSON.parse(payload.toString("utf8")) as { code?: unknown };
          if (typeof value.code === "number" && Number.isFinite(value.code)) code = value.code;
        } catch {
          // An exit frame still means the helper shut down cleanly. Its optional
          // JSON only refines the shell's status code.
        }
        if (!s.readySettled) {
          failSession(s, new Error("[terminal] shell exited before the PTY was ready"), code || 1);
          return;
        }
        s.closing = true;
        if (!s.exitEmitted) {
          s.exitEmitted = true;
          emit("pty:exit", { id: s.id, code });
        }
        sessions.delete(s.id);
      }
    }
  }
}

/** Forward keyboard input (base64) to a session. */
export function terminalWrite(id: string, b64: string): void {
  const s = sessions.get(id);
  if (!s || s.closing) return;
  if (typeof b64 !== "string" || b64.length > MAX_INPUT_BASE64_CHARS) return;
  writeSessionFrame(s, encodeFrame(0x49, Buffer.from(b64, "base64")));
}

/** Tell the pty the viewport resized. */
export function terminalResize(
  id: string,
  cols: number,
  rows: number,
  pixelWidth = 0,
  pixelHeight = 0,
): void {
  const s = sessions.get(id);
  if (!s || s.closing) return;
  const p = Buffer.alloc(16);
  p.writeUInt32LE(clampPtyDimension(cols, 2), 0);
  p.writeUInt32LE(clampPtyDimension(rows, 1), 4);
  p.writeUInt32LE(clampPtyDimension(pixelWidth, 0), 8);
  p.writeUInt32LE(clampPtyDimension(pixelHeight, 0), 12);
  writeSessionFrame(s, encodeFrame(0x52, p));
}

/** Ask the daemon to kill the shell and wind down the session. */
export function terminalClose(id: string): void {
  const s = sessions.get(id);
  if (!s || s.closing) return;
  s.closing = true;
  if (s.readyTimer) clearTimeout(s.readyTimer);
  s.readyTimer = null;
  settleReadyError(s, new Error("[terminal] PTY session closed before it became ready"));
  try {
    s.child.stdin.write(encodeFrame(0x43, Buffer.alloc(0)));
  } catch {
    /* stdin already closed */
  }
  // Best-effort: the daemon reaps itself, but make sure a stubborn shell can't
  // survive us. `C` already kills the shell; calling kill() again is harmless.
  s.child.kill();
  sessions.delete(id);
}

/** Wipe every session — called on app quit so no shell is orphaned. */
export function terminalShutdownAll(): void {
  for (const id of [...sessions.keys()]) terminalClose(id);
}

/** Stop/resume reading helper stdout while Chromium cannot consume terminal
 * events. OS pipe pressure plus the helper's bounded queue then cap memory. */
export function terminalSetOutputPaused(paused: boolean): void {
  outputPaused = paused;
  for (const session of sessions.values()) syncSessionOutputPause(session);
}

/** Apply xterm's high/low-water flow control to one session. Pausing this pipe
 * propagates bounded pressure through the helper queue to the PTY while its
 * independent stdin reader remains available for Ctrl-C and other input. */
export function terminalSetOutputBackpressure(id: string, paused: boolean): void {
  const session = sessions.get(id);
  if (!session || session.closing || session.outputBackpressured === paused) return;
  session.outputBackpressured = paused;
  syncSessionOutputPause(session);
}
