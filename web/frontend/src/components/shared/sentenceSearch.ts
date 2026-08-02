import type { PatternItem } from "@/hooks/useDB.patterns";

export function filterSentencePatterns(items: PatternItem[], query: string): PatternItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return items.filter((pattern) => {
    const searchable = [
      pattern.pattern,
      pattern.zh,
      pattern.note,
      ...pattern.examples.map((example) => example.sentence),
    ].join(" ").toLowerCase();
    return tokens.every((token) => searchable.includes(token));
  });
}
