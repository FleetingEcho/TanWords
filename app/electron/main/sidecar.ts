/** Supervises the `tanwords-core` sidecar: spawns it, parses the
 *  `{"port":N,"token":".."}` handshake it prints as its first stdout line
 *  (see core/src/server.rs's `serve`), restarts it if it dies, and shuts it
 *  down gracefully (not SIGKILL) on app quit so an in-flight background
 *  sync gets to finish (migration plan §8.7). */
import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import fs from "node:fs";

export type BackendInfo = { port: number; token: string };

const MIN_RESTART_INTERVAL_MS = 1000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;

function binaryName(): string {
  return process.platform === "win32" ? "tanwords-core.exe" : "tanwords-core";
}

/** Where the sidecar binary lives. Packaged builds carry it as an
 *  `extraResources` entry (Task 5); unpackaged dev/CI runs use whichever of
 *  `core/target/{release,debug}` was actually built.
 *
 *  When both exist, the *newer* one wins rather than release unconditionally.
 *  `bun run dev` builds debug (`core:build:dev`), so preferring release meant
 *  that once `bun run package` had produced a release binary, every later dev
 *  run silently kept executing it — Rust edits appeared to do nothing, and new
 *  backend fields came back undefined while the old ones still worked, which
 *  looks like a frontend bug rather than a stale binary. */
function resolveBinaryPath(): string {
  const name = binaryName();

  if (app.isPackaged) {
    return path.join(process.resourcesPath, "core", name);
  }

  const coreDir = path.join(app.getAppPath(), "core");
  const releasePath = path.join(coreDir, "target", "release", name);
  const debugPath = path.join(coreDir, "target", "debug", name);

  const mtime = (p: string): number => {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return -1;
    }
  };
  const release = mtime(releasePath);
  const debug = mtime(debugPath);
  if (release < 0 && debug < 0) return debugPath;
  return release >= debug ? releasePath : debugPath;
}

export class SidecarSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private shuttingDown = false;
  private lastSpawnAt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private readyResolve!: (info: BackendInfo) => void;
  /** Renewed on every (re)spawn. Callers that already awaited an earlier
   *  instance keep whatever value they got — only `backendReady()` calls made
   *  *after* a restart see the new one. That's fine: the one caller that
   *  matters (preload's single `tanwords:backend` invoke at page load) reads
   *  it once. */
  private ready: Promise<BackendInfo> = new Promise((resolve) => {
    this.readyResolve = resolve;
  });
  private onEvent: ((name: string, payload: unknown) => void) | null = null;

  /** Forwarded to the renderer's "event" channel — see electron/main/ipc.ts. */
  setEventSink(sink: (name: string, payload: unknown) => void) {
    this.onEvent = sink;
  }

  backendReady(): Promise<BackendInfo> {
    return this.ready;
  }

  start() {
    this.spawnChild();
  }

  private spawnChild() {
    if (this.shuttingDown) return;

    const binPath = resolveBinaryPath();
    this.lastSpawnAt = Date.now();

    if (!fs.existsSync(binPath)) {
      console.error(
        `[sidecar] binary not found at ${binPath} — run \`bun run core:build\` (or \`cargo build\` in app/core) first.`,
      );
      this.scheduleRestart();
      return;
    }

    const child = spawn(binPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    this.child = child;

    // TODO(windows): assign `child` to a Job Object with
    // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so an ungraceful Electron exit can't
    // orphan the sidecar holding the loopback port (plan §8.6). Node's
    // child_process has no built-in Job Object support on Windows and no
    // suitable native addon is currently a dependency of this project; the
    // stdin-EOF graceful-shutdown path below is the only shutdown mechanism
    // until one is added.

    let handshakeSeen = false;
    const stdoutLines = createInterface({ input: child.stdout });
    stdoutLines.on("line", (line) => {
      if (!handshakeSeen) {
        handshakeSeen = true;
        try {
          const info = JSON.parse(line) as BackendInfo;
          if (typeof info.port !== "number" || typeof info.token !== "string") {
            throw new Error("handshake missing port/token");
          }
          console.log(`[sidecar] ready on 127.0.0.1:${info.port}`);
          this.readyResolve(info);
        } catch (error) {
          console.error(`[sidecar] failed to parse handshake line: ${line}`, error);
        }
        return;
      }
      // Anything after the handshake line is unexpected but not fatal —
      // log it rather than silently dropping it.
      console.log(`[sidecar] stdout: ${line}`);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[sidecar] ${chunk}`);
    });

    child.on("error", (error) => {
      console.error("[sidecar] spawn error:", error);
    });

    child.on("exit", (code, signal) => {
      console.log(`[sidecar] exited (code=${code}, signal=${signal})`);
      this.child = null;
      if (this.shuttingDown) return;
      // The sidecar died on its own — replace the resolved/pending handshake
      // promise so a future restart can be awaited by anything that cares,
      // and try again after a floor of MIN_RESTART_INTERVAL_MS.
      this.ready = new Promise((resolve) => {
        this.readyResolve = resolve;
      });
      this.scheduleRestart();
    });
  }

  private scheduleRestart() {
    if (this.shuttingDown || this.restartTimer) return;
    const elapsed = Date.now() - this.lastSpawnAt;
    const delay = Math.max(MIN_RESTART_INTERVAL_MS - elapsed, MIN_RESTART_INTERVAL_MS);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnChild();
    }, delay);
  }

  /** Closes the sidecar's stdin (the EOF the Rust side watches for — see
   *  `shutdown_on_stdin_eof` in core/src/server.rs) and awaits process exit,
   *  so an in-flight write gets to finish. Falls back to SIGTERM/SIGKILL
   *  only if the process doesn't exit on its own within
   *  GRACEFUL_SHUTDOWN_TIMEOUT_MS, so a hung sidecar can't hang app quit
   *  forever. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      child.once("exit", finish);

      const timeout = setTimeout(() => {
        if (settled) return;
        console.warn("[sidecar] graceful shutdown timed out, sending SIGTERM");
        child.kill("SIGTERM");
        const killTimeout = setTimeout(() => {
          if (settled) return;
          console.warn("[sidecar] SIGTERM timed out, sending SIGKILL");
          child.kill("SIGKILL");
        }, 2000);
        child.once("exit", () => clearTimeout(killTimeout));
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
      child.once("exit", () => clearTimeout(timeout));

      try {
        child.stdin.end();
      } catch (error) {
        console.error("[sidecar] error closing stdin:", error);
      }
    });
  }
}
