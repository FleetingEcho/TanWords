/** Supervises the DeepSeek Harness Web host (`dsh --profile web`): spawns it
 *  lazily on first request, parses the `dsh web: http://127.0.0.1:<port>`
 *  ready line it prints, and shuts it down (SIGTERM, then SIGKILL) on app
 *  quit.
 *
 *  Unlike the Rust `tanwords-core` sidecar, this is intentionally NOT started
 *  at app launch — the DSH host is a full Node/pnpm plugin runtime (heavier
 *  than the sidecar), so it is started on the user's first visit to the DSH
 *  page and kept alive for the rest of the session. A miss (`dsh` not on PATH)
 *  is reported as a status event rather than a crash, so the renderer can show
 *  a "DSH not installed" state.
 *
 *  The host is a long-lived HTTP/WS server bound to a loopback port. We pass
 *  `--port <n>`. The default is DSH's standard port (3080), which also acts as
 *  a single-writer rendezvous: if `dsh web` is already there, TanWords embeds
 *  that host instead of starting a second process against the same `~/.dsh`
 *  session logs. A non-zero value pins DSH to a custom fixed port. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import fs from "node:fs";

const READY_RE = /^dsh web: (https?:\/\/\S+)/;
const DEFAULT_DSH_WEB_PORT = 3080;
const HOST_PROBE_TIMEOUT_MS = 500;
/** Grace before SIGKILL. `dsh` runs its OWN bounded graceful shutdown on
 *  SIGTERM/SIGINT — `PROCESS_SHUTDOWN_TIMEOUT_MS = 5000` inside its
 *  `createProcessShutdown` — during which it flushes the session log. We must
 *  give that flush room to finish: a SIGKILL (or a *second* signal) before it
 *  completes truncates the session log mid-write, and the next launch reads a
 *  "corrupt session log: seq gap in committed region" error. 9s = dsh's 5s
 *  budget + a comfortable margin; SIGKILL after that is only a safety net for
 *  a truly wedged process. Critically, do NOT send a second SIGTERM — dsh
 *  treats a second signal during pending shutdown as "force-exit now", which
 *  is exactly the truncation we're avoiding. */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 9000;
/** How often to poll `session.list` while the host is up — cheap (loopback
 *  HTTP) and drives both the task-finished notification and the idle-stop
 *  timer below. */
const SESSION_POLL_INTERVAL_MS = 4000;

export type DshStatus = "starting" | "ready" | "failed";

/** Why the host failed — drives different renderer guidance.
 *  - `notInstalled`: `dsh` binary not on PATH → show install/upgrade guidance.
 *  - `portInUse`: the chosen port is already bound → show the port-fix modal.
 *  - `systemError`: the host crashed for an OS-level reason that changing the
 *    port cannot fix — EMFILE/ENOMEM (inotify/file-descriptor exhaustion),
 *    EACCES, a host that exited after briefly printing its ready line, etc.
 *    Show the real error inline with a Retry button; never the port-fix modal,
 *    which would mislead the user into "fixing" a port that isn't the problem.
 *  - `other`: unclassified failure → port-fix modal (preserves old behavior). */
export type DshFailKind = "notInstalled" | "portInUse" | "systemError" | "other";

export interface DshStatusEvent {
  status: DshStatus;
  /** The ready URL once status is "ready"; undefined otherwise. */
  url?: string;
  /** A human-readable reason when status is "failed". */
  reason?: string;
  /** Failure category when status is "failed". */
  kind?: DshFailKind;
}

/** Classify a failure reason into a `DshFailKind` so the renderer shows the
 *  right UI. A port error (`EADDRINUSE`, "address already in use", "port … in
 *  use") is the only case that warrants the port-fix modal; everything else —
 *  file-descriptor/inotify exhaustion (EMFILE/ENFILE), out-of-memory (ENOMEM),
 *  permission errors (EACCES/EPERM), or a host that died after briefly printing
 *  its ready line — is a system error the user cannot fix by changing the port,
 *  so it routes to the inline error + Retry panel instead of misleading them
 *  with the port-fix modal. */
function classifyFailKind(reason: string): DshFailKind {
  if (/EADDRINUSE|address already in use|port .* in use|in use\b/i.test(reason)) {
    return "portInUse";
  }
  if (/EMFILE|ENFILE|ENOMEM|EACCES|EPERM|too many open files|exhausted/i.test(reason)) {
    return "systemError";
  }
  return "other";
}

