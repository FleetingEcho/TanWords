/** PTY session bridge for the desktop Terminal tool (Tools page).
 *
 *  Electron main spawns one `tanwords-pty` daemon per terminal session and
 *  speaks its framed stdio protocol (see app/core/src/bin/tanwords-pty.rs):
 *
 *    daemon → main   `H` handshake · `D` output · `X` exit
 *    main → daemon   `I` input · `R` resize · `C` close
 *
 *  Frame layout, both directions: `[opcode: u8][len u32 LE][payload…]`. `I`/`D`
 *  payloads are raw bytes; `R` is two `u32 LE` (cols, rows).
 *
 *  The renderer never talks to this daemon directly — the window is sandboxed
 *  (contextIsolation + sandbox), and the daemon speaks stdio, not HTTP. So main
 *  is the middle layer: it keeps each child alive, forwards keyboard input down
 *  and terminal output/exit up, and tears a session down on close so no shell
 *  ever lingers. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
  closing: boolean;
}

const sessions = new Map<string, PtySession>();
let nextId = 1;
let sink: SessionSink | null = null;

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
  primitives: Array<{ op: number; payload: Buffer }> = [];
  /** Drain as many complete frames as are buffered. */
  ingest(chunk: Buffer): Array<{ op: number; payload: Buffer }> {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: Array<{ op: number; payload: Buffer }> = [];
    for (;;) {
      if (this.buf.length < 5) break;
      const op = this.buf[0];
      const len = this.buf.readUInt32LE(1);
      if (this.buf.length < 5 + len) break;
      out.push({ op, payload: this.buf.subarray(5, 5 + len) });
      this.buf = this.buf.subarray(5 + len);
    }
    return out;
  }
}

/** Encode one outbound frame: `[op][len u32 LE][payload]`. */
function encodeFrame(op: number, payload: Buffer): Buffer {
  const h = Buffer.alloc(5);
  h[0] = op;
  h.writeUInt32LE(payload.length, 1);
  return Buffer.concat([h, payload]);
}

export type TerminalSessionInfo = { id: string; shell: string; cwd: string; pid: number };

/** Spawn a fresh shell session. Resolves only once the daemon's `H` handshake
 *  has landed, so callers (and the renderer) know the shell is ready to type
 *  into. Throws if the daemon can't be found or dies before handshaking. */
export async function terminalSpawn(
  opts: { cols?: number; rows?: number },
): Promise<TerminalSessionInfo> {
  const cols = Math.max(2, Math.floor(opts.cols ?? 80));
  const rows = Math.max(1, Math.floor(opts.rows ?? 24));
  const bin = resolvePtyBinary();
  if (!fs.existsSync(bin)) {
    throw new Error(
      `[terminal] daemon binary not found at ${bin} — run \`bun run core:build\` (or \`cargo build\` in app/core) first.`,
    );
  }

  const child = spawn(bin, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PTY_COLS: String(cols), PTY_ROWS: String(rows) },
  });

  const id = String(nextId++);
  let resolveReady!: (v: { shell: string; cwd: string; pid: number }) => void;
  const ready = new Promise<{ shell: string; cwd: string; pid: number }>((res) => {
    resolveReady = res;
  });

  const session: PtySession = { id, child, dec: new Decoder(), ready, resolveReady, closing: false };
  sessions.set(id, session);

  child.stdout.on("data", (d: Buffer) => {
    for (const f of session.dec.ingest(d)) {
      handleDaemonFrame(session, f.op, f.payload);
    }
  });

  child.on("close", () => {
    if (sessions.has(id)) sessions.delete(id);
    if (!session.closing) {
      emit("pty:exit", { id, code: 0 });
    }
  });
  child.on("error", (err) => {
    console.error("[terminal] daemon error:", err);
    if (sessions.has(id)) sessions.delete(id);
    emit("pty:exit", { id, code: 1 });
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
        s.resolveReady({ shell: j.shell ?? "", cwd: j.cwd ?? "", pid: j.pid ?? 0 });
      } catch {
        s.resolveReady({ shell: "", cwd: "", pid: 0 });
      }
    } else if (op === 0x44) {
      // D — raw terminal output. Base64 for the sandboxed window.
      if (!s.closing) emit("pty:data", { id: s.id, data: payload.toString("base64") });
    } else if (op === 0x58) {
      // X — shell exited.
      if (!s.closing) {
        s.closing = true;
        emit("pty:exit", { id: s.id, code: 0 });
        sessions.delete(s.id);
      }
    }
  }
}

/** Forward keyboard input (base64) to a session. */
export function terminalWrite(id: string, b64: string): void {
  const s = sessions.get(id);
  if (!s || s.closing) return;
  s.child.stdin.write(encodeFrame(0x49, Buffer.from(b64, "base64")));
}

/** Tell the pty the viewport resized. */
export function terminalResize(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (!s || s.closing) return;
  const p = Buffer.alloc(8);
  p.writeUInt32LE(Math.max(2, Math.floor(cols)), 0);
  p.writeUInt32LE(Math.max(1, Math.floor(rows)), 4);
  s.child.stdin.write(encodeFrame(0x52, p));
}

/** Ask the daemon to kill the shell and wind down the session. */
export function terminalClose(id: string): void {
  const s = sessions.get(id);
  if (!s || s.closing) return;
  s.closing = true;
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