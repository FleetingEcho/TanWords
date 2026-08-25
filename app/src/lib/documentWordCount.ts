/**
 * Human-facing document word count.
 *
 * Whitespace splitting treats an entire Chinese paragraph as one word. For
 * CJK text the useful convention is one written character per count; the
 * remaining alphabetic/numeric text is counted in word-like runs. Punctuation
 * and symbols do not contribute on their own.
 */
const CJK_CHARACTER_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD_RUN_RE = /[\p{L}\p{M}\p{N}_]+(?:['’\-][\p{L}\p{M}\p{N}_]+)*/gu;

export function countDocumentWords(text: string): number {
  let cjkCharacters = 0;
  const nonCjk = text.replace(CJK_CHARACTER_RE, () => {
    cjkCharacters += 1;
    return " ";
  });
  return cjkCharacters + (nonCjk.match(WORD_RUN_RE)?.length ?? 0);
}
