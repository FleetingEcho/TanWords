import { invoke } from "@tauri-apps/api/core";
import { serializeMarkedBatch, parseMarkedBatch } from "@/lib/markerBatch";

export interface HnComment {
  id: number;
  by: string | null;
  text: string;
  time: number | null;
  children: HnComment[];
}

export function fetchHnComments(storyId: number): Promise<HnComment[]> {
  return invoke<HnComment[]>("fetch_hn_comments", { storyId });
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'",
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#x27;|&#39;/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Flattens a comment tree into plain text for the "native usage" analysis prompt —
 *  capped so a mega-thread doesn't blow the prompt's token budget. */
export function flattenHnComments(comments: HnComment[], maxChars = 6000): string {
  const lines: string[] = [];
  let total = 0;
  const walk = (list: HnComment[]) => {
    for (const c of list) {
      if (total >= maxChars) return;
      const plain = stripHtml(c.text);
      if (plain) {
        lines.push(`- ${plain}`);
        total += plain.length;
      }
      walk(c.children);
    }
  };
  walk(comments);
  return lines.join("\n");
}

const URL_RE = /\bhttps?:\/\/\S+/gi;

/** Strips bare URLs and stray markdown/emphasis symbols left over after stripHtml
 *  — nobody wants "h-t-t-p-s colon slash slash..." read aloud character by
 *  character, and leftover `**`/`~~`/backticks just sound like noise. */
function cleanForSpeech(text: string): string {
  return text
    .replace(URL_RE, "")
    .replace(/[*_`~^]+/g, "")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** True if there's enough real, sayable content left to bother reading aloud —
 *  filters out comments that turn out to be just a link, an emoji, or symbol
 *  noise once cleaned (e.g. "> ", "🤣🤣🤣", or a comment that was only a URL). */
function hasSpeakableContent(text: string): boolean {
  const letters = text.replace(/[^\p{L}\p{N}]+/gu, "");
  return letters.length >= 3;
}

/** Flattens a comment tree into TTS-ready plain text — same traversal as
 *  flattenHnComments, but strips URLs and skips any comment that turns out to be
 *  just a link/symbols/noise once cleaned, so playback doesn't waste time on it. */
export function commentsToSpeechText(comments: HnComment[], maxChars = 6000): string {
  const parts: string[] = [];
  let total = 0;
  const walk = (list: HnComment[]) => {
    for (const c of list) {
      if (total >= maxChars) return;
      const cleaned = cleanForSpeech(stripHtml(c.text));
      if (cleaned && hasSpeakableContent(cleaned)) {
        parts.push(cleaned);
        total += cleaned.length;
      }
      walk(c.children);
    }
  };
  walk(comments);
  return parts.join(". ");
}

export function countHnComments(comments: HnComment[]): number {
  return comments.reduce((n, c) => n + 1 + countHnComments(c.children), 0);
}

/** Unique commenters — HN's APIs don't expose this directly, but the whole tree
 *  is already fetched to render/translate it, so it's free to derive. */
export function countHnCommentAuthors(comments: HnComment[], seen: Set<string> = new Set()): number {
  for (const c of comments) {
    if (c.by) seen.add(c.by);
    countHnCommentAuthors(c.children, seen);
  }
  return seen.size;
}

export interface FlatHnComment {
  id: number;
  by: string;
  depth: number;
  /** Set for replies (depth > 0) — who they're replying to, for a "replying to X" caption. */
  parentAuthor?: string;
  /** Number of direct + nested replies under this comment. */
  replyCount: number;
  text: string;
}

/** Same traversal as flattenHnComments, but keeps per-comment structure (author,
 *  depth, parent, reply count) instead of collapsing everything into one blob —
 *  so a translation can still be rendered comment-by-comment afterwards, the same
 *  way the live thread is (avatars, "replying to X", reply counts). */
export function flattenHnCommentsStructured(comments: HnComment[], maxChars = 6000): FlatHnComment[] {
  const result: FlatHnComment[] = [];
  let total = 0;
  const walk = (list: HnComment[], depth: number, parentAuthor?: string) => {
    for (const c of list) {
      if (total >= maxChars) return;
      const plain = stripHtml(c.text);
      const by = c.by || "";
      if (plain) {
        result.push({ id: c.id, by, depth, parentAuthor, replyCount: countHnComments(c.children), text: plain });
        total += plain.length;
      }
      walk(c.children, depth + 1, by || parentAuthor);
    }
  };
  walk(comments, 0);
  return result;
}

/** Serializes a flat comment list into one prompt-ready block, with a marker
 *  before each entry so the (translated) response can be split back apart by id. */
export function serializeCommentsForTranslation(flat: FlatHnComment[]): string {
  return serializeMarkedBatch(flat.map((c) => ({ key: String(c.id), text: c.text })));
}

/** Reverses serializeCommentsForTranslation: splits a translated response back into
 *  id -> translated text. Tolerant of stray content before the first marker or a
 *  missing trailing entry; a comment whose marker didn't survive just won't have
 *  a translation (caller falls back to the original text for it). */
export function parseTranslatedComments(raw: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const [key, text] of parseMarkedBatch(raw)) {
    const id = Number(key);
    if (!Number.isNaN(id)) map.set(id, text);
  }
  return map;
}
