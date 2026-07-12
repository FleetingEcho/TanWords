export interface Sentence {
  text: string;
  start: number; // inclusive offset into the original text
  end: number; // exclusive offset into the original text
}

const ENDERS = new Set([".", "!", "?", "…"]);
const MAX_LEN = 300;

// Words whose trailing "." should not be treated as a sentence boundary.
// Multi-dot forms (e.g., "e.g", "i.e") are matched against the whole token
// immediately preceding the final dot, including its internal dots.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "no", "fig",
  "e.g", "i.e", "u.s", "u.k",
]);

/** Splits article text into sentences with precise offsets into the original
 * string (needed for click-to-jump and current-sentence highlighting).
 * Heuristic, not a full NLP splitter: protects common abbreviations and
 * decimals, forces a break on blank lines, and hard-cuts runaway sentences.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  const paragraphBreak = /\n[ \t\r]*\n[ \t\r\n]*/g;
  let paraStart = 0;
  let match: RegExpExecArray | null;
  const paraBounds: Array<[number, number]> = [];
  while ((match = paragraphBreak.exec(text))) {
    paraBounds.push([paraStart, match.index]);
    paraStart = match.index + match[0].length;
  }
  paraBounds.push([paraStart, text.length]);

  for (const [pStart, pEnd] of paraBounds) {
    splitParagraph(text, pStart, pEnd, sentences);
  }
  return sentences;
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

/** The token immediately before `idx` (exclusive), bounded by whitespace or
 * the start of the paragraph — used to test a dot-terminated word against
 * the abbreviation list. */
function precedingWord(text: string, from: number, idx: number): string {
  let start = idx;
  while (start > from && !/\s/.test(text[start - 1])) start--;
  return text.slice(start, idx);
}

function splitParagraph(text: string, pStart: number, pEnd: number, out: Sentence[]) {
  let sentenceStart = pStart;
  let i = pStart;

  while (i < pEnd) {
    const ch = text[i];

    if (ENDERS.has(ch)) {
      let j = i;
      while (j < pEnd && ENDERS.has(text[j])) j++;
      const followedByBoundary = j >= pEnd || isWhitespace(text[j]);

      if (followedByBoundary) {
        let isAbbrev = false;
        if (text[j - 1] === ".") {
          const word = precedingWord(text, pStart, i).toLowerCase().replace(/\.$/, "");
          const wordWithDot = precedingWord(text, pStart, i).toLowerCase();
          isAbbrev = ABBREVIATIONS.has(word) || ABBREVIATIONS.has(wordWithDot);
        }
        if (!isAbbrev) {
          pushSentence(text, sentenceStart, j, out);
          sentenceStart = j;
          i = j;
          continue;
        }
      }
      i = j;
      continue;
    }

    i++;
  }

  pushSentence(text, sentenceStart, pEnd, out);
}

function pushSentence(text: string, rawStart: number, rawEnd: number, out: Sentence[]) {
  let s = rawStart;
  let e = rawEnd;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (s < e) {
    splitLongSentence(text, s, e, out);
  }
}

function splitLongSentence(text: string, start: number, end: number, out: Sentence[]) {
  let s = start;
  while (end - s > MAX_LEN) {
    const cut = s + MAX_LEN;
    let boundary = cut;
    while (boundary > s && !/\s/.test(text[boundary])) boundary--;
    if (boundary === s) {
      boundary = cut; // no word boundary in range — hard cut
    }
    out.push({ text: text.slice(s, boundary), start: s, end: boundary });
    let next = boundary;
    while (next < end && /\s/.test(text[next])) next++;
    s = next;
  }
  if (s < end) {
    out.push({ text: text.slice(s, end), start: s, end });
  }
}