/** Executable locations a GUI-launched app cannot rely on macOS putting on
 *  PATH. Keep this list shared by launcher discovery and the spawned process:
 *  npm's `dsh` is a `#!/usr/bin/env node` script, so finding the launcher but
 *  then omitting the directory containing its Node runtime makes it exit 127. */
function executableSearchDirs(extra: string[] = []): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const platformDirs = process.platform === "win32"
    ? [process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : ""]
    : [
        home ? path.join(home, ".local", "bin") : "",
        home ? path.join(home, ".bun", "bin") : "",
        home ? path.join(home, ".volta", "bin") : "",
        ...(process.platform === "darwin" ? ["/opt/homebrew/bin"] : []),
        "/usr/local/bin",
        "/usr/bin",
      ];

  return [...new Set([
    ...extra,
    ...(process.env.PATH ?? "").split(path.delimiter),
    ...platformDirs,
  ].filter(Boolean))];
}

/** Locate the `dsh` launcher. Packaged TanWords builds do not bundle the DSH
 *  CLI, so this is best-effort: an explicit `DSH_BIN` override wins, otherwise
 *  we search PATH plus well-known package-manager prefixes. A miss returns null
 *  and the supervisor reports a "failed" status the renderer can surface. */
function resolveDshBinary(): string | null {
  const explicit = process.env.DSH_BIN;
  if (explicit && fs.existsSync(explicit)) return explicit;

  // Order matters on Windows: npm/fnm shim directories place THREE files
  // side by side for one logical command — a bare POSIX shell shim
  // (`dsh`, `#!/bin/sh`), `dsh.exe`, and `dsh.cmd`. `spawn()` below runs
  // without `shell: true`, so it hits CreateProcess directly, which cannot
  // execute a shebang script — that always fails with ENOENT no matter
  // what the actual problem is (this is what produced the "dsh failed to
  // start: spawn ...\dsh ENOENT" report even after changing the port,
  // since the port is never reached). ".cmd"/".exe" must be preferred so a
  // real Windows-executable candidate wins before the bare shim is ever
  // considered.
  const ext = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  const candidates: string[] = [];
  for (const dir of executableSearchDirs()) {
    for (const e of ext) candidates.push(path.join(dir, `dsh${e}`));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // ignore stat errors for individual candidates
    }
  }
  return null;
}

/** npm-style `.cmd`/`.bat` shims — the format fnm, npm, pnpm, and corepack
 *  all generate — follow a fixed template:
 *  `"%_prog%"  "%dp0%\node_modules\<pkg>\<entry>.js" %*`, invoking a
 *  bundled `node.exe` (or the one on PATH) against the real JS entry point
 *  next to the shim. Windows cannot execute `.cmd`/`.bat` via CreateProcess
 *  directly, and Node's CVE-2024-27980 hardening makes `spawn()` throw a
 *  synchronous EINVAL for exactly that case unless `shell: true` is passed.
 *  `shell: true` "fixes" the EINVAL but replaces the process we get back
 *  with the wrapping cmd.exe — killChild() below signals `child.pid`
 *  expecting it to BE the dsh process (for its careful graceful-shutdown
 *  flush), and under a shell wrapper that signal never reaches dsh, leaving
 *  it running as an orphan. Parsing the shim to invoke node + the real
 *  script directly sidesteps both problems. Returns null if the file isn't
 *  a recognized shim, so the caller can fall back to `shell: true` rather
 *  than fail outright. */
function resolveWindowsCmdShim(cmdPath: string): { exe: string; args: string[] } | null {
  let content: string;
  try {
    content = fs.readFileSync(cmdPath, "utf8");
  } catch {
    return null;
  }
  const match = /"%_prog%"\s+"%dp0%\\(.+?)"\s+%\*/.exec(content);
  if (!match) return null;
  const shimDir = path.dirname(cmdPath);
  const script = path.join(shimDir, match[1]);
  if (!fs.existsSync(script)) return null;
  const bundledNode = path.join(shimDir, "node.exe");
  const exe = fs.existsSync(bundledNode) ? bundledNode : "node";
  return { exe, args: [script] };
}

