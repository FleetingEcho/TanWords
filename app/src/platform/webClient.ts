/** RPC client for the TanWords web server.
 *
 * Same endpoint and envelope as the desktop sidecar: `POST /invoke/{command}`
 * with a JSON body and bare JSON result, or `{"error": string}` on failure.
 * The token comes from the login screen instead of the Electron preload.
 */

const TOKEN_KEY = "tanwords_web_token";

let cachedToken: string | null = readStoredToken();

function readStoredToken(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const persistent = localStorage.getItem(TOKEN_KEY);
    if (persistent) return persistent;
    // Preserve an existing login from versions that kept the token only for
    // the current tab, then remove the short-lived copy.
    const legacy = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null;
    if (legacy) {
      localStorage.setItem(TOKEN_KEY, legacy);
      sessionStorage.removeItem(TOKEN_KEY);
    }
    return legacy;
  } catch {
    return null;
  }
}

export function getWebToken(): string | null {
  return cachedToken;
}

export function setWebToken(token: string): void {
  cachedToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // In-memory session survives private-mode storage failures.
  }
  window.dispatchEvent(new Event("tanwords:authorized"));
}

export function clearWebToken(): void {
  if (cachedToken === null) return;
  cachedToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("tanwords:unauthorized"));
}

export async function webAuthFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const requestToken = cachedToken;
  if (requestToken) headers.set("authorization", `Bearer ${requestToken}`);
  const response = await fetch(input, { ...init, headers });
  // A response can arrive after logout + a new login. Only revoke the token
  // that actually authenticated this request; an old request's delayed 401
  // must never throw the newly signed-in account back to the login screen.
  if (response.status === 401 && cachedToken === requestToken) clearWebToken();
  return response;
}

export async function webBackendOrigin(): Promise<string> {
  return "";
}

export async function webBackendToken(): Promise<string> {
  const token = cachedToken;
  if (!token) throw new Error("not authenticated");
  return token;
}

/** Call a web backend command. Rejects with the bare server error string,
 * matching the desktop invoke() contract used by most call sites. */
export async function webInvoke<T = unknown>(
  command: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await webAuthFetch(`/invoke/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
    signal,
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

/** Real HTTP URL for a document asset stored in the DB. The query token is
 * required because this URL is fed to `<img src=...>`, which cannot set an
 * Authorization header (same reason SSE takes `?token=`). */
export function webAssetUrlById(id: number | string): string {
  const token = cachedToken ?? "";
  return `/api/assets/${encodeURIComponent(String(id))}?token=${encodeURIComponent(token)}`;
}

/** Upload a backup/import payload; returns the server-side temp path, which
 * `db_import_analyze` / `db_import_apply` then take as their `path` argument. */
export async function webUploadForImport(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const response = await webAuthFetch("/api/import/upload", { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.text();
    try {
      throw (JSON.parse(body).error ?? body);
    } catch (e) {
      throw typeof e === "string" ? e : body;
    }
  }
  return ((await response.json()) as { path: string }).path;
}

/** Trigger a browser download for in-memory bytes. */
export function webDownloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function webDownloadText(filename: string, text: string, mime = "text/plain"): void {
  webDownloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

export type WebPickFileOptions = {
  multiple?: boolean;
  accept?: string;
};

/** Hidden `<input type=file>` picker. Resolves `[]` when the user cancels. */
export function webPickFiles(options: WebPickFileOptions = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options.multiple) input.multiple = true;
    if (options.accept) input.accept = options.accept;
    input.style.display = "none";
    document.body.appendChild(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => done(Array.from(input.files ?? []));
    input.click();
  });
}

export async function webPickFile(options: WebPickFileOptions = {}): Promise<File | null> {
  const [file] = await webPickFiles(options);
  return file ?? null;
}

/** Downloads a snapshot of either server-owned database. The password stays
 * in a header rather than a URL/access log, and the source is a closed enum —
 * the server derives the actual path from the authenticated user id. */
export async function webExportBackup(
  password?: string | null,
  source: "local" = "local",
): Promise<void> {
  const headers = new Headers();
  if (password) headers.set("x-export-password", password);
  const response = await webAuthFetch(`/api/export/backup?source=${source}`, { headers });
  if (!response.ok) {
    const body = await response.text();
    try {
      throw (JSON.parse(body).error ?? body);
    } catch (error) {
      throw typeof error === "string" ? error : body;
    }
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
    ?? `tanwords-${source}-backup-${new Date().toISOString().slice(0, 10)}${password ? ".zip" : ".db"}`;
  webDownloadBlob(filename, await response.blob());
}
