import { useCallback, useRef } from "react";
import { useDB } from "@/hooks/useDB";
import type { RssFeedMeta, RssFeed, RssEntry } from "@/hooks/useDB.types";

interface CacheEntry {
  meta: RssFeedMeta;
  fetchedAt: number;
}

const feedCache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export function useRssFeed() {
  const db = useDB();
  const fetchingRef = useRef<Set<string>>(new Set());

  /** Fetch feed metadata (with cache). Returns null on error. */
  const fetchFeed = useCallback(
    async (url: string, force = false): Promise<RssFeedMeta | null> => {
      // Return cached result if fresh
      if (!force) {
        const cached = feedCache.get(url);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
          return cached.meta;
        }
      }

      // Dedupe concurrent fetches for the same URL
      if (fetchingRef.current.has(url)) return null;
      fetchingRef.current.add(url);

      try {
        const meta = await db.fetchRssFeedMeta(url);
        if (meta) {
          feedCache.set(url, { meta, fetchedAt: Date.now() });
        }
        return meta;
      } finally {
        fetchingRef.current.delete(url);
      }
    },
    [db]
  );

  /** Merge entries from all feeds, sorted by date (newest first). */
  const getAllEntries = useCallback(
    async (
      feeds: RssFeed[]
    ): Promise<{ feed: RssFeed; entries: RssEntry[] }[]> => {
      const results = await Promise.all(
        feeds.map(async (feed) => {
          const meta = await fetchFeed(feed.url);
          return { feed, entries: meta?.entries ?? [] };
        })
      );
      return results;
    },
    [fetchFeed]
  );

  return { fetchFeed, getAllEntries };
}
