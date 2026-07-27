/**
 * Turning whatever is on the clipboard (or in a dropped file) into something
 * readable.
 *
 * Text copied out of a PDF, an email client or a slide deck is rarely clean
 * prose: it arrives hard-wrapped at some column width, hyphenated across line
 * breaks, sprinkled with page numbers, non-breaking spaces and zero-width
 * characters. Pasted as-is it reads badly, breaks sentence splitting (so the
 * selection toolbar can't find sentence boundaries) and wastes tokens when it
 * goes to the model.
 */

/** Lines that are just pagination furniture from a PDF or a printout. */
const PAGE_NOISE = /^(page\s+)?\d+(\s*\/\s*\d+|\s+of\s+\d+)?$/i;

/** A line ending in one of these is a real line ending, not a wrap. */
const SENTENCE_END = /[.!?:;。！？；:"'”’)\]]$/;

function normalizeChars(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")            // non-breaking space → space
    .replace(/[\u200b-\u200f\ufeff]/g, "") // zero-width and direction marks
    // Control characters other than tab/newline: these come from binary data
    // pasted by accident, and render as boxes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/**
 * Rejoins a paragraph that was hard-wrapped at a fixed column width, and
 * repairs words hyphenated across those breaks. A line is treated as wrapped
 * when it doesn't end like a sentence and the next line doesn't start like a
 * new one (bullet, heading, capital after a short line).
 */
function unwrapParagraph(block: string): string {
  const lines = block.split("\n").map((l) => l.trim()).filter((l) => l && !PAGE_NOISE.test(l));
  if (lines.length === 0) return "";

  let out = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prev = out;
    const isListItem = /^([-*•]|\d+[.)])\s/.test(line);
    const wrapped = !isListItem && !SENTENCE_END.test(prev);
    if (!wrapped) {
      out += "\n" + line;
    } else if (/[A-Za-z]-$/.test(prev)) {
      // "inter-\nnational" → "international"; only for a lowercase
      // continuation, so hyphenated compounds ("well-\nKnown Ltd") survive.
      out = /^[a-z]/.test(line) ? prev.slice(0, -1) + line : prev + line;
    } else {
      out += " " + line;
    }
  }
  return out;
}

/** Cleans clipboard or file text into readable prose. Safe to run twice. */
export function cleanPastedText(raw: string): string {
  const normalized = normalizeChars(raw);
  return normalized
    .split(/\n[ \t]*\n/)
    .map(unwrapParagraph)
    .filter(Boolean)
    .join("\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Whether this looks like text a person would read, as opposed to base64, a
 * data URL, minified JSON or the mojibake you get from pasting a binary file.
 * Used to refuse the paste with an explanation instead of opening a reader
 * full of garbage.
 */
export function isReadableText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 20) return false;

  const letters = (trimmed.match(/\p{L}/gu) ?? []).length;
  if (letters < 20 || letters / trimmed.length < 0.45) return false;

  // Real prose has spaces. Base64 blobs, data URLs and minified payloads run
  // for hundreds of characters without one.
  const longestRun = Math.max(...trimmed.split(/\s+/).map((w) => w.length));
  if (longestRun > 120) return false;

  const words = trimmed.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w));
  return words.length >= 5;
}

/**
 * Strips Markdown syntax down to the prose underneath — headings, emphasis,
 * link/image syntax, list bullets, table rules. The reader renders plain
 * paragraphs, and a `##` or a `**` left in place would be read aloud by TTS
 * and picked up as vocabulary.
 */
export function markdownToPlainText(md: string): string {
  return normalizeChars(md)
    .replace(/^---\n[\s\S]*?\n---\n/, "")        // YAML front matter
    .replace(/^```.*$/gm, "")                     // fence markers (keep the code)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")         // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")      // links → their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")           // headings
    .replace(/^\s{0,3}>\s?/gm, "")                // blockquote markers
    .replace(/^\s*\|?[\s:|-]{6,}\|?\s*$/gm, "")   // table rules and hr
    .replace(/^\s*([-*+])\s+/gm, "· ")            // bullets
    .replace(/(\*\*|__)(.*?)\1/g, "$2")           // bold
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2") // italic
    .replace(/`([^`]+)`/g, "$1")                  // inline code
    .trim();
}

/** True for the file types the paste-in reader can read. */
export function isSupportedTextFile(name: string): boolean {
  return /\.(txt|md|markdown|text)$/i.test(name);
}

/** Reads a .txt/.md file into clean prose. */
export async function textFromFile(file: File): Promise<string> {
  const raw = await file.text();
  const isMarkdown = /\.(md|markdown)$/i.test(file.name);
  return cleanPastedText(isMarkdown ? markdownToPlainText(raw) : raw);
}
