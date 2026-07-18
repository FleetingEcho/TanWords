/**
 * Local markdown vault API — thin wrappers over the `localdocs_*` Tauri
 * commands. All paths are relative to the mounted root folder; the root
 * itself is persisted in settings under `LOCAL_DOCS_ROOT_KEY`.
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export const LOCAL_DOCS_ROOT_KEY = "localdocs.root";

export interface LocalDocItem {
  rel_path: string;
  name: string;
  modified_ms: number;
  size: number;
}

export interface LocalDocSearchResult {
  rel_path: string;
  name: string;
  hits: Array<{ line_number: number; line_text: string }>;
}

export function listLocalDocs(root: string): Promise<LocalDocItem[]> {
  return invoke("localdocs_list", { root });
}

export function searchLocalDocs(root: string, query: string): Promise<LocalDocSearchResult[]> {
  return invoke("localdocs_search", { root, query });
}

export function readLocalDoc(root: string, relPath: string): Promise<string> {
  return invoke("localdocs_read", { root, relPath });
}

export function writeLocalDoc(root: string, relPath: string, content: string): Promise<void> {
  return invoke("localdocs_write", { root, relPath, content });
}

/** Returns the new file's relative path. */
export function createLocalDoc(root: string, name: string, directory = ""): Promise<string> {
  return invoke("localdocs_create", { root, name, directory });
}

/** Moves a file into a directory and returns its new relative path. */
export function moveLocalDoc(root: string, relPath: string, targetDir: string): Promise<string> {
  return invoke("localdocs_move", { root, relPath, targetDir });
}

/** Returns the new relative path. */
export function renameLocalDoc(root: string, relPath: string, newName: string): Promise<string> {
  return invoke("localdocs_rename", { root, relPath, newName });
}

export function deleteLocalDoc(root: string, relPath: string): Promise<void> {
  return invoke("localdocs_delete", { root, relPath });
}

export function importLocalDocs(root: string, sources: string[]): Promise<string[]> {
  return invoke("localdocs_import", { root, sources });
}

export function exportLocalDocs(root: string, relPaths: string[], destination: string): Promise<number> {
  return invoke("localdocs_export", { root, relPaths, destination });
}

export interface MarkdownSource { path: string; name: string; content: string }
export function readMarkdownFiles(paths: string[]): Promise<MarkdownSource[]> {
  return invoke("markdown_read_files", { paths });
}

export function exportMarkdownFiles(destination: string, files: Array<{ name: string; content: string }>): Promise<number> {
  return invoke("markdown_export_files", { destination, files });
}

// ── Image path rewriting ────────────────────────────────────────────────────
// Markdown files reference images relative to the vault ("./img/a.png").
// The webview can't load raw file paths, so on load we rewrite them to the
// Tauri asset protocol for display, and on save we rewrite back so the file
// on disk stays portable (readable by Obsidian, GitHub, etc).

// Lazy URL group tolerates unencoded spaces in paths; an optional trailing
// `"title"` still parses because the lazy match stops before it.
const MD_IMG_RE = /(!\[[^\]]*\]\()([^)]+?)((?:\s+"[^"]*")?\))/g;

function tryDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Collapse "." / ".." segments; input and output are absolute paths. */
function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

/** Relative path from absolute directory `fromDir` to absolute file `to`. */
function relativize(fromDir: string, to: string): string {
  const f = fromDir.split("/").filter(Boolean);
  const t = to.split("/").filter(Boolean);
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  return "../".repeat(f.length - i) + t.slice(i).join("/");
}

/** Absolute directory containing `relPath` inside the vault. */
function fileDirAbs(root: string, relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx >= 0 ? `${root}/${relPath.slice(0, idx)}` : root;
}

/** Rewrite local image paths (relative to the md file, or absolute) into
 *  asset-protocol URLs the webview can render. */
export function mdToDisplay(markdown: string, root: string, relPath: string): string {
  const baseDir = fileDirAbs(root, relPath);
  return markdown.replace(MD_IMG_RE, (_m, pre: string, url: string, post: string) => {
    if (/^(https?:|data:|blob:|asset:)/i.test(url)) return pre + url + post;
    const path = tryDecode(url);
    const abs = normalizePath(path.startsWith("/") ? path : `${baseDir}/${path}`);
    return pre + convertFileSrc(abs) + post;
  });
}

/** Reverse of mdToDisplay: asset-protocol URLs back to file-relative paths,
 *  so the markdown on disk stays portable (Obsidian, GitHub, etc). */
export function mdFromDisplay(markdown: string, root: string, relPath: string): string {
  const baseDir = fileDirAbs(root, relPath);
  return markdown.replace(MD_IMG_RE, (_m, pre: string, url: string, post: string) => {
    let abs: string | null = null;
    if (url.startsWith("asset://localhost/")) abs = url.slice("asset://localhost/".length);
    else if (url.startsWith("http://asset.localhost/")) abs = url.slice("http://asset.localhost/".length);
    if (abs === null) return pre + url + post;
    abs = tryDecode(abs);
    if (!abs.startsWith("/")) abs = "/" + abs;
    // Only relativize paths inside the vault; anything else stays absolute.
    const rel = abs.startsWith(root + "/") ? relativize(baseDir, abs) : abs;
    const safe = encodeURI(rel).replace(/\(/g, "%28").replace(/\)/g, "%29");
    return pre + safe + post;
  });
}
