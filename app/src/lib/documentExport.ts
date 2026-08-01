import { saveDialog } from "@/ipc/dialog";
import { callMain } from "@/ipc/host";
import { invoke } from "@/ipc/backend";
import { codeBlockOptions } from "@blocknote/code-block";
import { markdownToBlocksOffThread, blocksToHtmlOffThread } from "./documentWorkerClient";

let exportCount = 0;
const listeners = new Set<(busy: boolean) => void>();

function setExportBusy(busy: boolean): void {
  if (busy) exportCount += 1;
  else exportCount = Math.max(0, exportCount - 1);
  for (const listener of listeners) listener(exportCount > 0);
}

export function subscribeToExportBusy(listener: (busy: boolean) => void): () => void {
  listeners.add(listener);
  listener(exportCount > 0);
  return () => listeners.delete(listener);
}

async function withExportBusy<T>(work: () => Promise<T>): Promise<T> {
  setExportBusy(true);
  try {
    return await work();
  } finally {
    setExportBusy(false);
  }
}

function safeFileName(title: string, ext: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "document";
  return `${base}.${ext}`;
}

function wrapHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title.replace(/</g, "&lt;")}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; line-height: 1.7; color: #1f2937; max-width: 960px; margin: 40px auto; padding: 0 24px; }
    h1, h2, h3, h4 { line-height: 1.25; }
    img, svg { max-width: 100%; height: auto; }
    pre { background: #f3f4f6; border: 1px solid #d1d5db; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    blockquote { border-left: 4px solid #d1d5db; margin-left: 0; padding-left: 16px; color: #4b5563; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
    @media print { body { margin: 0; max-width: none; padding: 0; } }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function isLocalAssetUrl(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:\d+\/asset\?/.test(url);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream";
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${mimeType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function inlineDocumentAssets(editor: any, html: string): Promise<string> {
  let out = html;

  // Database-backed document assets are stored in the sidecar DB. Turn them
  // into data URLs so the exported HTML remains viewable without the app.
  const dbAssetIds = [...new Set(html.match(/tanwords-asset:\/\/([0-9a-fA-F-]{36})/g)?.map((url) => url.slice("tanwords-asset://".length)) ?? [])];
  for (const id of dbAssetIds) {
    try {
      const asset = await invoke<{ mime_type: string; data_base64: string }>("db_get_document_asset", { id });
      out = out.split(`tanwords-asset://${id}`).join(`data:${asset.mime_type};base64,${asset.data_base64}`);
    } catch {
      // Keep the original app URL; the export still completes with the text.
    }
  }

  // Local markdown vault images are served through the sidecar asset endpoint.
  const localUrls = [...new Set(html.match(/https?:\/\/[^\s"']+/)?.filter(isLocalAssetUrl) ?? [])];
  for (const url of localUrls) {
    const dataUrl = await fetchAsDataUrl(url);
    if (dataUrl) out = out.split(url).join(dataUrl);
    await yieldToMain();
  }

  return out;
}

async function resolveAssetUrls(editor: any, html: string): Promise<string> {
  const urls = [...new Set(html.match(/tanwords-asset:\/\/([0-9a-fA-F-]{36})/g) ?? [])];
  let out = html;
  for (const url of urls) {
    try {
      const resolved = await editor.resolveFileUrl(url);
      out = out.split(url).join(resolved);
    } catch {
      // Keep the original app URL; the export still completes with the text.
    }
  }
  return out;
}

async function renderMermaidBlocks(html: string): Promise<string> {
  if (!html.includes('class="mermaid"')) return html;
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "neutral",
  });
  const template = document.createElement("template");
  template.innerHTML = html;
  let sequence = 0;
  for (const pre of Array.from(template.content.querySelectorAll("pre.mermaid"))) {
    const code = pre.textContent ?? "";
    if (!code.trim()) continue;
    try {
      const { svg } = await mermaid.render(`tanwords-export-${++sequence}`, code);
      const holder = document.createElement("div");
      holder.innerHTML = svg;
      pre.replaceWith(...Array.from(holder.childNodes));
      await yieldToMain();
    } catch {
      // Keep the source code block when a diagram fails to render.
    }
  }
  return template.innerHTML;
}

/** Normalize mermaid code fences (as parsed by the headless markdown
 *  converter) into the `pre.mermaid` structure the renderer expects. */
function normalizeMermaidFences(html: string): string {
  return html.replace(
    /<pre[^>]*data-language="mermaid"[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g,
    (_match, code: string) => `<pre class="mermaid">${code}</pre>`,
  );
}

async function highlightCodeBlocks(html: string): Promise<string> {
  const template = document.createElement("template");
  template.innerHTML = html;
  const codeElements = Array.from(template.content.querySelectorAll<HTMLElement>("pre > code[data-language]"));
  if (codeElements.length === 0) return html;

  const highlighter = await codeBlockOptions.createHighlighter();
  const theme = document.documentElement.classList.contains("dark") ? "github-dark" : "github-light";

  for (const code of codeElements) {
    const pre = code.parentElement;
    const language = code.getAttribute("data-language") || "text";
    const source = code.textContent ?? "";
    try {
      if (!highlighter.getLoadedLanguages().includes(language)) {
        await highlighter.loadLanguage(language as never);
      }
      const highlighted = highlighter.codeToHtml(source, { lang: language as never, theme });
      const holder = document.createElement("div");
      holder.innerHTML = highlighted;
      pre?.replaceWith(...Array.from(holder.childNodes));
      await yieldToMain();
    } catch {
      // Keep the plain code block when the language isn't supported.
    }
  }
  return template.innerHTML;
}

export async function exportMarkdownAsHtml(title: string, markdown: string): Promise<void> {
  await withExportBusy(async () => {
    const blocks = await markdownToBlocksOffThread(markdown);
    const body = await blocksToHtmlOffThread(blocks as any);
    let html = await inlineDocumentAssets(undefined, normalizeMermaidFences(body));
    html = await renderMermaidBlocks(html);
    html = await highlightCodeBlocks(html);
    const destination = await saveDialog({
      defaultPath: safeFileName(title, "html"),
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!destination) return;
    await callMain("file:write", { path: destination, data: wrapHtml(title, html) });
  });
}

export async function exportMarkdownAsPdf(title: string, markdown: string): Promise<void> {
  await withExportBusy(async () => {
    const blocks = await markdownToBlocksOffThread(markdown);
    const body = await blocksToHtmlOffThread(blocks as any);
    let html = await inlineDocumentAssets(undefined, normalizeMermaidFences(body));
    html = await renderMermaidBlocks(html);
    html = await highlightCodeBlocks(html);
    const destination = await saveDialog({
      defaultPath: safeFileName(title, "pdf"),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!destination) return;
    await callMain("window:printHtmlToPdf", { path: destination, html: wrapHtml(title, html) });
  });
}

export async function exportEditorHtml(editor: any, title: string): Promise<void> {
  await withExportBusy(async () => {
    let html = await inlineDocumentAssets(editor, editor.blocksToHTMLLossy(editor.document));
    html = await resolveAssetUrls(editor, html);
    html = await renderMermaidBlocks(html);
    html = await highlightCodeBlocks(html);
    const destination = await saveDialog({
      defaultPath: safeFileName(title, "html"),
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!destination) return;
    await callMain("file:write", { path: destination, data: wrapHtml(title, html) });
  });
}

export async function exportEditorPdf(editor: any, title: string): Promise<void> {
  await withExportBusy(async () => {
    let html = await inlineDocumentAssets(editor, editor.blocksToHTMLLossy(editor.document));
    html = await resolveAssetUrls(editor, html);
    html = await renderMermaidBlocks(html);
    html = await highlightCodeBlocks(html);
    const destination = await saveDialog({
      defaultPath: safeFileName(title, "pdf"),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!destination) return;
    await callMain("window:printHtmlToPdf", { path: destination, html: wrapHtml(title, html) });
  });
}
