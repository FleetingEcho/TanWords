/** Tidies Markdown source without reinterpreting it.
 *
 *  Deliberately not a round trip through a parser. The app already has one —
 *  `markdownToBlocks` / `blocksToMarkdownLossy`, which raw↔rich mode switching
 *  uses — but its own name says what it does to anything the block schema
 *  cannot express. Switching modes is a choice to view the document another
 *  way; pressing "format" is a request to tidy the text, and it must not be
 *  able to delete a line. So this works on the source itself and only ever
 *  adjusts whitespace and list markers.
 *
 *  What it will not do, for the same reason: reflow paragraphs (it would
 *  destroy deliberate line breaks), align tables (needs real parsing to be
 *  safe), or touch anything inside a fenced code block.
 */

/** A fence opener, capturing indentation and the run of ` or ~ that has to be
 *  matched (or exceeded) to close it. */
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
/** A heading, already written correctly: hashes, whitespace, text. The run of
 *  hashes must end at a non-hash, or `### x` could be read as two hashes
 *  followed by text that happens to start with one. */
const HEADING_RE = /^([ \t]*)(#{1,6})(?!#)[ \t]+(.*)$/;
/** ...and one missing its space. The character after the hashes has to be
 *  neither whitespace nor another hash: without excluding the hash, the regex
 *  backtracks on a *correct* heading — `### x` matches as `##` + `# x` — and
 *  "repairing" it inserts a space mid-run. Formatting twice then grew another
 *  hash, and again on every run after that. */
const HEADING_NO_SPACE_RE = /^([ \t]*)(#{1,6})(?!#)([^\s#].*)$/;
/** Hashes and nothing else is an empty heading, and already well-formed. */
const HEADING_BARE_RE = /^[ \t]*#{1,6}[ \t]*$/;
const THEMATIC_BREAK_RE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:_\s*){3,}|(?:-\s*){3,})$/;
const BULLET_RE = /^(\s*)([*+-])([ \t]+)(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,9})([.)])([ \t]+)(.*)$/;

/** Two trailing spaces are a hard line break — the one piece of trailing
 *  whitespace that means something. Anything else goes; three or more collapse
 *  to the two that were presumably intended. */
function trimTrailing(line: string): string {
  const body = line.replace(/[ \t]+$/, "");
  if (!body) return "";
  return /[ ]{2,}$/.test(line) ? `${body}  ` : body;
}

export function formatMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  /** The fence currently open, if any: its marker run and indentation. */
  let fence: { marker: string; indent: string } | null = null;
  /** Indices in `out` that are fence interiors — off-limits to every later
   *  pass (see `renumberOrderedLists`). */
  const fenceInterior = new Set<number>();
  /** Set by anything that wants a blank line after it. Applied lazily, when
   *  the next content arrives, so it never leaves a blank line at the end. */
  let separate = false;

  /** One blank line separates blocks; more is never meaningful, and one at the
   *  very top of the file is not a separator at all. */
  const emit = (line: string) => {
    if (separate && out.length && out[out.length - 1] !== "") out.push("");
    separate = false;
    out.push(line);
  };
  /** A heading, rule or fence wants air on both sides. */
  const emitBlock = (line: string) => {
    separate = true;
    emit(line);
    separate = true;
  };

  for (const original of lines) {
    if (fence) {
      // Fence interiors are copied byte-for-byte — the module contract says
      // nothing inside a fenced code block is ever touched (diffs, Python
      // blank-line structure and trailing-space-significant content would
      // all be silently altered otherwise). Each interior line is tagged so
      // `renumberOrderedLists` (which runs over the whole output) can tell
      // fence content from prose.
      out.push(original);
      fenceInterior.add(out.length - 1);
      const closing = original.match(FENCE_RE);
      if (closing && closing[2][0] === fence.marker[0] && closing[2].length >= fence.marker.length && !closing[3].trim()) {
        fence = null;
        separate = true;
      }
      continue;
    }

    const opening = original.match(FENCE_RE);
    if (opening) {
      separate = true;
      emit(trimTrailing(original));
      fence = { marker: opening[2], indent: opening[1] };
      continue;
    }

    const line = trimTrailing(original);

    if (!line) {
      separate = true;
      continue;
    }

    if (THEMATIC_BREAK_RE.test(line)) {
      emitBlock("---");
      continue;
    }

    // Well-formed first, so a correct heading is only ever re-spaced — never
    // re-read as a broken one.
    const heading = line.match(HEADING_RE);
    if (heading) {
      emitBlock(`${heading[1]}${heading[2]} ${heading[3].trimEnd()}`);
      continue;
    }
    if (HEADING_BARE_RE.test(line)) {
      emitBlock(line.trimEnd());
      continue;
    }
    // `#Heading` is a heading in most renderers but a paragraph in CommonMark,
    // which needs the space. Adding it is the fix the author meant.
    const unspaced = line.match(HEADING_NO_SPACE_RE);
    if (unspaced) {
      emitBlock(`${unspaced[1]}${unspaced[2]} ${unspaced[3]}`);
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      emit(`${bullet[1]}- ${bullet[4]}`);
      continue;
    }

    const ordered = line.match(ORDERED_RE);
    if (ordered) {
      emit(`${ordered[1]}${ordered[2]}${ordered[3]} ${ordered[5]}`);
      continue;
    }

    emit(line);
  }

  renumberOrderedLists(out, fenceInterior);

  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? `${out.join("\n")}\n` : "";
}

/** A block-level element wants a blank line above it, unless it starts the file. */
function pushBlankBefore(out: string[], pushBlank: () => void) {
  if (out.some((line) => line.trim())) pushBlank();
}

/** Renumbers each run of ordered items sequentially from the run's own first
 *  number, so `1. / 1. / 1.` becomes `1. / 2. / 3.` and a list that starts at
 *  3 keeps starting at 3. A run ends at any non-blank line that is not an item
 *  at the same indent — a blank line alone does not end it, because a loose
 *  list is still one list. Lines inside fenced code blocks are skipped: pasted
 *  configs/changelogs that use `1.` repeatedly (or non-sequential numbers)
 *  are *code*, and renumbering them silently alters the user's content. */
function renumberOrderedLists(lines: string[], fenceInterior: ReadonlySet<number>) {
  let index = 0;
  while (index < lines.length) {
    if (fenceInterior.has(index)) {
      index += 1;
      continue;
    }
    const start = lines[index].match(ORDERED_RE);
    if (!start) {
      index += 1;
      continue;
    }
    const indent = start[1];
    const delimiter = start[3];
    let next = Number(start[2]);
    let cursor = index;
    let lastItem = index;
    while (cursor < lines.length) {
      const line = lines[cursor];
      // Fence interiors (e.g. a code block indented inside a list item) are
      // opaque: skip without reading or renumbering them.
      if (fenceInterior.has(cursor)) {
        cursor += 1;
        continue;
      }
      if (!line.trim()) {
        cursor += 1;
        continue;
      }
      const item = line.match(ORDERED_RE);
      if (item && item[1] === indent && item[3] === delimiter) {
        lines[cursor] = `${indent}${next}${delimiter} ${item[5]}`;
        next += 1;
        lastItem = cursor;
        cursor += 1;
        continue;
      }
      // Indented continuation text or a nested list belongs to the item above.
      if (line.startsWith(`${indent} `) || line.startsWith(`${indent}\t`)) {
        cursor += 1;
        continue;
      }
      break;
    }
    index = lastItem + 1;
  }
}
