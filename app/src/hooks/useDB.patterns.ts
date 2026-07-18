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

export function useDBPatterns() {
  const listPatterns = useCallback(async (): Promise<PatternItem[]> => {
    try { return await invoke("db_list_patterns"); }
    catch (e) { logError("listPatterns", e); return []; }
  }, []);
  const deletePattern = useCallback(async (patternId: number): Promise<boolean> => {
    try { await invoke("db_delete_pattern", { patternId }); return true; }
    catch (e) { reportWriteError("deletePattern", e, "删除句式失败"); return false; }
  }, []);
  return useMemo(() => ({ listPatterns, deletePattern }), [listPatterns, deletePattern]);
}
