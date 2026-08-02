/**
 * Building the "copy as Markdown" payload for the reader toolbar — the whole
 * article (converted from the extracted HTML, not the flattened plain text, so
 * headings/lists/links survive) plus the HN discussion when there is one.
 * Meant for pasting into an external AI chat, so fidelity beats brevity and
 * nothing is truncated.
 */
import type { HnComment } from "@/lib/hnComments";

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "header", "footer", "figure", "table", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "hr"]);

function escapeText(text: string): string {
  // Only collapse whitespace — escaping every markdown metacharacter makes the
  // copy unreadable, and a stray literal `*` in prose renders fine anyway.
  return text.replace(/\s+/g, " ");
}

function inlineContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = () => Array.from(el.childNodes).map(inlineContent).join("");
  switch (tag) {
    case "br": return "\n";
    case "strong": case "b": {
      const inner = children().trim();
      return inner ? `**${inner}**` : "";
    }
    case "em": case "i": {
      const inner = children().trim();
      return inner ? `*${inner}*` : "";
    }
    case "code": {
      const inner = (el.textContent ?? "").trim();
      return inner ? `\`${inner}\`` : "";
    }
    case "a": {
      const inner = children().trim();
      const href = el.getAttribute("href") ?? "";
      if (!inner) return "";
      // Anchor/relative/javascript links carry nothing useful out of the app.
      if (!/^https?:\/\//.test(href) || inner === href) return inner || href;
      return `[${inner}](${href})`;
    }
    case "img": {
      const alt = el.getAttribute("alt")?.trim();
      return alt ? `(${alt})` : "";
    }
    default:
      return children();
  }
}

/** Renders a mixed run of children: block elements become their own
 *  paragraphs, while consecutive inline nodes (text, em, links…) are joined
 *  into one — so `I <i>disagree</i>` stays a single line. */
function renderNodes(nodes: Node[]): string {
  const parts: string[] = [];
  let inlineRun = "";
  const flush = () => {
    const text = inlineRun.replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
    inlineRun = "";
  };
  for (const n of nodes) {
    if (n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((n as Element).tagName.toLowerCase())) {
      flush();
      const block = blockContent(n as Element);
      if (block) parts.push(block);
    } else {
      inlineRun += inlineContent(n);
    }
  }
  flush();
  return parts.join("\n\n");
}

function blockContent(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const childBlocks = () => renderNodes(Array.from(el.childNodes));
  if (/^h[1-6]$/.test(tag)) {
    const text = inlineContent(el).trim();
    return text ? `${"#".repeat(Number(tag[1]))} ${text}` : "";
  }
  switch (tag) {
    case "p": {
      const text = inlineContent(el).trim();
      return text;
    }
    case "hr": return "---";
    case "pre": {
      const code = (el.textContent ?? "").replace(/\n+$/, "");
      return code ? `\`\`\`\n${code}\n\`\`\`` : "";
    }
    case "blockquote":
      return childBlocks().split("\n").map((l) => `> ${l}`).join("\n");
    case "ul": case "ol":
      return listContent(el, 0);
    default:
      return childBlocks();
  }
}

function listContent(list: Element, depth: number): string {
  const ordered = list.tagName.toLowerCase() === "ol";
  const items: string[] = [];
  let n = 1;
  for (const li of Array.from(list.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const nested: string[] = [];
    const inlineParts: string[] = [];
    for (const child of Array.from(li.childNodes)) {
      const childTag = child.nodeType === Node.ELEMENT_NODE ? (child as Element).tagName.toLowerCase() : "";
      if (childTag === "ul" || childTag === "ol") nested.push(listContent(child as Element, depth + 1));
      else if (BLOCK_TAGS.has(childTag)) inlineParts.push(blockContent(child as Element));
      else inlineParts.push(inlineContent(child));
    }
    const marker = ordered ? `${n++}.` : "-";
    const text = inlineParts.join("").replace(/\s+/g, " ").trim();
    const indent = "  ".repeat(depth);
    items.push(`${indent}${marker} ${text}${nested.length ? "\n" + nested.join("\n") : ""}`);
  }
  return items.join("\n");
}

/** Converts extracted article HTML into readable markdown. Best-effort — the
 *  goal is a faithful, pasteable text, not a round-trippable document. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll("script, style, noscript, iframe, svg").forEach((n) => n.remove());
  return renderNodes(Array.from(doc.body.childNodes)).replace(/\n{3,}/g, "\n\n").trim();
}

/** HN comment bodies are simple HTML (p, i, a, pre) — reuse the block walker
 *  and keep the thread structure as a nested bullet list with authors. */
export function hnCommentsToMarkdown(comments: HnComment[]): string {
  const lines: string[] = [];
  const walk = (list: HnComment[], depth: number) => {
    for (const c of list) {
      const body = htmlToMarkdown(c.text).replace(/\n+/g, " ").trim();
      if (body) lines.push(`${"  ".repeat(depth)}- **${c.by || "anonymous"}**: ${body}`);
      walk(c.children, body ? depth + 1 : depth);
    }
  };
  walk(comments, 0);
  return lines.join("\n");
}

interface CopyArticleInput {
  title: string;
  byline: string | null;
  siteName: string | null;
  /** Original page URL — omitted for pasted/library articles that have none. */
  sourceUrl?: string;
  contentHtml: string;
  comments?: HnComment[] | null;
}

/** The full clipboard payload: title, source line, article body, and the HN
 *  discussion (when present) under its own heading. */
export function buildArticleMarkdown({ title, byline, siteName, sourceUrl, contentHtml, comments }: CopyArticleInput): string {
  const parts: string[] = [];
  if (title.trim()) parts.push(`# ${title.trim()}`);
  const meta = [byline, siteName].filter(Boolean).join(" · ");
  if (meta) parts.push(`*${meta}*`);
  if (sourceUrl) parts.push(`Source: ${sourceUrl}`);
  parts.push(htmlToMarkdown(contentHtml));
  if (comments && comments.length > 0) {
    parts.push("## Comments", hnCommentsToMarkdown(comments));
  }
  return parts.filter(Boolean).join("\n\n");
}
