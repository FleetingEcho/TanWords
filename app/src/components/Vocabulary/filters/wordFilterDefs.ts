/** Shared vocabulary for the Words filter bar: the chip/picker value lists,
 *  the persisted "working set" of filters, and the compact count format the
 *  tier-1 chips use.
 *
 *  Why a versioned localStorage snapshot: at a multi-thousand-word library
 *  the user lives INSIDE a filtered working set (e.g. "learning, C1–B2,
 *  sorted due-first") and expects to reopen exactly there. Search text and
 *  the date range are deliberately NOT persisted — reopening into a stale
 *  search reads as "my words vanished". */

import type { EnrichFilter, WordStatus } from "@/hooks/useDB";
import type { LevelValue } from "@/components/shared/LevelDateFilter";

/** v2: adds `scenes` (scenario keys). A v1 snapshot loads clean — unknown
 *  fields drop to defaults, so no migration step is needed. */
export const WORD_FILTER_STORAGE_KEY = "vocab-words-filters-v2";

/** Multi-select level chip buckets — the same four LevelDateFilter offers. */
export const WORD_LEVEL_VALUES: LevelValue[] = ["C2", "C1", "B2", "B1-"];

/** All three learning states, in pipeline order. */
export const WORD_STATUS_VALUES: WordStatus[] = ["learning", "familiar", "mastered"];

/** Known words.source values — labels live under the vocab.source.* keys.
 *  (Moved out of LevelDateFilter when the Words filter bar absorbed the
 *  vocabulary-only filter dimensions.) */
export const WORD_SOURCE_VALUES = [
  "manual", "ai", "chat", "batch", "discover", "seed", "knowledge-map", "scene-lab",
  "scenario",
] as const;

/** The persisted working set. Every field is sanitized on load, so a stale
 *  or hand-edited snapshot can never wedge the list behind a bogus filter —
 *  unknown values drop back to "no constraint on that axis". */
export interface PersistedWordFilters {
  levels: LevelValue[];
  statuses: WordStatus[];
  starred: boolean;
  enrichFilter: EnrichFilter;
  dueOnly: boolean;
  source: string;
  tags: string[];
  /** Selected scenarios (scenario_key values) — ANY-match, same as tags. */
  scenes: string[];
}

export const DEFAULT_WORD_FILTERS: PersistedWordFilters = {
  levels: [],
  statuses: [],
  starred: false,
  enrichFilter: "all",
  dueOnly: false,
  source: "all",
  tags: [],
  scenes: [],
};

/** Deduplicated, order-preserving filter of an unknown value down to the
 *  allowed enum — the sanitizer for every multi-select chip axis. */
function cleanEnumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of value) {
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v as T);
  }
  return out;
}

/** Category tags are free text: keep them strings, strip the quote char the
 *  SQL LIKE probe can't carry (mirrors the write-side stripping in
 *  db_set_word_tags), cap pathological payloads — this came from disk, not
 *  from a chip, so it can contain anything. */
function cleanTags(value: unknown): string[] {
  return cleanKeys(value, 80, 50);
}

/** Scenario keys are registry-controlled ("dining.cafe") but still arrive
 *  from localStorage, which can hold anything: sanitize to non-empty
 *  lowercase dotted strings, dedupe, cap. Same shape as cleanTags with a
 *  tighter charset — keys must match the registry exactly, so anything
 *  else would silently filter the list to nothing (the "my words
 *  vanished" scare). */
function cleanSceneKeys(value: unknown): string[] {
  return cleanKeys(value, 100, 30).filter((k) => /^[a-z0-9][a-z0-9.-]*$/.test(k));
}

/** Shared sanitizer for free-form key arrays (tags, scene keys). */
function cleanKeys(value: unknown, maxLen: number, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const tag = v.replace(/"/g, "").trim().slice(0, maxLen);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function loadWordFilters(): PersistedWordFilters {
  let raw: unknown = null;
  try {
    const s = localStorage.getItem(WORD_FILTER_STORAGE_KEY);
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null; // corrupt JSON, or storage unavailable (private mode)
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    levels: cleanEnumArray(obj.levels, WORD_LEVEL_VALUES),
    statuses: cleanEnumArray(obj.statuses, WORD_STATUS_VALUES),
    starred: obj.starred === true,
    enrichFilter: obj.enrichFilter === "enriched" || obj.enrichFilter === "raw" ? obj.enrichFilter : "all",
    dueOnly: obj.dueOnly === true,
    // Strict to the known source set: a stale value would filter the list to
    // nothing and look like data loss.
    source: typeof obj.source === "string" && (WORD_SOURCE_VALUES as readonly string[]).includes(obj.source)
      ? obj.source
      : "all",
    tags: cleanTags(obj.tags),
    scenes: cleanSceneKeys(obj.scenes),
  };
}

export function persistWordFilters(f: PersistedWordFilters): void {
  try {
    localStorage.setItem(WORD_FILTER_STORAGE_KEY, JSON.stringify(f));
  } catch {
    // Storage full/unavailable — filters stay session-only, nothing breaks.
  }
}

/** 10k-scale chip counts: 1345 → "1.3k", 12000 → "12k". Keeps tier-1 chips
 *  narrow; exact numbers live in the status popover rows and tooltips. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
