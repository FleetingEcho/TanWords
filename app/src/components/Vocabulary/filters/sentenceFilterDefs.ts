/** Persisted filter working set for the Sentences tab — same contract as
 *  wordFilterDefs (vocab-words-filters-v1): layout filters that describe a
 *  pile you come back to (level chips, starred, source, sort) survive
 *  restarts; the lookup instruments (search text, date range) always start
 *  fresh. Loaded state is sanitized against whitelists so a stale/corrupted
 *  key degrades to defaults instead of rendering nonsense. */

import type { SentenceSortBy } from "@/hooks/useDB.sentences";
import { WORD_LEVEL_VALUES } from "./wordFilterDefs";
import type { LevelValue } from "@/components/shared/LevelDateFilter";

export const SENTENCE_FILTER_STORAGE_KEY = "vocab-sentences-filters-v1";
export const SENTENCE_LEVEL_VALUES = WORD_LEVEL_VALUES;

const SORT_VALUES: SentenceSortBy[] = ["recent", "alpha"];

export interface PersistedSentenceFilters {
  levels: LevelValue[];
  starredOnly: boolean;
  /** "all" or one observed source value (facets carry the current list). */
  source: string;
  sortBy: SentenceSortBy;
  sortDesc: boolean;
}

export const DEFAULT_SENTENCE_FILTERS: PersistedSentenceFilters = {
  levels: [],
  starredOnly: false,
  source: "all",
  sortBy: "recent",
  sortDesc: true,
};

export function loadSentenceFilters(): PersistedSentenceFilters {
  try {
    const raw = localStorage.getItem(SENTENCE_FILTER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SENTENCE_FILTERS };
    const p = JSON.parse(raw) as Partial<PersistedSentenceFilters> | null;
    if (!p || typeof p !== "object") return { ...DEFAULT_SENTENCE_FILTERS };
    return {
      levels: Array.isArray(p.levels)
        ? p.levels.filter((v): v is LevelValue => SENTENCE_LEVEL_VALUES.includes(v as LevelValue))
        : [],
      starredOnly: p.starredOnly === true,
      source:
        typeof p.source === "string" && p.source.trim() && p.source.length <= 80
          ? p.source
          : "all",
      sortBy: SORT_VALUES.includes(p.sortBy as SentenceSortBy) ? (p.sortBy as SentenceSortBy) : "recent",
      sortDesc: p.sortDesc !== false,
    };
  } catch {
    return { ...DEFAULT_SENTENCE_FILTERS };
  }
}

export function persistSentenceFilters(f: PersistedSentenceFilters): void {
  try {
    localStorage.setItem(SENTENCE_FILTER_STORAGE_KEY, JSON.stringify(f));
  } catch {
    // Full/private storage must never break filtering.
  }
}
