/** AI Chat sessions, article-analysis persistence, dashboard, SRS review,
 *  search history, and data management — see useDB.ts for the composed
 *  public hook, useDB.core.ts for vocabulary/translations/settings/documents. */

import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { webAuthFetch } from "@/platform/webClient";
import { isDesktopHost } from "@/platform";
import { logError, reportWriteError } from "./useDB.errors";
import {
  ChatSessionItem, ChatSessionDetail,
  DashboardStats, DueCard, ReviewResult, SrsRating, SearchHistoryItem,
  RssFeedMeta, RssFeed, RssEntryRow, FeedBookmark, FeedBookmarkInput,
  DbConnection, RememberedTursoConnection, ImportPlan, ImportDecisions, ImportResult,
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

async function dbRoute<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await webAuthFetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // raw text is the message
    }
    throw message;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function useDBExtra() {
  const listChatSessions = useCallback(async (
    page = 0,
    limit = 100,
    opts?: {
      /** Which shelf: false = active, true = archived, omitted = both. */
      archived?: boolean;
      /** Last-activity range, YYYY-MM-DD; `to` includes that whole day. */
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<ChatSessionItem[]> => {
    try {
      return await invoke<ChatSessionItem[]>("db_list_chat_sessions", {
        page,
        limit,
        archived: opts?.archived ?? null,
        dateFrom: opts?.dateFrom || null,
        dateTo: opts?.dateTo || null,
      });
    } catch (e) {
      logError("listChatSessions", e);
      return [];
    }
  }, []);

  const setChatSessionArchived = useCallback(async (id: string, archived: boolean): Promise<void> => {
    try {
      await invoke("db_set_chat_session_archived", { id, archived });
    } catch (e) {
      reportWriteError("setChatSessionArchived", e, "归档对话失败");
    }
  }, []);

  const setChatSessionPinned = useCallback(async (id: string, pinned: boolean): Promise<void> => {
    try {
      await invoke("db_set_chat_session_pinned", { id, pinned });
    } catch (e) {
      reportWriteError("setChatSessionPinned", e, "置顶对话失败");
    }
  }, []);

  const renameChatSession = useCallback(async (id: string, title: string): Promise<boolean> => {
    try {
      await invoke("db_rename_chat_session", { id, title });
      return true;
    } catch (e) {
      reportWriteError("renameChatSession", e, "重命名对话失败");
      return false;
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

  // ── Article analysis (persisted alongside the RSS reader's inline AI notes) ──

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
        // Caller already surfaces a toast with the specific error message —
        // just log here to avoid a duplicate toast.
        logError("saveArticleAnalysis", e);
        throw e;
      }
    },
    []
  );

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

  const setRssFeedPaused = useCallback(async (id: number, isPaused: boolean): Promise<void> => {
    try {
      await invoke("db_set_rss_feed_paused", { id, isPaused });
    } catch (e) {
      reportWriteError("setRssFeedPaused", e, "更新 RSS 源暂停状态失败");
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
  const syncRssFeed = useCallback(async (feedId: number, force = false): Promise<number> => {
    try {
      return await invoke<number>("db_sync_rss_feed", { feedId, force });
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

  const toggleFeedBookmark = useCallback(async (input: FeedBookmarkInput): Promise<boolean> => {
    try {
      return await invoke<boolean>("db_toggle_feed_bookmark", {
        url: input.url,
        title: input.title,
        feedTitle: input.feedTitle,
        domain: input.domain,
        summary: input.summary,
        imageUrl: input.imageUrl,
        audioUrl: input.audioUrl,
        audioDuration: input.audioDuration,
        hnItemId: input.hnItemId,
        published: input.published,
      });
    } catch (e) {
      reportWriteError("toggleFeedBookmark", e, "切换收藏失败");
      return false;
    }
  }, []);

  const getFeedBookmarks = useCallback(async (limit = 500, offset = 0): Promise<FeedBookmark[]> => {
    try {
      return await invoke<FeedBookmark[]>("db_get_feed_bookmarks", { limit, offset });
    } catch (e) {
      logError("getFeedBookmarks", e);
      return [];
    }
  }, []);

  const removeFeedBookmark = useCallback(async (url: string): Promise<void> => {
    try {
      await invoke("db_remove_feed_bookmark", { url });
    } catch (e) {
      reportWriteError("removeFeedBookmark", e, "取消收藏失败");
    }
  }, []);

  // ── Data management (Settings › Data) ─────────────────────────────────

  const getDbPath = useCallback(async (): Promise<string> => {
    if (!isDesktopHost) return "";
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

  const exportBackup = useCallback(async (dest: string, password: string | null = null): Promise<void> => {
    if (!isDesktopHost) return;
    try {
      await invoke("db_export_backup", { dest, password });
    } catch (e) {
      reportWriteError("exportBackup", e, "导出备份失败");
      throw e;
    }
  }, []);

  /** The active connection profile plus what it supports, so the UI can hide
   *  actions (export, switch file) that a remote profile can't perform. */
  const getConnection = useCallback(async (): Promise<DbConnection | null> => {
    try {
      return await invoke<DbConnection>("db_get_connection");
    } catch (e) {
      logError("getConnection", e);
      return null;
    }
  }, []);

  /** Points the app at a Turso database as an embedded replica. The token goes
   *  straight to the OS keychain and is never readable from here again. Caller
   *  must reload the app afterwards — every already-fetched page is stale. */
  const connectTurso = useCallback(async (url: string, token: string): Promise<DbConnection> => {
    try {
      if (!isDesktopHost) {
        return await dbRoute<DbConnection>("/api/db/turso/connect", "POST", { url, token });
      }
      return await invoke<DbConnection>("db_connect_turso", { url, token });
    } catch (e) {
      reportWriteError("connectTurso", e, "连接 Turso 失败");
      throw e;
    }
  }, []);

  /** Web-only selection between the account's preserved local database and its
   * remembered Turso replica. Selecting local does not erase credentials. */
  const selectDbSource = useCallback(async (source: "local" | "turso"): Promise<DbConnection> => {
    if (isDesktopHost) throw new Error("Per-account database selection is web-only");
    try {
      return await dbRoute<DbConnection>("/api/db/source", "POST", { source });
    } catch (e) {
      reportWriteError("selectDbSource", e, "切换数据库失败");
      throw e;
    }
  }, []);

  /** Desktop-compatible disconnect operation. Web Settings uses
   * selectDbSource("local") so remembered credentials are preserved. */
  const disconnectRemote = useCallback(async (): Promise<DbConnection> => {
    try {
      if (!isDesktopHost) {
        return await dbRoute<DbConnection>("/api/db/turso/disconnect", "POST");
      }
      return await invoke<DbConnection>("db_disconnect_remote");
    } catch (e) {
      reportWriteError("disconnectRemote", e, "断开在线数据库失败");
      throw e;
    }
  }, []);

  /** The profile that failed to open at launch, if any — same snapshot App.tsx
   *  already toasted once at startup. Settings re-reads it to decide whether
   *  to keep showing a "forget saved connection" affordance. */
  const getStartupWarning = useCallback(async (): Promise<string | null> => {
    try {
      return await invoke<string | null>("db_get_startup_warning");
    } catch (e) {
      logError("getStartupWarning", e);
      return null;
    }
  }, []);

  /** Whether the profile saved on disk (independent of the live connection,
   *  which is already the local fallback if this is relevant at all) is
   *  Turso — gates the "forget saved connection" button. */
  const isSavedProfileTurso = useCallback(async (): Promise<boolean> => {
    try {
      if (!isDesktopHost) {
        const remembered = await dbRoute<RememberedTursoConnection>("/api/db/turso/remembered");
        return remembered.url !== null && remembered.tokenPresent;
      }
      return await invoke<boolean>("db_saved_profile_is_turso");
    } catch (e) {
      logError("isSavedProfileTurso", e);
      return false;
    }
  }, []);

  /** Reads the last Turso URL and whether the keychain still has a token, so
   *  the Settings form can prefill a reconnect without exposing the token. */
  const getRememberedTurso = useCallback(async (): Promise<RememberedTursoConnection | null> => {
    try {
      if (!isDesktopHost) {
        return await dbRoute<RememberedTursoConnection>("/api/db/turso/remembered");
      }
      return await invoke<RememberedTursoConnection>("db_get_remembered_turso");
    } catch (e) {
      logError("getRememberedTurso", e);
      return null;
    }
  }, []);

  /** Clears a saved Turso profile that can't be reconnected right now (lost
   *  token, wiped keychain, …), without needing a live connection to it. */
  const forgetSavedProfile = useCallback(async (): Promise<void> => {
    try {
      if (!isDesktopHost) {
        await dbRoute("/api/db/turso/forget", "POST");
        return;
      }
      await invoke("db_forget_saved_profile");
    } catch (e) {
      reportWriteError("forgetSavedProfile", e, "Failed to clear saved connection");
      throw e;
    }
  }, []);

  /** Pull the primary's latest changes now instead of waiting for the next
   *  background sync. No-op on a local profile. */
  const syncNow = useCallback(async (): Promise<void> => {
    try {
      await invoke("db_sync_now");
    } catch (e) {
      reportWriteError("syncNow", e, "同步失败");
      throw e;
    }
  }, []);

  /** Reads another TanWords database and reports what would be added and what
   *  already exists. Writes nothing — the source is opened read-only. */
  const importAnalyze = useCallback(async (sourcePath: string, password: string | null = null): Promise<ImportPlan> => {
    try {
      if (!isDesktopHost) {
        return await dbRoute<ImportPlan>("/api/import/analyze", "POST", { path: sourcePath, password });
      }
      return await invoke<ImportPlan>("db_import_analyze", { sourcePath, password });
    } catch (e) {
      reportWriteError("importAnalyze", e, "读取数据库文件失败");
      throw e;
    }
  }, []);

  /** Applies an import with a decision for every conflict, in one transaction. */
  const importApply = useCallback(
    async (sourcePath: string, decisions: ImportDecisions, password: string | null = null): Promise<ImportResult> => {
      try {
        if (!isDesktopHost) {
          return await dbRoute<ImportResult>("/api/import/apply", "POST", { path: sourcePath, decisions, password });
        }
        return await invoke<ImportResult>("db_import_apply", { sourcePath, decisions, password });
      } catch (e) {
        reportWriteError("importApply", e, "导入失败");
        throw e;
      }
    },
    []
  );

  /** Mounts a different SQLite file as the active DB (creating it if new). Caller must reload the app after this succeeds — every already-fetched page is stale. */
  const switchDbPath = useCallback(async (newPath: string): Promise<string> => {
    if (!isDesktopHost) return "";
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
    listChatSessions, setChatSessionArchived, setChatSessionPinned, renameChatSession, getChatSession, upsertChatSession, deleteChatSession, searchChatSessions,
    saveArticleAnalysis, addKnownWords, getKnownWords,
    getDashboardStats,
    getDueCards, reviewCard,
    addSearchHistory, getSearchHistory, clearSearchHistory,
    addRssFeed, getRssFeeds, updateRssFeedTitle, updateRssFeedPreferences, setRssFeedPaused, deleteRssFeed, fetchRssFeedMeta,
    syncRssFeed, getRssEntries, markRssEntryRead, getRssUnreadCounts,
    getDbPath, getDbSize, exportBackup, switchDbPath, clearTranslations,
    getConnection, connectTurso, selectDbSource, disconnectRemote, syncNow,
    getStartupWarning, isSavedProfileTurso, forgetSavedProfile, getRememberedTurso,
    importAnalyze, importApply,
  }), [
    listChatSessions, setChatSessionArchived, setChatSessionPinned, renameChatSession, getChatSession, upsertChatSession, deleteChatSession, searchChatSessions,
    saveArticleAnalysis, addKnownWords, getKnownWords,
    getDashboardStats,
    getDueCards, reviewCard,
    addSearchHistory, getSearchHistory, clearSearchHistory,
    addRssFeed, getRssFeeds, updateRssFeedTitle, updateRssFeedPreferences, setRssFeedPaused, deleteRssFeed, fetchRssFeedMeta,
    syncRssFeed, getRssEntries, markRssEntryRead, getRssUnreadCounts,
    getDbPath, getDbSize, exportBackup, switchDbPath, clearTranslations,
    getConnection, connectTurso, selectDbSource, disconnectRemote, syncNow,
    getStartupWarning, isSavedProfileTurso, forgetSavedProfile, getRememberedTurso,
    importAnalyze, importApply,
  ]);
}
