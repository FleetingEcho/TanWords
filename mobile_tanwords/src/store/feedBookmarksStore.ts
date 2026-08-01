import { create } from "zustand";
import { db_get_feed_bookmarks, db_toggle_feed_bookmark, db_remove_feed_bookmark } from "@/db/feeds";
import type { FeedBookmark, FeedBookmarkInput } from "@/hooks/useDB.types";

interface FeedBookmarksState {
  items: FeedBookmark[];
  urls: Set<string>;
  pending: Set<string>;
  loaded: boolean;
  refresh: () => Promise<void>;
  toggle: (input: FeedBookmarkInput) => Promise<boolean>;
  remove: (url: string) => Promise<void>;
}

async function fetchBookmarks(): Promise<{ items: FeedBookmark[]; urls: Set<string> }> {
  const items = await db_get_feed_bookmarks({ limit: 500, offset: 0 });
  return { items, urls: new Set(items.map((item) => item.url)) };
}

/** Shared by the Feeds entry surfaces and the in-app reader so a bookmark
 *  toggled in one place is immediately reflected everywhere else. */
export const useFeedBookmarksStore = create<FeedBookmarksState>((set, get) => ({
  items: [],
  urls: new Set(),
  pending: new Set(),
  loaded: false,
  refresh: async () => {
    try {
      const next = await fetchBookmarks();
      set({ ...next, loaded: true });
    } catch (error) {
      console.error("[feedBookmarks] refresh failed:", error);
    }
  },
  toggle: async (input) => {
    const { urls, pending } = get();
    if (pending.has(input.url)) return urls.has(input.url);
    const wasBookmarked = urls.has(input.url);
    const nextBookmarked = !wasBookmarked;
    set((s) => {
      const nextPending = new Set(s.pending);
      nextPending.add(input.url);
      const nextUrls = new Set(s.urls);
      if (nextBookmarked) nextUrls.add(input.url);
      else nextUrls.delete(input.url);
      const nextItems = nextBookmarked
        ? [{
            id: -Date.now(),
            url: input.url,
            title: input.title,
            feed_title: input.feedTitle,
            domain: input.domain,
            summary: input.summary,
            image_url: input.imageUrl,
            audio_url: input.audioUrl,
            audio_duration: input.audioDuration,
            hn_item_id: input.hnItemId,
            published: input.published,
            created_at: new Date().toISOString(),
          }, ...s.items.filter((item) => item.url !== input.url)]
        : s.items.filter((item) => item.url !== input.url);
      return { pending: nextPending, urls: nextUrls, items: nextItems, loaded: true };
    });
    try {
      const created = await db_toggle_feed_bookmark({
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
      await get().refresh();
      return created;
    } catch (error) {
      console.error("[feedBookmarks] toggle failed:", error);
      await get().refresh();
      return wasBookmarked;
    } finally {
      set((s) => {
        const nextPending = new Set(s.pending);
        nextPending.delete(input.url);
        return { pending: nextPending };
      });
    }
  },
  remove: async (url) => {
    if (get().pending.has(url)) return;
    set((s) => {
      const nextPending = new Set(s.pending);
      nextPending.add(url);
      return { pending: nextPending };
    });
    try {
      await db_remove_feed_bookmark({ url });
      await get().refresh();
    } catch (error) {
      console.error("[feedBookmarks] remove failed:", error);
      await get().refresh();
    } finally {
      set((s) => {
        const nextPending = new Set(s.pending);
        nextPending.delete(url);
        return { pending: nextPending };
      });
    }
  },
}));
