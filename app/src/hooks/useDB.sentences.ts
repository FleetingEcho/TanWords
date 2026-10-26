import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { logError, reportWriteError } from "./useDB.errors";

/** A saved sentence — first-class, like a word. A flat row in the `sentences`
 *  table; the old patterns + pattern_examples duo (a template with child
 *  example sentences) is gone. */
export interface SentenceItem {
  id: number;
  sentence: string;
  zh: string;
  level: string | null;
  note: string;
  source: string;
  article_id: number | null;
  starred: boolean;
  created_at: string;
  updated_at: string;
}
export interface SaveSentenceResult { id: number; created: boolean }

/** Facet counts for the sentence filter bar — each axis skips its own
 *  constraint (same self-exclusion contract as WordFilterFacets), so a chip
 *  never zeroes itself but reflects every other active filter incl. search. */
export interface SentenceSourceCount {
  source: string;
  count: number;
}

export interface SentenceFacets {
  levelC2: number;
  levelC1: number;
  levelB2: number;
  /** B1 + A2 + A1 folded. */
  levelB1Below: number;
  starred: number;
  /** Observed sources with counts, biggest pile first — the source column is
   *  free-form, so the bar can't hard-code an enum. */
  sources: SentenceSourceCount[];
}

export type SentenceSortBy = "recent" | "alpha";

export interface SentencePage {
  items: SentenceItem[];
  total: number;
  /** Absent when the core predates facets — callers render null-faced bars
   *  (no counts) rather than fake zeros. */
  facets?: SentenceFacets;
}

export function useDBSentences() {
  /** Server-side filtered + paginated sentence list (the filter-bar path).
   *  Multi-token AND search, level buckets, starred, source, updated_at day
   *  range, sort recent/alpha. */
  const getSentencesPage = useCallback(
    async (opts: {
      search?: string;
      levels?: string[];
      starred?: boolean;
      source?: string;
      dateFrom?: string;
      dateTo?: string;
      sortBy?: SentenceSortBy;
      sortDesc?: boolean;
      page?: number;
      pageSize?: number;
    }): Promise<SentencePage> => {
      const pageSize = opts.pageSize ?? 20;
      try {
        return await invoke<SentencePage>("db_get_sentences_page", {
          search: opts.search || null,
          levels: opts.levels?.length ? opts.levels : null,
          starred: opts.starred ? true : null,
          source: opts.source && opts.source !== "all" ? opts.source : null,
          dateFrom: opts.dateFrom || null,
          dateTo: opts.dateTo || null,
          sortBy: opts.sortBy ?? "recent",
          sortDesc: opts.sortDesc ? true : null,
          limit: pageSize,
          offset: (opts.page ?? 0) * pageSize,
        });
      } catch (e) {
        logError("getSentencesPage", e);
        return { items: [], total: 0 };
      }
    },
    []
  );
  const listSentences = useCallback(async (): Promise<SentenceItem[]> => {
    try { return await invoke("db_list_sentences"); }
    catch (e) { logError("listSentences", e); return []; }
  }, []);
  const deleteSentence = useCallback(async (sentenceId: number): Promise<boolean> => {
    try { await invoke("db_delete_sentence", { sentenceId }); return true; }
    catch (e) { reportWriteError("deleteSentence", e, "删除句子失败"); return false; }
  }, []);
  const deleteSentencesBatch = useCallback(async (sentenceIds: number[]): Promise<boolean> => {
    try { await invoke("db_delete_sentences_batch", { sentenceIds }); return true; }
    catch (e) { reportWriteError("deleteSentencesBatch", e, "删除句子失败"); return false; }
  }, []);
  const saveSentence = useCallback(async (
    sentence: string, zh: string, note: string, level: string, source: string
  ): Promise<SaveSentenceResult | null> => {
    try { return await invoke("db_save_sentence", { sentence, zh, note, level, source }); }
    catch (e) { reportWriteError("saveSentence", e, "收藏句子失败"); return null; }
  }, []);
  const updateSentence = useCallback(async (
    sentenceId: number, zh: string, note: string, level: string
  ): Promise<boolean> => {
    try { await invoke("db_update_sentence", { sentenceId, zh, note, level }); return true; }
    catch (e) { reportWriteError("updateSentence", e, "更新句子失败"); return false; }
  }, []);
  const setSentenceStarred = useCallback(async (sentenceId: number, starred: boolean): Promise<boolean> => {
    try { await invoke("db_set_sentence_starred", { sentenceId, starred }); return true; }
    catch (e) { reportWriteError("setSentenceStarred", e, "标星失败"); return false; }
  }, []);
  return useMemo(
    () => ({ listSentences, getSentencesPage, deleteSentence, deleteSentencesBatch, saveSentence, updateSentence, setSentenceStarred }),
    [listSentences, getSentencesPage, deleteSentence, deleteSentencesBatch, saveSentence, updateSentence, setSentenceStarred]
  );
}
