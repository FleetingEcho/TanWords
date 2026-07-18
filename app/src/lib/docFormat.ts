/**
 * Document content format helpers.
 *
 * Storage format: JSON array of BlockNote blocks (documents.content).
 * Legacy format: Lexical editor-state JSON ({"root":{...}}) — converted to
 * markdown, then parsed into blocks on load (lazy migration: the next save
 * persists the new format).
 */
import { BlockNoteEditor, PartialBlock } from "@blocknote/core";

// ── Legacy Lexical → Markdown ───────────────────────────────────────────────

function lexicalTextToMd(node: any): string {
  if (node.type === "linebreak") return "\n";
  if (node.type === "image") return node.src ? `![${node.altText || ""}](${node.src})` : "";
  if (node.type === "link") {
    const inner = (node.children ?? []).map(lexicalTextToMd).join("");
    return `[${inner}](${node.url || ""})`;
  }
  let text: string = node.text ?? "";
  if (!text) return "";
  const fmt: number = node.format ?? 0;
  if (fmt & 16) return `\`${text}\``;
  if (fmt & 1) text = `**${text}**`;
  if (fmt & 2) text = `*${text}*`;
  if (fmt & 4) text = `~~${text}~~`;
  return text;
}

function lexicalChildrenToMd(children: any[]): string {
  return (children ?? []).map(lexicalTextToMd).join("");
}

function lexicalListToMd(node: any, depth: number): string {
  const lines: string[] = [];
  const ordered = node.listType === "number";
  const check = node.listType === "check";
  (node.children ?? []).forEach((li: any, i: number) => {
    const nestedLists = (li.children ?? []).filter((c: any) => c.type === "list");
    const inline = (li.children ?? []).filter((c: any) => c.type !== "list");
    const indent = "  ".repeat(depth);
    const marker = ordered ? `${i + 1}.` : "-";
    const box = check ? (li.checked ? " [x]" : " [ ]") : "";
    const text = lexicalChildrenToMd(inline);
    if (text.trim() || !nestedLists.length) lines.push(`${indent}${marker}${box} ${text}`);
    for (const nested of nestedLists) lines.push(lexicalListToMd(nested, depth + 1));
  });
  return lines.join("\n");
}

function lexicalToMarkdown(json: any): string {
  const blocks: string[] = [];
  for (const node of json?.root?.children ?? []) {
    switch (node.type) {
      case "heading": {
        const level = Number(String(node.tag || "h1").replace("h", "")) || 1;
        blocks.push(`${"#".repeat(level)} ${lexicalChildrenToMd(node.children)}`);
        break;
      }
      case "quote":
        blocks.push(`> ${lexicalChildrenToMd(node.children)}`);
        break;
      case "list":
        blocks.push(lexicalListToMd(node, 0));
        break;
      case "image":
        blocks.push(lexicalTextToMd(node));
        break;
      default:
        blocks.push(lexicalChildrenToMd(node.children));
    }
  }
  return blocks.filter((b) => b !== undefined).join("\n\n");
}

// ── Content loading / saving ────────────────────────────────────────────────

/** Headless editor used only for markdown parsing (no DOM mount needed). */
let parserEditor: BlockNoteEditor | null = null;
function getParser(): BlockNoteEditor {
  if (!parserEditor) parserEditor = BlockNoteEditor.create();
  return parserEditor;
}

export async function markdownToBlocks(md: string): Promise<PartialBlock[]> {
  return await getParser().tryParseMarkdownToBlocks(md);
}

export async function blocksToMarkdown(blocks: readonly unknown[]): Promise<string> {
  return getParser().blocksToMarkdownLossy(blocks as any);
}

/**
 * Parse stored document content into BlockNote blocks.
 * Handles: BlockNote JSON array (current), Lexical JSON (legacy), empty.
 */
export async function contentToBlocks(content: string): Promise<PartialBlock[]> {
  if (!content || content === "{}" || content === "[]") return [];
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return await markdownToBlocks(content);
  }
  if (Array.isArray(parsed)) return parsed as PartialBlock[];
  if (parsed?.root) return await markdownToBlocks(lexicalToMarkdown(parsed));
  return [];
}

function inlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === "string" ? c : c?.text ?? inlineText(c?.content)))
      .join("");
  }
  return "";
}

/** Extract plain text from blocks (for FTS + word count). */
export function blocksToText(blocks: readonly unknown[]): string {
  const lines: string[] = [];
  const walk = (bs: any[]) => {
    for (const b of bs ?? []) {
      // Custom Mermaid blocks store their searchable source in props rather
      // than inline content.
      const line = b.type === "mermaid" ? inlineText(b.props?.code) : inlineText(b.content);
      if (line) lines.push(line);
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks as any[]);
  return lines.join("\n");
}

/** Serialize an editor's document for storage. */
export function editorToStorage(editor: BlockNoteEditor<any, any, any>): {
  content: string;
  contentText: string;
  wordCount: number;
} {
  const blocks = editor.document;
  const contentText = blocksToText(blocks);
  const wordCount = contentText.trim() ? contentText.trim().split(/\s+/).length : 0;
  return { content: JSON.stringify(blocks), contentText, wordCount };
}

/** Serialize already-parsed blocks without requiring a mounted editor. */
export function blocksToStorage(blocks: readonly unknown[]) {
  const contentText = blocksToText(blocks);
  const wordCount = contentText.trim() ? contentText.trim().split(/\s+/).length : 0;
  return { content: JSON.stringify(blocks), contentText, wordCount };
}
