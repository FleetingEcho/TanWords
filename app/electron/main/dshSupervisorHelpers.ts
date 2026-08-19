/** Pure helpers, constants, and types extracted verbatim from
 *  `dshSupervisor.ts`: the DSH binary discovery, Windows
 *  `.cmd`/`.bat` shim resolution, env PATH augmentation, and
 *  failure-reason classification used by `DshSupervisor`. None
 *  of these reference supervisor state, so they live here to
 *  keep the supervisor class slim. */
import path from "node:path";
import fs from "node:fs";

export const READY_RE = /^dsh web: (https?:\/\/\S+)/;
export const DEFAULT_DSH_WEB_PORT = 3080;
export const HOST_PROBE_TIMEOUT_MS = 500;
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
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 9000;
/** How often to poll `session.list` while the host is up — cheap (loopback
 *  HTTP) and drives both the task-finished notification and the idle-stop
 *  timer below. */
export const SESSION_POLL_INTERVAL_MS = 4000;

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
export function classifyFailKind(reason: string): DshFailKind {
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
export function resolveDshBinary(): string | null {
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
export function resolveWindowsCmdShim(cmdPath: string): { exe: string; args: string[] } | null {
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
export function dshChildEnv(bin: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: executableSearchDirs([path.dirname(bin)]).join(path.delimiter),
  };
}
