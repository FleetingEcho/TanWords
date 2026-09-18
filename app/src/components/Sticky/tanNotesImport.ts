/** tanNotes → TanNotes stickies conversion (plan §4.6).
 *
 *  tanNotes stored Tiptap ProseMirror JSON — the SAME vocabulary TanNotes'
 *  blockAdapter speaks — so conversion is `pmDocToBlocks` plus two fixups:
 *  tanNotes' image attr is `src` (TanNotes: `url`), and tanNotes timestamps
 *  are epoch milliseconds (TanNotes: "YYYY-MM-DD HH:MM:SS", UTC — matching
 *  the core's `datetime('now')`).
 *
 *  Images are NOT resolved here: their srcs (data URIs, or relative paths
 *  into tanNotes' attachments dir) are collected and reported so the import
 *  flow can turn them into document assets AFTER the note rows exist and
 *  have TanNotes ids.
 */
import { pmDocToBlocks } from "@/components/Documents/tiptap/blockAdapter";
import { blocksToStorage } from "@/lib/docFormat";
import type { Block } from "@/components/Documents/tiptap/blocks";

export interface TanNotesConvertedNote {
  sourceId: string;
  title: string;
  content: string;
  contentText: string;
  wordCount: number;
  color: string;
  corner: string;
  opacity: number;
  alwaysOnTop: boolean;
  fontFamily: string | null;
  fontSize: number | null;
  collapsed: boolean;
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  /** Image srcs found in the doc (data URIs or attachment-relative paths). */
  images: string[];
}

/** tanNotes' `doc` is a PM `doc` node — the same shape blockAdapter consumes.
 *  Unknown tanNotes node types degrade to whatever `pmToBlock` does with them
 *  (text-only rendering), which is the plan's "unmappable content degrades
 *  gracefully" rule. */
function pmToBlocks(docJson: string, noteId: string, images: string[]): Block[] {
  let doc: unknown;
  try {
    doc = JSON.parse(docJson);
  } catch {
    return [];
  }
  const blocks = pmDocToBlocks(doc as never);
  const fixImages = (list: Block[]) => {
    for (const block of list) {
      if (block.type === "image" && block.props) {
        const src = block.props.src;
        if (typeof src === "string" && src) {
          if (!block.props.url) block.props.url = src;
          images.push(src);
        }
        delete block.props.src;
      }
      if (block.children?.length) fixImages(block.children);
    }
  };
  fixImages(blocks);
  void noteId;
  return blocks;
}

/** tanNotes timestamps are epoch millis; TanNotes stores UTC
 *  "YYYY-MM-DD HH:MM:SS". */
export function epochMsToStamp(ms: number | null | undefined): string {
  if (!ms) return "1970-01-01 00:00:00";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Same rule as the core's derive_title: first non-empty line, ≤80 chars. */
export function deriveTitle(plainText: string): string {
  for (const line of plainText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 80)}` : trimmed;
  }
  return "Imported note";
}

export function convertTanNotesNote(raw: {
  id: string;
  doc: string;
  plain_text: string;
  color: string;
  corner: string;
  opacity: number;
  always_on_top: boolean;
  font_family: string | null;
  font_size: number | null;
  collapsed: boolean;
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  is_open: boolean;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}): TanNotesConvertedNote {
  const images: string[] = [];
  const blocks = pmToBlocks(raw.doc, raw.id, images);
  const storage = blocksToStorage(blocks);
  return {
    sourceId: raw.id,
    title: deriveTitle(raw.plain_text),
    content: storage.content,
    contentText: storage.contentText,
    wordCount: storage.wordCount || raw.plain_text.split(/\s+/).filter(Boolean).length,
    color: raw.color || "yellow",
    corner: raw.corner || "rounded",
    opacity: Math.min(100, Math.max(10, raw.opacity || 100)),
    alwaysOnTop: raw.always_on_top,
    fontFamily: raw.font_family,
    fontSize: raw.font_size,
    collapsed: raw.collapsed,
    x: raw.x,
    y: raw.y,
    w: raw.w || 260,
    h: raw.h || 480,
    isOpen: raw.is_open,
    createdAt: epochMsToStamp(raw.created_at),
    updatedAt: epochMsToStamp(raw.updated_at),
    deleted: raw.deleted_at != null,
    images,
  };
}

/** Splits an image src into what the asset migrator needs. */
export function classifyImageSrc(src: string): { kind: "data"; mime: string; base64: string } | { kind: "attachment"; rel: string } | { kind: "leave" } {
  if (src.startsWith("data:")) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
    if (!match) return { kind: "leave" };
    const mime = match[1] || "image/png";
    const base64 = match[2] ? match[3] : btoa(unescape(encodeURIComponent(decodeURIComponent(match[3]))));
    return { kind: "data", mime, base64 };
  }
  if (/^https?:\/\//.test(src)) return { kind: "leave" }; // already remote
  if (src.startsWith("tanwords-asset://")) return { kind: "leave" }; // already ours
  // Everything else is tanNotes' attachments-relative form.
  return { kind: "attachment", rel: src.replace(/^\/+/, "") };
}
