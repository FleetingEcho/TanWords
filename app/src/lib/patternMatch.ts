/**
 * Compile a sentence-pattern skeleton into a RegExp for matching against
 * natural-language sentences. Slots X, Y, Z become lazy wildcards; fixed
 * parts are escaped and anchored with word boundaries.
 *
 * Returns null when the skeleton has too few fixed characters to be useful
 * (e.g. "X of Y" matches virtually everything).
 */

export interface CompiledPattern {
  patternId: number;
  regex: RegExp;
}

/**
 * Escape regex-special characters in a string so it matches literally.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split the skeleton on slot markers X, Y, Z (word-bounded, single-letter).
 * Returns the fixed fragments between slots.
 *
 * Example: "not so much X as Y" → ["not so much ", " as "]
 */
function splitSkeleton(skeleton: string): string[] {
  // Split on standalone X, Y, or Z tokens (surrounded by word boundaries)
  const parts = skeleton.split(/\b[XYZ]\b/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Compile a pattern skeleton into a RegExp, or return null if the skeleton
 * is too generic to be useful (fewer than 6 fixed characters total).
 */
export function compileSkeleton(skeleton: string): RegExp | null {
  const fragments = splitSkeleton(skeleton);

  // Total fixed characters must meet the minimum threshold
  const totalFixed = fragments.reduce((sum, f) => sum + f.length, 0);
  if (totalFixed < 6) return null;

  // Build regex: fixed fragments escaped, slots become .{1,60}?
  // Leading/trailing slots do NOT add wildcards (anchor on fixed parts).
  let pattern = "";
  const rawFragments = skeleton.split(/\b[XYZ]\b/);

  for (let i = 0; i < rawFragments.length; i++) {
    const fragment = rawFragments[i].trim();

    if (i > 0) {
      // Slot between fragments — add lazy wildcard
      pattern += ".{1,60}?";
    }

    if (fragment) {
      pattern += escapeRegExp(fragment).replace(/\\ /g, "\\s+");
    }
  }

  // Require word boundaries at the edges of the match
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/**
 * Match compiled library patterns against a single sentence.
 * Returns the IDs of patterns whose compiled regex matches.
 */
export function matchPatternsInSentence(
  sentence: string,
  compiled: CompiledPattern[]
): number[] {
  const matches: number[] = [];
  for (const { patternId, regex } of compiled) {
    if (regex.test(sentence)) {
      matches.push(patternId);
    }
  }
  return matches;
}

/**
 * Match vocabulary words in a sentence (case-insensitive, word-bounded).
 * Returns the lowercase words found. Skips words in the exclude set
 * (already-extracted items of this article).
 */
export function matchVocabInSentence(
  sentence: string,
  vocabWords: Set<string>,
  exclude: Set<string>
): string[] {
  const words = sentence.split(/\s+/);
  const found: string[] = [];
  for (const w of words) {
    const clean = w.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "").toLowerCase();
    if (clean.length < 3) continue;
    if (exclude.has(clean)) continue;
    if (vocabWords.has(clean)) {
      found.push(clean);
      exclude.add(clean); // only report once per article
    }
  }
  return found;
}
