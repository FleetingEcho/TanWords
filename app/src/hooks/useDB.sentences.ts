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

export function useDBSentences() {
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
    () => ({ listSentences, deleteSentence, deleteSentencesBatch, saveSentence, updateSentence, setSentenceStarred }),
    [listSentences, deleteSentence, deleteSentencesBatch, saveSentence, updateSentence, setSentenceStarred]
  );
}
