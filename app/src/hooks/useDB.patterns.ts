import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError, reportWriteError } from "./useDB.errors";

export interface PatternExampleItem { id: number; sentence: string; source: string }
export interface PatternItem {
  id: number;
  pattern: string;
  zh: string;
  note: string;
  level: string | null;
  created_at: string;
  examples: PatternExampleItem[];
}
export interface SavePatternResult { pattern_id: number; created: boolean }

export function useDBPatterns() {
  const listPatterns = useCallback(async (): Promise<PatternItem[]> => {
    try { return await invoke("db_list_patterns"); }
    catch (e) { logError("listPatterns", e); return []; }
  }, []);
  const deletePattern = useCallback(async (patternId: number): Promise<boolean> => {
    try { await invoke("db_delete_pattern", { patternId }); return true; }
    catch (e) { reportWriteError("deletePattern", e, "删除句式失败"); return false; }
  }, []);
  const saveSentencePattern = useCallback(async (
    sentence: string, zh: string, skeleton: string, note: string, level: string, source: string
  ): Promise<SavePatternResult | null> => {
    try { return await invoke("db_save_sentence_pattern", { sentence, zh, skeleton, note, level, source }); }
    catch (e) { reportWriteError("saveSentencePattern", e, "收藏句式失败"); return null; }
  }, []);
  return useMemo(() => ({ listPatterns, deletePattern, saveSentencePattern }), [listPatterns, deletePattern, saveSentencePattern]);
}
