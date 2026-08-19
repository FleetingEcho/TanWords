import type { SentenceItem } from "@/hooks/useDB.sentences";

export function filterSentencePatterns(items: SentenceItem[], query: string): SentenceItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return items.filter((s) => {
    const searchable = [
      s.sentence,
      s.zh,
      s.note,
      s.source,
    ].join(" ").toLowerCase();
    return tokens.every((token) => searchable.includes(token));
  });
}
