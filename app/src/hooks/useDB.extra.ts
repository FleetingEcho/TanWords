/** AI Chat sessions, reading/articles, dashboard, SRS review, search history,
 *  and data management — see useDB.ts for the composed public hook,
 *  useDB.core.ts for vocabulary/translations/settings/documents. */

import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError, reportWriteError } from "./useDB.errors";
import {
  ChatSessionItem, ChatSessionDetail, ArticleListItem, ArticleDetail, NewExtractedItem,
  DashboardStats, DueCard, ReviewResult, SrsRating, SearchHistoryItem,
  PatternListItem, PatternDetail, NewPattern,
  RssFeedMeta, RssFeed, PracticeRecord,
} from "./useDB.types";

function serializeChatSession(s: {
  id: string; title: string; messages: string; systemPrompt: string;
  presetId: string; providerId: string; messageCount: number;
}) {
  return {
    id: s.id, title: s.title, messages: s.messages,
    systemPrompt: s.systemPrompt, presetId: s.presetId,
    providerId: s.providerId, messageCount: s.messageCount,
  };
}

export function useDBExtra() {
  const listChatSessions = useCallback(async (page = 0, limit = 100): Promise<ChatSessionItem[]> => {
    try {
      return await invoke<ChatSessionItem[]>("db_list_chat_sessions", { page, limit });
    } catch (e) {
      logError("listChatSessions", e);
      return [];
    }
  }, []);

  const getChatSession = useCallback(async (id: string): Promise<ChatSessionDetail | null> => {
    try {
      return await invoke<ChatSessionDetail | null>("db_get_chat_session", { id });
    } catch (e) {
      logError("getChatSession", e);
      return null;
    }
  }, []);

  const upsertChatSession = useCallback(async (s: {
    id: string;
    title: string;
    messages: string;
    systemPrompt: string;
    presetId: string;
    providerId: string;
    messageCount: number;
  }): Promise<void> => {
    try {
      await invoke("db_upsert_chat_session", serializeChatSession(s));
    } catch (e) {
      reportWriteError("upsertChatSession", e, "保存对话失败");
    }
  }, []);

  const deleteChatSession = useCallback(async (id: string): Promise<void> => {
    try {
      await invoke("db_delete_chat_session", { id });
    } catch (e) {
      reportWriteError("deleteChatSession", e, "删除对话失败");
    }
  }, []);

  const searchChatSessions = useCallback(async (query: string): Promise<ChatSessionItem[]> => {
    try {
      return await invoke<ChatSessionItem[]>("db_search_chat_sessions", { query });
    } catch (e) {
      logError("searchChatSessions", e);
      return [];
    }
  }, []);

  // ── Reading Lessons (articles + extracted items) ─────────────────────

  const saveArticleAnalysis = useCallback(
    async (
      title: string,
      sourceUrl: string,
      origin: string,
      content: string,
      items: NewExtractedItem[]
    ): Promise<number> => {
      try {
        return await invoke<number>("db_save_article_analysis", {
          title,
          sourceUrl,
          origin,
          content,
          itemsJson: JSON.stringify(items),
        });
      } catch (e) {
        // Caller (ReadingPage) already surfaces a toast with the specific
        // error message — just log here to avoid a duplicate toast.
        logError("saveArticleAnalysis", e);
        throw e;
      }
    },
    []
  );

  const getArticles = useCallback(async (page = 0, limit = 50): Promise<ArticleListItem[]> => {
    try {
      return await invoke<ArticleListItem[]>("db_get_articles", { page, limit });
    } catch (e) {
      logError("getArticles", e);
      return [];
    }
  }, []);

  const getArticle = useCallback(async (id: number): Promise<ArticleDetail | null> => {
    try {
      return await invoke<ArticleDetail>("db_get_article", { id });
    } catch (e) {
      logError("getArticle", e);
      return null;
    }
  }, []);

  const deleteArticle = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_delete_article", { id });
    } catch (e) {
      reportWriteError("deleteArticle", e, "删除文章失败");
    }
  }, []);

  const updateItemStatus = useCallback(async (id: number, status: string): Promise<void> => {
    try {
      await invoke("db_update_item_status", { id, status });
    } catch (e) {
      reportWriteError("updateItemStatus", e, "更新词条状态失败");
    }
  }, []);

  const addKnownWords = useCallback(async (words: string[], source = "marked"): Promise<void> => {
    try {
      await invoke("db_add_known_words", { words, source });
    } catch (e) {
      reportWriteError("addKnownWords", e, "标记已认识失败");
    }
  }, []);

  const getKnownWords = useCallback(async (): Promise<string[]> => {
    try {
      return await invoke<string[]>("db_get_known_words");
    } catch (e) {
      logError("getKnownWords", e);
      return [];
    }
  }, []);

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

  // ── Sentence patterns (句式库) ─────────────────────────────────────────
  // Rust side not implemented yet (Sonnet: migration v5 + commands) — until
  // then these fail gracefully like every other wrapper here.

  const addPattern = useCallback(async (p: NewPattern): Promise<number | null> => {
    try {
      return await invoke<number>("db_add_pattern", {
        pattern: p.pattern,
        zh: p.zh,
        note: p.note ?? "",
        level: p.level ?? null,
        functionTag: p.functionTag ?? "other",
        exampleJson: p.example ? JSON.stringify(p.example) : null,
      });
    } catch (e) {
      reportWriteError("addPattern", e, "收藏句式失败");
      return null;
    }
  }, []);

  const getPatterns = useCallback(async (functionTag?: string): Promise<PatternListItem[]> => {
    try {
      return await invoke<PatternListItem[]>("db_get_patterns", { functionTag: functionTag ?? null });
    } catch (e) {
      logError("getPatterns", e);
      return [];
    }
  }, []);

  const getPatternDetail = useCallback(async (id: number): Promise<PatternDetail | null> => {
    try {
      return await invoke<PatternDetail>("db_get_pattern_detail", { id });
    } catch (e) {
      logError("getPatternDetail", e);
      return null;
    }
  }, []);

  const savePatternAnalysis = useCallback(
    async (id: number, analysis: string, functionTag?: string): Promise<void> => {
      try {
        await invoke("db_update_pattern_analysis", { id, analysis, functionTag: functionTag ?? null });
      } catch (e) {
        reportWriteError("savePatternAnalysis", e, "保存句式分析失败");
      }
    },
    []
  );

  const deletePattern = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_delete_pattern", { id });
    } catch (e) {
      reportWriteError("deletePattern", e, "删除句式失败");
    }
  }, []);

  const addPatternExample = useCallback(async (
    patternId: number, sentence: string, source: string, articleId?: number
  ): Promise<number> => {
    try {
      return await invoke<number>("db_add_pattern_example", {
        patternId, sentence, source, articleId: articleId ?? null,
      });
    } catch (e) {
      reportWriteError("addPatternExample", e, "添加句式例句失败");
      return 0;
    }
  }, []);

  // ── Pattern Practice (造句练习) ──────────────────────────────────────────

  const addPractice = useCallback(async (
    patternId: number, sentence: string, verdict: string, feedback: string
  ): Promise<number> => {
    try {
      return await invoke<number>("db_add_practice", { patternId, sentence, verdict, feedback });
    } catch (e) {
      reportWriteError("addPractice", e, "保存练习记录失败");
      return 0;
    }
  }, []);

  const getPractice = useCallback(async (patternId: number, limit = 20): Promise<PracticeRecord[]> => {
    try {
      return await invoke<PracticeRecord[]>("db_get_practice", { patternId, limit });
    } catch (e) {
      logError("getPractice", e);
      return [];
    }
  }, []);

  const deletePractice = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_delete_practice", { id });
    } catch (e) {
      reportWriteError("deletePractice", e, "删除练习记录失败");
    }
  }, []);

  // ── RSS Feeds ────────────────────────────────────────────────────────────

  const addRssFeed = useCallback(async (
    url: string, title: string, siteLink: string, description: string
  ): Promise<number> => {
    try {
      return await invoke<number>("db_add_rss_feed", { url, title, siteLink, description });
    } catch (e) {
      reportWriteError("addRssFeed", e, "添加 RSS 源失败");
      return 0;
    }
  }, []);

  const getRssFeeds = useCallback(async (): Promise<RssFeed[]> => {
    try {
      return await invoke<RssFeed[]>("db_get_rss_feeds");
    } catch (e) {
      logError("getRssFeeds", e);
      return [];
    }
  }, []);

  const updateRssFeedTitle = useCallback(async (id: number, title: string): Promise<void> => {
    try {
      await invoke("db_update_rss_feed_title", { id, title });
    } catch (e) {
      reportWriteError("updateRssFeedTitle", e, "更新 RSS 源标题失败");
    }
  }, []);

  const deleteRssFeed = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_delete_rss_feed", { id });
    } catch (e) {
      reportWriteError("deleteRssFeed", e, "删除 RSS 源失败");
    }
  }, []);

  const fetchRssFeedMeta = useCallback(async (url: string): Promise<RssFeedMeta | null> => {
    try {
      return await invoke<RssFeedMeta>("fetch_rss", { url });
    } catch (e) {
      logError("fetchRssFeedMeta", e);
      return null;
    }
  }, []);

  // ── Data management (Settings › Data) ─────────────────────────────────

  const getDbPath = useCallback(async (): Promise<string> => {
    try {
      return await invoke<string>("db_get_db_path");
    } catch (e) {
      logError("getDbPath", e);
      return "";
    }
  }, []);

  const exportBackup = useCallback(async (dest: string): Promise<void> => {
    try {
      await invoke("db_export_backup", { dest });
    } catch (e) {
      reportWriteError("exportBackup", e, "导出备份失败");
      throw e;
    }
  }, []);

  /** Mounts a different SQLite file as the active DB (creating it if new). Caller must reload the app after this succeeds — every already-fetched page is stale. */
  const switchDbPath = useCallback(async (newPath: string): Promise<string> => {
    try {
      return await invoke<string>("db_switch_path", { newPath });
    } catch (e) {
      reportWriteError("switchDbPath", e, "切换数据库失败");
      throw e;
    }
  }, []);

  const clearTranslations = useCallback(async (): Promise<void> => {
    try {
      await invoke("db_clear_translations");
    } catch (e) {
      reportWriteError("clearTranslations", e, "清空翻译记录失败");
    }
  }, []);

  return useMemo(() => ({
    listChatSessions, getChatSession, upsertChatSession, deleteChatSession, searchChatSessions,
    saveArticleAnalysis, getArticles, getArticle, deleteArticle, updateItemStatus, addKnownWords, getKnownWords,
    getDashboardStats,
    getDueCards, reviewCard,
    addSearchHistory, getSearchHistory, clearSearchHistory,
    addPattern, getPatterns, getPatternDetail, savePatternAnalysis, deletePattern, addPatternExample,
    addPractice, getPractice, deletePractice,
    addRssFeed, getRssFeeds, updateRssFeedTitle, deleteRssFeed, fetchRssFeedMeta,
    getDbPath, exportBackup, switchDbPath, clearTranslations,
  }), [
    listChatSessions, getChatSession, upsertChatSession, deleteChatSession, searchChatSessions,
    saveArticleAnalysis, getArticles, getArticle, deleteArticle, updateItemStatus, addKnownWords, getKnownWords,
    getDashboardStats,
    getDueCards, reviewCard,
    addSearchHistory, getSearchHistory, clearSearchHistory,
    addPattern, getPatterns, getPatternDetail, savePatternAnalysis, deletePattern, addPatternExample,
    addPractice, getPractice, deletePractice,
    addRssFeed, getRssFeeds, updateRssFeedTitle, deleteRssFeed, fetchRssFeedMeta,
    getDbPath, exportBackup, switchDbPath, clearTranslations,
  ]);
}
