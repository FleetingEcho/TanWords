/** Browser equivalents for the small things Electron's main process used to
 *  do: open URLs, pick files, save exports, read clipboard images, upload an
 *  import payload. Nothing here talks to the Rust command set — this is the
 *  platform seam that replaced `src/ipc/{shell,dialog,clipboard,app}.ts`. */

import { authFetch, getToken } from "./client";

/** Hand a URL to the browser. Main used to scheme-validate before
 *  shell.openExternal; window.open with noopener keeps the same safety bar. */
export async function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}

export type PickFileOptions = {
  multiple?: boolean;
  /** e.g. ".json,text/markdown" — a MIME/extension accept list. */
  accept?: string;
};

/** Hidden <input type=file> picker. Resolves `[]` when the user cancels —
 *  desktop openDialog yielded null, but array-shaped results keep the two
 *  call paths (single/multiple) uniform for web call sites. */
export function pickFiles(options: PickFileOptions = {}): Promise<File[]> {
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
    // There is no reliable cancel event; picking the dialog again is the
    // common cancel-out, and blur/F12 races are benign — a stale resolve on
    // window focus would fire *before* file selection, so we don't use it.
    input.click();
  });
}

export async function pickFile(options: PickFileOptions = {}): Promise<File | null> {
  const [file] = await pickFiles(options);
  return file ?? null;
}

/** Trigger a browser download for in-memory bytes. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/** The desktop read clipboard images natively because some platforms hide
 *  them from paste events; browsers expose them through the async clipboard
 *  API instead (permission may be denied -> treat as "no image"). */
export async function readClipboardImage(): Promise<File | null> {
  try {
    if (!navigator.clipboard?.read) return null;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      if (blob.size === 0) return null;
      const ext = type.split("/")[1] || "png";
      return new File([blob], `clipboard-${Date.now()}.${ext}`, { type });
    }
    return null;
  } catch {
    return null;
  }
}

/** Upload a backup/import payload; returns the server-side temp path, which
 *  `db_import_analyze` / `db_import_apply` then take as their `path` argument
 *  (the command contract is unchanged from the desktop). */
export async function uploadForImport(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const response = await authFetch("/api/import/upload", { method: "POST", body: form });
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

/** Database backup export: the server streams the file; anchor-clicking the
 *  URL (with the token in the query, like /events) lets the browser handle
 *  saving without any dialog plumbing. */
export function exportBackup(password?: string | null): void {
  // Token in the query intentionally: this URL is navigated to, not fetched.
  const token = getToken() ?? "";
  const params = new URLSearchParams({ token });
  if (password) params.set("password", password);
  const a = document.createElement("a");
  a.href = `/api/export/backup?${params.toString()}`;
  a.download = `tanwords-backup-${new Date().toISOString().slice(0, 10)}${password ? ".zip" : ".db"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
