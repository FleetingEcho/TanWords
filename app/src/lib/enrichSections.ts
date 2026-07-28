/**
 * Splits a word's freeform AI explanation into navigable sections.
 *
 * The enrich prompt (providers/base.ts DEFAULT_ENRICH_SYSTEM_PROMPT) deliberately
 * leaves the structure up to the model — "该长则长，该短则短" — so what comes back
 * is a long markdown document whose topics differ per word. Rendered as one flat
 * column that is unscannable: the word page splits it here so every topic gets a
 * heading treatment and a jump target, and the reader can go straight to
 * 常见搭配 or 易混淆点 without scrolling past everything else.
 *
 * Two heading conventions are recognised because models mix them freely under the
 * same prompt: ATX headings (`### 常见搭配`) and a bold line standing alone as its
 * own paragraph (`**常见搭配：**`). ATX wins when present — only the shallowest
 * level splits, so deeper headings stay inside the body as sub-headings — and the
 * bold-line form is the fallback for documents with no ATX headings at all.
 *
 * Runs against partially streamed text on every chunk, so it stays a single
 * linear scan with no lookahead beyond the current line.
 */

export interface EnrichSection {
  /** Stable across streaming: sections only ever append, never reorder */
  id: string;
  /** Heading as written (may carry inline markdown) — rendered in the section header */
  title: string;
  /** Heading with inline markdown and ordinal prefixes stripped — the jump-nav label */
  label: string;
  body: string;
}

export interface EnrichOutline {
  /** Everything before the first heading — usually the core definition */
  lead: string;
  sections: EnrichSection[];
}

const ATX_RE = /^(#{1,4})\s+(.+?)\s*$/;
/** A whole line that is nothing but bold text, optionally closed by a colon */
const BOLD_LINE_RE = /^\*\*(.+?)\*\*[：:]?\s*$/;

/** Reduces a heading to a nav chip: drops emphasis/highlight/code delimiters, the
 * `1.` / `一、` ordinals models like to prefix numbered sections with (the nav
 * conveys order by position already), and everything after a colon.
 *
 * That last one matters more than it looks — models habitually write
 * `### 易混淆点：Simmer vs. Boil vs. Stew`, where the head is the topic and the
 * tail is a subtitle. Chips are scanned at a glance, so only the head earns the
 * space; the full heading still renders above the section itself. */
function toLabel(title: string): string {
  const plain = title
    .replace(/`([^`]*)`/g, "$1")
    .replace(/==([^=]*)==/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/^\s*(?:\d+[.、)]|[一二三四五六七八九十]+[、.)])\s*/, "")
    .trim();
  const head = plain.split(/[：:]/)[0].trim();
  return head.length >= 2 ? head : plain.replace(/[：:]\s*$/, "").trim();
}

export function parseEnrichOutline(text: string): EnrichOutline {
  const lines = text.split("\n");

  // Pick the split level first: the shallowest ATX heading in the document, so a
  // doc written entirely in `###` splits on `###` while one that opens with `##`
  // keeps its `###` as sub-headings inside the body.
  let splitLevel = 0;
  for (const line of lines) {
    const m = line.match(ATX_RE);
    if (m && (splitLevel === 0 || m[1].length < splitLevel)) splitLevel = m[1].length;
  }

  const headingAt = (line: string): string | null => {
    const atx = line.match(ATX_RE);
    if (atx) return atx[1].length === splitLevel ? atx[2] : null;
    // Bold-line headings are a fallback for models that never emit ATX at all;
    // in a document that does use ATX they are emphasis inside a section, not a
    // section of their own.
    if (splitLevel > 0) return null;
    const bold = line.match(BOLD_LINE_RE);
    return bold ? bold[1] : null;
  };

  const leadLines: string[] = [];
  const sections: EnrichSection[] = [];
  let current: { title: string; body: string[] } | null = null;
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;

    const title = inFence ? null : headingAt(line);
    if (title !== null) {
      if (current) {
        sections.push({
          id: `enrich-sec-${sections.length}`,
          title: current.title,
          label: toLabel(current.title),
          body: current.body.join("\n").trim(),
        });
      }
      current = { title, body: [] };
      continue;
    }

    if (current) current.body.push(line);
    else leadLines.push(line);
  }

  if (current) {
    sections.push({
      id: `enrich-sec-${sections.length}`,
      title: current.title,
      label: toLabel(current.title),
      body: current.body.join("\n").trim(),
    });
  }

  return { lead: leadLines.join("\n").trim(), sections };
}
