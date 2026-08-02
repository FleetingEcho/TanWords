/** RPC to the TanWords web server (`web/server/`), replacing the desktop's
 *  `src/ipc/backend.ts`.
 *
 *  Same endpoint, same envelope: `POST /invoke/{command}` with a JSON args
 *  body, bare JSON result on success, non-2xx + `{"error": string}` on
 *  failure. The difference is where the token comes from: not an Electron
 *  preload handshake but the login screen (`api/auth.ts`), persisted in
 *  sessionStorage so a reload keeps the session.
 *
 *  Same origin in production; in dev, vite proxies /invoke, /api and /events
 *  to the Rust server (see vite.config.ts), so every URL here is relative. */

const TOKEN_KEY = "tanwords_web_token";

let cachedToken: string | null = readStoredToken();

function readStoredToken(): string | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return cachedToken;
}

export function setToken(token: string): void {
  cachedToken = token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // private-mode storage failure is survivable — the in-memory copy lasts
    // for this tab's lifetime.
  }
  window.dispatchEvent(new Event("tanwords:authorized"));
}

export function clearToken(): void {
  if (cachedToken === null) return; // don't bounce-loop: only dispatch on a real transition
  cachedToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
  // Any 401 or logout lands here; App listens and drops back to the login
  // screen regardless of which component issued the doomed request.
  window.dispatchEvent(new Event("tanwords:unauthorized"));
}

/** `fetch` with the bearer token attached and the 401 -> logout transition
 *  centralized. Used by invoke and by the auth/import/export/asset routes. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cachedToken) headers.set("authorization", `Bearer ${cachedToken}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) clearToken();
  return response;
}

/** Base URL of the backend. Same origin in the web build, hence empty string;
 *  kept async to match the desktop module's shape at call sites. */
export async function backendOrigin(): Promise<string> {
  return "";
}

export async function backendToken(): Promise<string> {
  const token = cachedToken;
  if (!token) throw new Error("not authenticated");
  return token;
}

/** Call a backend command. Resolves with the command's JSON result; rejects
 *  with the bare error *string* the command returned, because call sites match
 *  on it (e.g. DOCUMENT_LOCKED in document_privacy).
 *  Do not wrap it in an Error with a prefix. */
export async function invoke<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await authFetch(`/invoke/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });

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

/** Real HTTP URL for a document asset stored in the DB, served by the web
 *  server at `/api/assets/:id`. The query token is required because this URL
 *  is fed to `<img src=...>`, which cannot set an Authorization header
 *  (same reason SSE takes `?token=`). Replaces the desktop's path-based
 *  `/asset?path=` — browsers must never see server filesystem paths. */
export function assetUrlById(id: number | string): string {
  const token = cachedToken ?? "";
  return `/api/assets/${encodeURIComponent(String(id))}?token=${encodeURIComponent(token)}`;
}
