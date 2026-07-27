import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError, reportWriteError } from "./useDB.errors";

/** Where an article entered the library. */
export type ReadingSource = "paste" | "mcp" | "reader";

export interface ReadingArticleItem {
  id: number;
  title: string;
  word_count: number;
  source: ReadingSource | string;
  source_url: string;
  tags: string;
  created_at: string;
  last_read_at: string;
  comment_count: number;
  /** Matching text around the search term; "" when not searching. */
  snippet: string;
}

export interface ReadingArticleDetail {
  id: number;
  title: string;
  content: string;
  word_count: number;
  source: string;
  source_url: string;
  tags: string;
  created_at: string;
  last_read_at: string;
}

export interface ReadingComment {
  id: number;
  article_id: number;
  author: string;
  body: string;
  /** The sentence this note is about; null means it's about the whole piece. */
  anchor_text: string | null;
  created_at: string;
}

export interface ReadingListOptions {
  search?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  onlyCommented?: boolean;
  sort?: "recent" | "added" | "longest";
  page?: number;
  limit?: number;
}

export function useDBReading() {
  const saveReadingArticle = useCallback(async (
    title: string, content: string, source: ReadingSource, sourceUrl?: string, tags?: string[],
  ): Promise<number> => {
    try {
      return await invoke<number>("db_save_reading_article", {
        title, content, source,
        sourceUrl: sourceUrl || null,
        tags: tags ? JSON.stringify(tags) : null,
      });
    } catch (e) {
      reportWriteError("saveReadingArticle", e, "保存文章失败");
      return 0;
    }
  }, []);

  const listReadingArticles = useCallback(async (
    opts: ReadingListOptions = {},
  ): Promise<{ items: ReadingArticleItem[]; total: number }> => {
    try {
      return await invoke("db_list_reading_articles", {
        search: opts.search || null,
        source: opts.source || null,
        dateFrom: opts.dateFrom || null,
        dateTo: opts.dateTo || null,
        onlyCommented: opts.onlyCommented ?? null,
        sort: opts.sort || null,
        page: opts.page ?? 0,
        limit: opts.limit ?? 20,
      });
    } catch (e) {
      logError("listReadingArticles", e);
      return { items: [], total: 0 };
    }
  }, []);

  /** `touch` marks it as read now, which is what the library sorts by. */
  const getReadingArticle = useCallback(async (id: number, touch = false): Promise<ReadingArticleDetail | null> => {
    try {
      return await invoke<ReadingArticleDetail | null>("db_get_reading_article", { id, touch });
    } catch (e) {
      logError("getReadingArticle", e);
      return null;
    }
  }, []);

  const deleteReadingArticle = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_delete_reading_article", { id });
    } catch (e) {
      reportWriteError("deleteReadingArticle", e, "删除文章失败");
    }
  }, []);

  const listReadingComments = useCallback(async (articleId: number): Promise<ReadingComment[]> => {
    try {
      return await invoke<ReadingComment[]>("db_list_reading_comments", { articleId });
    } catch (e) {
      logError("listReadingComments", e);
      return [];
    }
  }, []);

  const addReadingComment = useCallback(async (
    articleId: number, body: string, anchorText?: string, author: "ai" | "user" = "user",
  ): Promise<number> => {
    try {
      return await invoke<number>("db_add_reading_comment", {
        articleId, author, body, anchorText: anchorText || null,
      });
    } catch (e) {
      reportWriteError("addReadingComment", e, "保存批注失败");
      return 0;
    }
  }, []);

  const deleteReadingComment = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_delete_reading_comment", { id });
    } catch (e) {
      reportWriteError("deleteReadingComment", e, "删除批注失败");
    }
  }, []);

  return useMemo(() => ({
    saveReadingArticle, listReadingArticles, getReadingArticle, deleteReadingArticle,
    listReadingComments, addReadingComment, deleteReadingComment,
  }), [
    saveReadingArticle, listReadingArticles, getReadingArticle, deleteReadingArticle,
    listReadingComments, addReadingComment, deleteReadingComment,
  ]);
}
