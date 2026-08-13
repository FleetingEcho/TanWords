/** Chat sessions, persisted article-analysis, and known-words — one of the
 *  domain hooks composed by useDB.extra.ts (see useDB.ts). */
import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { logError, reportWriteError } from "./useDB.errors";
import type { ChatSessionItem, ChatSessionDetail } from "./useDB.types";

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

export function useDBChat() {
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

  return useMemo(() => ({
    listChatSessions, setChatSessionArchived, setChatSessionPinned, renameChatSession, getChatSession, upsertChatSession, deleteChatSession, searchChatSessions,
    saveArticleAnalysis, addKnownWords, getKnownWords,
  }), [
    listChatSessions, setChatSessionArchived, setChatSessionPinned, renameChatSession, getChatSession, upsertChatSession, deleteChatSession, searchChatSessions,
    saveArticleAnalysis, addKnownWords, getKnownWords,
  ]);
}
