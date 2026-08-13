/** Dashboard stats, SRS (spaced-repetition) review, and search history — one
 *  of the domain hooks composed by useDB.extra.ts (see useDB.ts). */
import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { logError, reportWriteError } from "./useDB.errors";
import type { DashboardStats, DueCard, ReviewResult, SrsRating, SearchHistoryItem } from "./useDB.types";

export function useDBReview() {
  const getDashboardStats = useCallback(async (): Promise<DashboardStats | null> => {
    try {
      return await invoke<DashboardStats>("db_dashboard_stats");
    } catch (e) {
      logError("getDashboardStats", e);
      return null;
    }
  }, []);

  // ── SRS review (spaced repetition) ─────────────────────────────────────

  const getDueCards = useCallback(async (newLimit?: number): Promise<DueCard[]> => {
    try {
      return await invoke<DueCard[]>("db_get_due_cards", { newLimit: newLimit ?? null });
    } catch (e) {
      logError("getDueCards", e);
      return [];
    }
  }, []);

  const reviewCard = useCallback(async (wordId: number, rating: SrsRating): Promise<ReviewResult | null> => {
    try {
      return await invoke<ReviewResult>("db_review_card", { wordId, rating });
    } catch (e) {
      reportWriteError("reviewCard", e, "记录复习结果失败");
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
    getDueCards, reviewCard,
    addSearchHistory, getSearchHistory, clearSearchHistory,
  }), [
    getDashboardStats,
    getDueCards, reviewCard,
    addSearchHistory, getSearchHistory, clearSearchHistory,
  ]);
}
