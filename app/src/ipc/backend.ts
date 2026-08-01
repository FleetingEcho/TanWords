/** RPC to the Rust sidecar (`core/`), plus its asset URLs.
 *
 *  The sidecar serves a loopback HTTP API on a random port, gated by a token
 *  handed to the renderer through the preload handshake. Calls go renderer ->
 *  sidecar directly; the Electron main process is not in the path. */

import { host, callMain } from "./host";

/** Commands the Electron main process owns rather than the sidecar. Keep this
 *  in sync with SKIP_MODULES in core/build.rs (generate_dispatch_table()) —
 *  a name in one list and not the other is a silent routing bug. */
const MAIN_PROCESS_COMMANDS = /^(browser|tray)_/;

let cached: { port: number; token: string } | null = null;
let cachedPromise: Promise<{ port: number; token: string }> | null = null;

async function handshake() {
  if (cachedPromise) return cachedPromise;
  cachedPromise = host().backend.then((info) => {
    cached = info;
    return info;
  });
  return cachedPromise;
}

/** Invalidates the renderer's cached port/token and asks main for the current
 *  sidecar handshake. This is how calls recover after the sidecar crashes and
 *  is restarted on a new port. */
export async function refreshBackendInfo() {
  cached = null;
  cachedPromise = host().refreshBackend().then((info) => {
    cached = info;
    return info;
  });
  return cachedPromise;
}

/** Base URL of the sidecar. Exported because the SSE stream in ./events.ts
 *  needs it too. */
export async function backendOrigin(): Promise<string> {
  const { port } = await handshake();
  return `http://127.0.0.1:${port}`;
}

export async function backendToken(): Promise<string> {
  return (await handshake()).token;
}

/** Call a backend command. Resolves with the command's JSON result; rejects
 *  with the bare error *string* the command returned, because call sites match
 *  on it (e.g. `isModelNotLoaded`, and DOCUMENT_LOCKED in document_privacy).
 *  Do not wrap it in an Error with a prefix. */
export async function invoke<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (MAIN_PROCESS_COMMANDS.test(command)) {
    return callMain<T>(command, args);
  }

  const send = async () => {
    const { port, token } = await handshake();
    return fetch(`http://127.0.0.1:${port}/invoke/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(args),
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    // The sidecar died between commands; main restarts it on a new port. Retry
    // once against the refreshed handshake instead of failing every caller.
    await refreshBackendInfo();
    response = await send();
  }

  if (!response.ok) {
    const body = await response.text();
    try {
      throw (JSON.parse(body).error ?? body);
    } catch (e) {
      throw typeof e === "string" ? e : body;
    }
  }
  return response.json() as Promise<T>;
}

/** A real HTTP URL for a local file, served by the sidecar. Being real HTTP is
 *  what gives `<audio>`/`<video>` Range requests, so seeking works. */
export function assetUrl(path: string): string {
  if (!cached) {
    // Callers are synchronous (they feed `src=` attributes), so the sidecar
    // must already be up. App boot gates rendering on the handshake.
    throw new Error("assetUrl called before the backend handshake");
  }
  const { port, token } = cached;
  return `http://127.0.0.1:${port}/asset?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
}

/** True when `assetUrl` produced this URL. `lib/localDocs.ts` needs it to map
 *  a URL back to a path. */
export function isAssetUrl(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:\d+\/asset\?/.test(url);
}

export function assetUrlToPath(url: string): string {
  return new URL(url).searchParams.get("path") ?? "";
}
