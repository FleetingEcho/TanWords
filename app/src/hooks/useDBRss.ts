/** RSS feed management, entry sync/read state, and feed bookmarks — one of
 *  the domain hooks composed by useDB.extra.ts (see useDB.ts). */
import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { logError, reportWriteError } from "./useDB.errors";
import type { RssFeedMeta, RssFeed, RssEntryRow, FeedBookmark, FeedBookmarkInput } from "./useDB.types";

export function useDBRss() {
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

  return useMemo(() => ({
    addRssFeed, getRssFeeds, updateRssFeedTitle, updateRssFeedPreferences, setRssFeedPaused, deleteRssFeed, fetchRssFeedMeta,
    syncRssFeed, getRssEntries, markRssEntryRead, getRssUnreadCounts,
    // The header promises feed bookmarks on this hook — the store happens to
    // call `invoke` directly today, but the composed API must not advertise
    // methods that come back `undefined`.
    toggleFeedBookmark, getFeedBookmarks, removeFeedBookmark,
  }), [
    addRssFeed, getRssFeeds, updateRssFeedTitle, updateRssFeedPreferences, setRssFeedPaused, deleteRssFeed, fetchRssFeedMeta,
    syncRssFeed, getRssEntries, markRssEntryRead, getRssUnreadCounts,
    toggleFeedBookmark, getFeedBookmarks, removeFeedBookmark,
  ]);
}
