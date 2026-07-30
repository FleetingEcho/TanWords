/** Replaces `@tauri-apps/api/core`. See ./README.md. */

/** Injected by electron/preload. Kept minimal on purpose — everything heavy
 *  goes straight to the Rust sidecar over HTTP rather than through main. */
declare global {
  interface Window {
    tanwords?: {
      /** Resolves once the sidecar has handshaken. */
      backend: Promise<{ port: number; token: string }>;
      /** Main-process commands: browser panel, tray, dialogs, shell, ... */
      call: (channel: string, payload?: unknown) => Promise<any>;
      on: (channel: string, handler: (payload: any) => void) => () => void;
    };
  }
}

/** Commands the Electron main process owns rather than the sidecar. Keep this
 *  in sync with SKIP_MODULES in core/build.rs (generate_dispatch_table()) —
 *  a name in one list and not the other is a silent routing bug. */
const MAIN_PROCESS_COMMANDS = /^(browser_|tray_)/;

let cached: { port: number; token: string } | null = null;

async function backend() {
  if (cached) return cached;
  if (!window.tanwords) throw new Error("preload bridge missing");
  cached = await window.tanwords.backend;
  return cached;
}

/** Base URL of the sidecar. Exported because `convertFileSrc` and the SSE
 *  stream in ./event.ts need it too. */
export async function backendOrigin(): Promise<string> {
  const { port } = await backend();
  return `http://127.0.0.1:${port}`;
}

export async function backendToken(): Promise<string> {
  return (await backend()).token;
}

export async function invoke<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (MAIN_PROCESS_COMMANDS.test(command)) {
    if (!window.tanwords) throw new Error("preload bridge missing");
    return window.tanwords.call(command, args) as Promise<T>;
  }

  const { port, token } = await backend();
  const response = await fetch(`http://127.0.0.1:${port}/invoke/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });

  // The sidecar reports command failures as 4xx/5xx with `{ error }`. Tauri
  // rejected with the bare string a command returned in `Err(..)`, and call
  // sites match on it (e.g. `isModelNotLoaded`, and DOCUMENT_LOCKED in
  // document_privacy). Preserve that exactly — do not wrap it in an Error
  // with a prefix.
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

/** Replaces Tauri's asset protocol. Returns a real HTTP URL, so `<audio>` gets
 *  Range requests and seeking works — see migration plan §8.3. */
export function convertFileSrc(path: string, _protocol = "asset"): string {
  if (!cached) {
    // Callers are synchronous (they feed `src=` attributes), so the sidecar
    // must already be up. App boot gates rendering on `backend()`.
    throw new Error("convertFileSrc called before the backend handshake");
  }
  const { port, token } = cached;
  return `http://127.0.0.1:${port}/asset?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
}

/** True when `convertFileSrc` produced this URL. `lib/localDocs.ts` needs it to
 *  map a URL back to a path — that is the one line of UI code that changes. */
export function isAssetUrl(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:\d+\/asset\?/.test(url);
}

export function assetUrlToPath(url: string): string {
  return new URL(url).searchParams.get("path") ?? "";
}

export {};
