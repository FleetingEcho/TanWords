/** AI Chat sessions, reading/articles, dashboard, SRS review, search history,
 *  and data management — see useDB.ts for the composed public hook,
 *  useDB.core.ts for vocabulary/translations/settings/documents. */

import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError, reportWriteError } from "./useDB.errors";
import {
  ChatSessionItem, ChatSessionDetail, ArticleListItem, ArticleDetail, SavedSentence,
  DashboardStats, DueCard, ReviewResult, SrsRating, SearchHistoryItem,
  RssFeedMeta, RssFeed, RssEntryRow,
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

  // ── Reading Lessons (articles + AI notes + saved sentences) ───────────

  const saveArticleAnalysis = useCallback(
    async (
      title: string,
      sourceUrl: string,
      origin: string,
      content: string,
      analysisMarkdown: string,
      hnItemId?: number | null
    ): Promise<number> => {
      try {
        return await invoke<number>("db_save_article_analysis", {
          title,
          sourceUrl,
          origin,
          content,
          analysisMarkdown,
          hnItemId: hnItemId ?? null,
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

  const addSavedSentence = useCallback(
    async (
      text: string,
      zh: string,
      note: string,
      articleId: number | null,
      articleTitle: string
    ): Promise<number> => {
      try {
        return await invoke<number>("db_add_saved_sentence", {
          text,
          zh,
          note,
          articleId,
          articleTitle,
        });
      } catch (e) {
        reportWriteError("addSavedSentence", e, "保存句子失败");
        throw e;
      }
    },
    []
  );

  const getSavedSentences = useCallback(async (): Promise<SavedSentence[]> => {
    try {
      return await invoke<SavedSentence[]>("db_get_saved_sentences");
    } catch (e) {
      logError("getSavedSentences", e);
      return [];
    }
  }, []);

  const deleteSavedSentence = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_delete_saved_sentence", { id });
    } catch (e) {
      reportWriteError("deleteSavedSentence", e, "删除句子失败");
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

  const updateRssFeedPreferences = useCallback(async (
    id: number, category: "article" | "podcast" | null, isPinned: boolean
  ): Promise<void> => {
    try {
      await invoke("db_update_rss_feed_preferences", { id, category, isPinned });
    } catch (e) {
      reportWriteError("updateRssFeedPreferences", e, "更新 RSS 源设置失败");
      throw e;
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

  /** Fetch the feed and upsert its entries into rss_entries. Returns new-entry count. */
  const syncRssFeed = useCallback(async (feedId: number): Promise<number> => {
    try {
      return await invoke<number>("db_sync_rss_feed", { feedId });
    } catch (e) {
      logError("syncRssFeed", e);
      throw e;
    }
  }, []);

  /** Read cached entries from the DB; feedId null = all feeds, published DESC. */
  const getRssEntries = useCallback(async (
    feedId: number | null, limit = 200, offset = 0
  ): Promise<RssEntryRow[]> => {
    try {
      return await invoke<RssEntryRow[]>("db_get_rss_entries", { feedId, limit, offset });
    } catch (e) {
      logError("getRssEntries", e);
      return [];
    }
  }, []);

  const markRssEntryRead = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_mark_rss_entry_read", { id });
    } catch (e) {
      // Read-marking is fire-and-forget; never toast for it.
      logError("markRssEntryRead", e);
    }
  }, []);

  const getRssUnreadCounts = useCallback(async (): Promise<Array<[number, number]>> => {
    try {
      return await invoke<Array<[number, number]>>("db_get_rss_unread_counts");
    } catch (e) {
      logError("getRssUnreadCounts", e);
      return [];
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

  const getDbSize = useCallback(async (): Promise<number> => {
    try {
      return await invoke<number>("db_get_db_size");
    } catch (e) {
      logError("getDbSize", e);
      return 0;
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
    saveArticleAnalysis, getArticles, getArticle, deleteArticle, addKnownWords, getKnownWords,
    addSavedSentence, getSavedSentences, deleteSavedSentence,
    getDashboardStats,
    getDueCards, reviewCard,
    addSearchHistory, getSearchHistory, clearSearchHistory,
    addRssFeed, getRssFeeds, updateRssFeedTitle, updateRssFeedPreferences, deleteRssFeed, fetchRssFeedMeta,
    syncRssFeed, getRssEntries, markRssEntryRead, getRssUnreadCounts,
    getDbPath, getDbSize, exportBackup, switchDbPath, clearTranslations,
  }), [
    listChatSessions, getChatSession, upsertChatSession, deleteChatSession, searchChatSessions,
    saveArticleAnalysis, getArticles, getArticle, deleteArticle, addKnownWords, getKnownWords,
    addSavedSentence, getSavedSentences, deleteSavedSentence,
    getDashboardStats,
    getDueCards, reviewCard,
    addSearchHistory, getSearchHistory, clearSearchHistory,
    addRssFeed, getRssFeeds, updateRssFeedTitle, updateRssFeedPreferences, deleteRssFeed, fetchRssFeedMeta,
    syncRssFeed, getRssEntries, markRssEntryRead, getRssUnreadCounts,
    getDbPath, getDbSize, exportBackup, switchDbPath, clearTranslations,
  ]);
}
