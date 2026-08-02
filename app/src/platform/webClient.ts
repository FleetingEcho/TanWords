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
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null;
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
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // In-memory session survives private-mode storage failures.
  }
  window.dispatchEvent(new Event("tanwords:authorized"));
}

export function clearWebToken(): void {
  if (cachedToken === null) return;
  cachedToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("tanwords:unauthorized"));
}

export async function webAuthFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cachedToken) headers.set("authorization", `Bearer ${cachedToken}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) clearWebToken();
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
): Promise<T> {
  const response = await webAuthFetch(`/invoke/${command}`, {
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

/** Database backup export: the server streams the file; anchor-clicking the
 * URL with the token in the query lets the browser handle saving. */
export function webExportBackup(password?: string | null): void {
  const token = cachedToken ?? "";
  const params = new URLSearchParams({ token });
  if (password) params.set("password", password);
  const a = document.createElement("a");
  a.href = `/api/export/backup?${params.toString()}`;
  a.download = `tanwords-backup-${new Date().toISOString().slice(0, 10)}${password ? ".zip" : ".db"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
