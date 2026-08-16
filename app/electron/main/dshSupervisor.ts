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

export type DshStatus = "starting" | "ready" | "failed";

/** Why the host failed — drives different renderer guidance.
 *  - `notInstalled`: `dsh` binary not on PATH → show install/upgrade guidance.
 *  - `other`: binary found but crashed, port in use, etc. → show the port-fix
 *    modal. */
export type DshFailKind = "notInstalled" | "other";

export interface DshStatusEvent {
  status: DshStatus;
  /** The ready URL once status is "ready"; undefined otherwise. */
  url?: string;
  /** A human-readable reason when status is "failed". */
  reason?: string;
  /** Failure category when status is "failed". */
  kind?: DshFailKind;
}

/** Locate the `dsh` launcher. Packaged TanWords builds do not bundle the DSH
 *  CLI, so this is best-effort: an explicit `DSH_BIN` override wins, otherwise
 *  we search PATH plus a couple of well-known prefixes. A miss returns null and
 *  the supervisor reports a "failed" status the renderer can surface. */
function resolveDshBinary(): string | null {
  const explicit = process.env.DSH_BIN;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const ext = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  const candidates: string[] = [];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const e of ext) candidates.push(path.join(dir, `dsh${e}`));
  }
  candidates.push(path.join(process.env.HOME ?? "", ".local", "bin", "dsh"));
  candidates.push("/usr/local/bin/dsh", "/usr/bin/dsh");

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // ignore stat errors for individual candidates
    }
  }
  return null;
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

  setEventSink(sink: (name: string, payload: unknown) => void) {
    this.onEvent = sink;
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

    let child: ChildProcessWithoutNullStreams;
    try {
      // `spawn` normally emits spawn failures asynchronously via 'error', but
      // resource-exhaustion errors (EMFILE/ENOMEM) can throw synchronously.
      // Either way the host didn't start — surface a "failed" status and reject
      // rather than letting the throw propagate out of the Promise executor
      // (which would crash the main process).
      child = spawn(
        bin,
        ["--profile", "web", "--host", "127.0.0.1", "--port", String(this.targetPort())],
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: process.env,
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
      this.emit({ status: "failed", kind: "other", reason });
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
      this.emit({ status: "failed", kind: "other", reason });
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
        this.emit({ status: "failed", kind: "other", reason });
        reject(new Error(reason));
        return;
      }
      // Died after it was ready: clear the cached URL/state so a later visit
      // re-attempts. We do NOT auto-respawn — a broken host in a tight loop is
      // worse than a one-time "reconnecting" state the user can retry.
      this.url = null;
      this.startPromise = null;
      this.emit({
        status: "failed",
        kind: "other",
        reason: "The DeepSeek Harness host stopped. Reopen the DSH page to restart it.",
      });
    });
  }

  private emit(event: DshStatusEvent) {
    this.onEvent?.("dsh:status", event);
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
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await this.killChild(child);
  }
}
