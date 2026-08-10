/** Reading and editing the documents' `tags` column, which is a JSON string
 *  array. Kept apart from DocumentTagBar so the rules are testable without
 *  dragging the editor's React tree (and the theme store behind it) into a
 *  unit test. */

/** Longest tag we will store. Chips live on a 92px list row; past this they
 *  stop being a label and start being a sentence. */
export const MAX_TAG_LENGTH = 32;

/** Tolerant of the malformed and the legacy, the same way DocItem's parse is —
 *  an MCP or AI client can write this column, so it can hold anything. */
export function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

/** Trim, clamp, and drop anything that would collide with a tag already on the
 *  document. Case-insensitive: "Work" and "work" are one tag, and the copy
 *  already present wins so an existing chip never silently re-cases itself.
 *  Returns the original array unchanged when there is nothing to add, which is
 *  what lets the caller skip a pointless write. */
export function addTag(existing: string[], candidate: string): string[] {
  const tag = candidate.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
  if (!tag) return existing;
  if (existing.some((item) => item.toLowerCase() === tag.toLowerCase())) return existing;
  return [...existing, tag];
}