/** Preserve the app environment while ensuring an `env node`/`env bun`
 *  launcher can find a runtime beside the resolved CLI. Finder-launched macOS
 *  apps commonly inherit only `/usr/bin:/bin:/usr/sbin:/sbin`, even when `dsh`
 *  itself lives under `~/.local/bin` or Homebrew. */
function dshChildEnv(bin: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: executableSearchDirs([path.dirname(bin)]).join(path.delimiter),
  };
}

export class DshSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private shuttingDown = false;
  /** Set during a `restart()` kill so the child's `exit` handler knows the
   *  death was intentional and does not emit a spurious "failed" status or
   *  reject the (about-to-be-replaced) start promise. */
  private restarting = false;
  /** Configured port. `0` (default) resolves to DSH's standard port 3080. */
  private desiredPort = 0;
  private url: string | null = null;
  private startPromise: Promise<string> | null = null;
  /** True when `url` belongs to a DSH process we discovered rather than a
   *  child we spawned. External hosts are never signalled on restart/quit. */
  private attachedExternal = false;
  /** The reject closure for the in-flight start promise, so `restart()` can
   *  unblock an awaiter if the host was killed before it came up. */
  private pendingReject: ((error: Error) => void) | null = null;
  private onEvent: ((name: string, payload: unknown) => void) | null = null;
  /** Polls `session.list` while the host is up. Shared by two features that
   *  both need "is anything running right now": the task-finished
   *  notification (a session going running→idle) and the idle-stop timer
   *  (never auto-stop out from under a live task). */
  private sessionPollTimer: ReturnType<typeof setInterval> | null = null;
  private sessionRunning = new Map<string, boolean>();
  /** Whether the DSH page is currently the visible, unblocked page — set by
   *  `noteVisibility()`, called from the same `dsh_show`/`dsh_hide` IPC path
   *  that already drives the native view. */
  private pageVisible = false;
  private hiddenSince: number | null = null;
  /** `0` disables idle-stop. Set from the renderer's Settings page. */
  private idleStopMinutes = 0;

  setEventSink(sink: (name: string, payload: unknown) => void) {
    this.onEvent = sink;
  }

  /** Told by `dsh_show`/`dsh_hide` whenever the page's visibility changes —
   *  starts (or clears) the idle clock the idle-stop timer reads. */
  noteVisibility(visible: boolean): void {
    this.pageVisible = visible;
    this.hiddenSince = visible ? null : Date.now();
  }

  /** `0` disables idle-stop. The Settings page enforces its own 10-minute
   *  floor on non-zero values before calling this; this setter only guards
   *  against a malformed/negative number reaching the timer math below. */
  setIdleStopMinutes(minutes: number): void {
    this.idleStopMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
  }

  /** The ready URL, or null if the host has not (yet) come up. */
  currentUrl(): string | null {
    return this.url;
  }

  /** The saved port choice (0 = standard 3080). Read by the renderer to
   *  show the current configured port without round-tripping the settings
   *  store. */
  currentPort(): number {
    return this.desiredPort;
  }

  /** 0 = standard/reusable DSH port; otherwise clamp to a valid TCP port.
   *  Non-finite or negative values fall back to 0 so a bad stored value can
   *  never reach `dsh --port`. */
  private clampPort(port: number): number {
    if (!Number.isFinite(port) || port < 0) return 0;
    return Math.min(65535, Math.floor(port));
  }

  /** Lazily start (idempotent): resolves with the ready URL. Rejects if `dsh`
   *  is not installed or exits before printing its ready line. Concurrent and
   *  repeat calls return the same in-flight promise until it settles.
   *
   *  `port` (optional) updates the port used on the *next* spawn — it does not
   *  restart a host that is already running. Use `restart()` to apply a port
   *  change to a live host. */
  start(port?: number): Promise<string> {
    if (port !== undefined) this.desiredPort = this.clampPort(port);
    if (this.startPromise) return this.startPromise;
    const attempt = this.startOrAttach();
    this.startPromise = attempt;
    // A settled-but-failed promise should be retryable on the next user
    // action, so drop the cache if it rejected (a fresh `start()` then
    // re-attempts). Discovered hosts are re-probed on every later show because
    // TanWords does not own their lifetime; a resolved child stays cached.
    attempt.then(() => {
      if (this.attachedExternal && this.startPromise === attempt) this.startPromise = null;
    }).catch(() => {
      if (this.startPromise === attempt) this.startPromise = null;
    });
    return attempt;
  }

  /** Use the configured port, or DSH's own standard port for the default.
   *  A stable port prevents two independent writers from silently coexisting:
   *  the second host either gets reused or fails to bind. */
  private targetPort(): number {
    return this.desiredPort || DEFAULT_DSH_WEB_PORT;
  }

  /** Fingerprint an already-running DSH host through its typed API. Merely
   *  finding an HTTP listener is not enough: embedding an unrelated local
   *  service that happens to own the port would be both confusing and unsafe. */
  private async probeHost(port: number): Promise<string | null> {
    const url = `http://127.0.0.1:${port}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOST_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`${url}/api/host.describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "tanwords-dsh-probe",
          method: "host.describe",
          payload: {},
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = await response.json() as {
        type?: unknown;
        rpcId?: unknown;
        result?: { ok?: unknown; value?: Record<string, unknown> };
      };
      const value = body.result?.value;
      if (
        body.type !== "server-response" ||
        body.rpcId !== "tanwords-dsh-probe" ||
        body.result?.ok !== true ||
        typeof value?.version !== "string" ||
        typeof value?.cwd !== "string" ||
        typeof value?.attachedSessions !== "number" ||
        typeof value?.canOpenPath !== "boolean"
      ) return null;
      return url;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Prefer the configured endpoint, but also rendezvous with a standard
   *  `dsh web` host before starting a custom-port child. Otherwise merely
   *  saving a custom port while normal DSH is running would recreate the two
   *  concurrent writers this supervisor exists to prevent. */
  private async findReusableHost(): Promise<string | null> {
    const target = this.targetPort();
    const configured = await this.probeHost(target);
    if (configured || target === DEFAULT_DSH_WEB_PORT) return configured;
    return this.probeHost(DEFAULT_DSH_WEB_PORT);
  }

  private async startOrAttach(): Promise<string> {
    if (this.shuttingDown) throw new Error("dsh: supervisor is shutting down");
    this.emit({ status: "starting" });

    const existing = await this.findReusableHost();
    if (existing) {
      this.attachedExternal = true;
      this.url = existing;
      this.emit({ status: "ready", url: existing });
      this.startSessionPoll(existing);
      return existing;
    }

    this.attachedExternal = false;
    return new Promise<string>((resolve, reject) => this.spawnChild(resolve, reject));
  }

  /** Stop the current host (if any) and start a fresh one, applying `port`
   *  when given. Use this to make a port change take effect on a running
   *  host — `start()` alone won't restart a live host. Resolves with the new
   *  ready URL. */
  async restart(port?: number): Promise<string> {
    if (port !== undefined) this.desiredPort = this.clampPort(port);
    this.stopSessionPoll();

    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      this.restarting = true;
      await this.killChild(child);
      this.restarting = false;
    }

    // If the old host was still starting (never reached its ready line), its
    // start promise is still pending; reject it so anyone awaiting it unblocks
    // instead of hanging on a child we just killed.
    if (this.pendingReject) {
      this.pendingReject(new Error("dsh: host restarting"));
      this.pendingReject = null;
    }
    this.startPromise = null;
    this.url = null;
    return this.start();
  }

  private spawnChild(
    resolve: (url: string) => void,
    reject: (error: Error) => void,
  ) {
    if (this.shuttingDown) {
      reject(new Error("dsh: supervisor is shutting down"));
      return;
    }

    const bin = resolveDshBinary();
    if (!bin) {
      const reason =
        "DeepSeek Harness (`dsh`) was not found on PATH. Install it with `npm i -g @deepseek-ai/dsh` and reopen this page.";
      this.emit({ status: "failed", kind: "notInstalled", reason });
      reject(new Error(reason));
      return;
    }

    this.pendingReject = reject;

    const dshArgs = ["--profile", "web", "--host", "127.0.0.1", "--port", String(this.targetPort())];
    // `.cmd`/`.bat` can't be spawned directly on Windows without `shell:
    // true` (see resolveWindowsCmdShim's comment) — resolve through the
    // real node + script it wraps instead, falling back to `shell: true`
    // only if the shim doesn't match the expected npm template.
    let spawnExe = bin;
    let spawnArgs = dshArgs;
    let useShell = false;
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
      const shim = resolveWindowsCmdShim(bin);
      if (shim) {
        spawnExe = shim.exe;
        spawnArgs = [...shim.args, ...dshArgs];
      } else {
        useShell = true;
      }
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      // `spawn` normally emits spawn failures asynchronously via 'error', but
      // resource-exhaustion errors (EMFILE/ENOMEM) can throw synchronously.
      // Either way the host didn't start — surface a "failed" status and reject
      // rather than letting the throw propagate out of the Promise executor
      // (which would crash the main process).
      child = spawn(
        spawnExe,
        spawnArgs,
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: dshChildEnv(bin),
          shell: useShell,
          // Detach `dsh` into its own process group so a Ctrl-C in the dev
          // terminal does not signal it directly. Without this, Ctrl-C under
          // `bun run dev` sends SIGINT to the whole foreground group — vite,
          // Electron, AND dsh — so dsh starts its 5s graceful session-log
          // flush (SIGINT) at the same instant Electron's `before-quit` fires
          // our shutdown and sends SIGTERM. dsh's createProcessShutdown
          // treats that second signal as force-exit-now, truncating the
          // in-flight flush → "seq gap in committed region" on the next
          // launch. Detached, the terminal's Ctrl-C never reaches dsh; only
          // we signal it (a single SIGTERM via shutdown()), so the flush
          // always completes. The packaged app is unaffected either way
          // (no terminal process group), but this closes the dev-only
          // truncation path. The sidecar avoids this class entirely by
          // shutting down via stdin-EOF rather than signals.
          detached: true,
        },
      );
    } catch (error) {
      this.pendingReject = null;
      const reason = `dsh failed to spawn: ${error instanceof Error ? error.message : String(error)}`;
      this.emit({ status: "failed", kind: classifyFailKind(reason), reason });
      reject(error instanceof Error ? error : new Error(reason));
      return;
    }
    this.child = child;

    let settled = false;
    const handleLine = (line: string) => {
      if (settled) return;
      const match = READY_RE.exec(line);
      if (!match) return;
      settled = true;
      this.pendingReject = null;
      this.url = match[1];
      this.emit({ status: "ready", url: this.url });
      this.startSessionPoll(this.url);
      resolve(this.url);
    };

    createInterface({ input: child.stdout }).on("line", handleLine);
    createInterface({ input: child.stderr }).on("line", handleLine);
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[dsh] ${chunk}`);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      this.pendingReject = null;
      const reason = `dsh failed to start: ${error.message}`;
      this.emit({ status: "failed", kind: classifyFailKind(reason), reason });
      reject(error);
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      // `shuttingDown`: app is quitting — say nothing. `restarting`: restart()
      // owns the respawn and will emit its own "starting" — don't double-report
      // a "failed" status or reject the promise it is about to replace.
      if (this.shuttingDown || this.restarting) return;
      if (!settled) {
        // Died before it could print a ready line.
        settled = true;
        this.pendingReject = null;
        const reason = `dsh exited before it was ready (code=${code} signal=${signal})`;
        this.emit({ status: "failed", kind: classifyFailKind(reason), reason });
        reject(new Error(reason));
        return;
      }
      // Died after it was ready: clear the cached URL/state so a later visit
      // re-attempts. We do NOT auto-respawn — a broken host in a tight loop is
      // worse than a one-time "reconnecting" state the user can retry.
      this.stopSessionPoll();
      this.url = null;
      this.startPromise = null;
      this.emit({
        status: "failed",
        // A host that came up and then died (EMFILE exhausting inotify watchers
        // after printing its ready line, an OOM, a GPU fault, …) is never a
        // port problem — the port was fine, the bind succeeded. Route to the
        // inline system-error panel + Retry, never the port-fix modal.
        kind: "systemError",
        reason: "The DeepSeek Harness host stopped. Reopen the DSH page to restart it.",
      });
    });
  }

  private emit(event: DshStatusEvent) {
    this.onEvent?.("dsh:status", event);
  }

  private startSessionPoll(url: string): void {
    this.stopSessionPoll();
    const timer = setInterval(() => { void this.pollSessionStatus(url); }, SESSION_POLL_INTERVAL_MS);
    timer.unref?.();
    this.sessionPollTimer = timer;
  }

  private stopSessionPoll(): void {
    if (this.sessionPollTimer) clearInterval(this.sessionPollTimer);
    this.sessionPollTimer = null;
    this.sessionRunning.clear();
  }

  /** Polls the same `session.list` RPC the Web UI itself lists sessions with
   *  (`packages/host/apiproxy` — a documented, path-routed method, not an
   *  internal implementation detail). Each item carries `running: boolean`;
   *  a session going true→false between two polls is a turn finishing, which
   *  fires `dsh:task-finished` for main (see index.ts) to notify on. The
   *  same pass also feeds the idle-stop check below — both need "is anything
   *  running right now", so one poll serves both features. */
  private async pollSessionStatus(url: string): Promise<void> {
    let items: Array<{ sessionId?: unknown; running?: unknown }>;
    try {
      const response = await fetch(`${url}/api/session.list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "tanwords-dsh-poll",
          method: "session.list",
          payload: {},
        }),
      });
      if (!response.ok) return;
      const body = await response.json() as {
        result?: { ok?: unknown; value?: { items?: unknown } };
      };
      if (body.result?.ok !== true || !Array.isArray(body.result.value?.items)) return;
      items = body.result.value.items;
    } catch {
      // Transient (host briefly unreachable, a request mid-flight during
      // restart, …) — the next poll retries. Never treated as "nothing
      // running": a failed poll must not accidentally green-light idle-stop.
      return;
    }

    let anyRunning = false;
    for (const item of items) {
      if (typeof item.sessionId !== "string" || typeof item.running !== "boolean") continue;
      if (item.running) anyRunning = true;
      const was = this.sessionRunning.get(item.sessionId);
      this.sessionRunning.set(item.sessionId, item.running);
      if (was === true && !item.running) {
        this.onEvent?.("dsh:task-finished", { sessionId: item.sessionId });
      }
    }
    this.checkIdleStop(anyRunning);
  }

  /** Auto-stops the host after it's sat hidden (see `noteVisibility`) and
   *  idle (no session running) past the configured threshold — set from
   *  Settings, 0 disables this entirely. Never fires while any session is
   *  running, no matter how long the page has been hidden: this must not be
   *  able to interrupt a task the same way navigating away never does. */
  private checkIdleStop(anyRunning: boolean): void {
    if (this.idleStopMinutes <= 0) return;
    if (this.pageVisible || anyRunning) return;
    if (this.hiddenSince === null) return;
    if (Date.now() - this.hiddenSince < this.idleStopMinutes * 60_000) return;
    void this.idleStop();
  }

  /** Kills the child the same way an unexpected crash would, deliberately
   *  without `restarting`/`shuttingDown` set: the child's own `exit` handler
   *  then takes its normal "died after ready" branch, clearing state and
   *  emitting `failed` — harmless since the page is hidden (that's the
   *  precondition to get here), and a later `start()` respawns fresh exactly
   *  like any other post-crash reopen. An externally-attached host (no owned
   *  child) is never touched — TanWords doesn't own its lifetime. */
  private async idleStop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await this.killChild(child);
  }

  /** Stop the child: send SIGTERM **once** to trigger `dsh`'s graceful
   *  shutdown (which flushes the session log), then SIGKILL only after a
   *  generous timeout if it hasn't exited. Never send a second SIGTERM — `dsh`
   *  treats a second signal during its pending graceful shutdown as
   *  "force-exit immediately" (see `createProcessShutdown.interrupt`), which
   *  aborts the in-flight session-log flush and corrupts the log ("seq gap in
   *  committed region" on the next launch). Shared by `shutdown()` (app quit)
   *  and `restart()` (apply a new port). */
  private killChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once("exit", finish);
      // SIGKILL safety net only. dsh's own 5s graceful dispose runs on the
      // SIGTERM below; we wait past that before resorting to a hard kill so
      // the session-log flush can complete.
      const killTimeout = setTimeout(() => {
        if (settled) return;
        console.warn("[dsh] graceful shutdown exceeded budget, sending SIGKILL");
        child.kill("SIGKILL");
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
      child.once("exit", () => clearTimeout(killTimeout));
      try {
        child.kill("SIGTERM");
      } catch (error) {
        console.error("[dsh] error signaling stop:", error);
        finish();
      }
    });
  }

  /** SIGTERM the host (it has no stdin-EOF shutdown path like the Rust sidecar),
   *  then SIGKILL after a timeout so a hung host can't hang app quit. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.stopSessionPoll();
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await this.killChild(child);
  }
}
