/** Dashboard stats and search history — one of the domain hooks composed by
 *  useDB.extra.ts (see useDB.ts). (The SRS due-cards/review-card wrappers
 *  lived here too; they left with the Review tab, 2026-10-24. The Rust
 *  commands remain in the core, dormant.) */
import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { logError, reportWriteError } from "./useDB.errors";
import type { DashboardStats, SearchHistoryItem } from "./useDB.types";

export function useDBReview() {
  const getDashboardStats = useCallback(async (): Promise<DashboardStats | null> => {
    try {
      return await invoke<DashboardStats>("db_dashboard_stats");
    } catch (e) {
      logError("getDashboardStats", e);
      return null;
    }
  }, []);

  // ── Search history (Dictionary page recent lookups) ────────────────────

  const addSearchHistory = useCallback(async (word: string): Promise<void> => {
    try {
      await invoke("db_add_search_history", { word });
    } catch (e) {
      logError("addSearchHistory", e);
    }
  }, []);

  const getSearchHistory = useCallback(async (): Promise<SearchHistoryItem[]> => {
    try {
      return await invoke<SearchHistoryItem[]>("db_get_search_history");
    } catch (e) {
      logError("getSearchHistory", e);
      return [];
    }
  }, []);

  const clearSearchHistory = useCallback(async (): Promise<void> => {
    try {
      await invoke("db_clear_search_history");
    } catch (e) {
      reportWriteError("clearSearchHistory", e, "清空查询历史失败");
    }
  }, []);

  return useMemo(() => ({
    getDashboardStats,
    addSearchHistory, getSearchHistory, clearSearchHistory,
  }), [
    getDashboardStats,
    addSearchHistory, getSearchHistory, clearSearchHistory,
  ]);
}
