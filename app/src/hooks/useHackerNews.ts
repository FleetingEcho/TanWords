import { useCallback, useEffect, useRef, useState } from "react";

export type HNFeed = "top" | "best" | "new";
export type HNSearchSort = "pop" | "new";

export interface HNStory {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  time: number;
  descendants: number;
}

const API = "https://hacker-news.firebaseio.com/v0";
const SEARCH_API = "https://hn.algolia.com/api/v1";
const FEED_ENDPOINT: Record<HNFeed, string> = {
  top: "topstories",
  best: "beststories",
  new: "newstories",
};
const PAGE_SIZE = 30;
const STALE_MS = 5 * 60 * 1000;

interface FeedCache {
  ids: number[];
  stories: HNStory[];
  fetchedAt: number;
}

const cache: Partial<Record<HNFeed, FeedCache>> = {};

export function hnItemUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export function storyDomain(story: HNStory): string {
  if (!story.url) return "news.ycombinator.com";
  try {
    return new URL(story.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function fetchItems(ids: number[]): Promise<HNStory[]> {
  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`${API}/item/${id}.json`);
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    })
  );
  return items
    .filter((it) => it && it.title && !it.dead && !it.deleted)
    .map((it) => ({
      id: it.id,
      title: it.title,
      url: it.url,
      score: it.score ?? 0,
      by: it.by ?? "",
      time: it.time ?? 0,
      descendants: it.descendants ?? 0,
    }));
}

export function useHackerNews(feed: HNFeed) {
  const [stories, setStories] = useState<HNStory[]>(cache[feed]?.stories ?? []);
  const [fetchedAt, setFetchedAt] = useState<number>(cache[feed]?.fetchedAt ?? 0);
  const [loading, setLoading] = useState(!cache[feed]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(
    cache[feed] ? cache[feed]!.stories.length < cache[feed]!.ids.length : true
  );
  const [error, setError] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (force = false) => {
      const cached = cache[feed];
      if (!force && cached && Date.now() - cached.fetchedAt < STALE_MS) {
        setStories(cached.stories);
        setFetchedAt(cached.fetchedAt);
        setHasMore(cached.stories.length < cached.ids.length);
        setLoading(false);
        setError(false);
        return;
      }
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`${API}/${FEED_ENDPOINT[feed]}.json`);
        if (!res.ok) throw new Error(String(res.status));
        const ids: number[] = await res.json();
        const list = await fetchItems(ids.slice(0, PAGE_SIZE));
        cache[feed] = { ids, stories: list, fetchedAt: Date.now() };
        if (seq !== requestSeq.current) return;
        setStories(list);
        setFetchedAt(cache[feed]!.fetchedAt);
        setHasMore(list.length < ids.length);
      } catch {
        if (seq !== requestSeq.current) return;
        setError(true);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [feed]
  );

  const loadMore = useCallback(async () => {
    const cached = cache[feed];
    if (!cached || loadingMore) return;
    const start = cached.stories.length;
    if (start >= cached.ids.length) {
      setHasMore(false);
      return;
    }
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const more = await fetchItems(cached.ids.slice(start, start + PAGE_SIZE));
      // A refresh/feed-switch happened meanwhile — drop this stale page
      if (seq !== requestSeq.current || cache[feed] !== cached) return;
      cached.stories = [...cached.stories, ...more];
      setStories(cached.stories);
      setHasMore(cached.stories.length < cached.ids.length);
    } finally {
      if (seq === requestSeq.current) setLoadingMore(false);
    }
  }, [feed, loadingMore]);

  useEffect(() => {
    load();
  }, [load]);

  return { stories, loading, loadingMore, hasMore, error, fetchedAt, loadMore, refresh: () => load(true) };
}

// ── Algolia-powered search ──────────────────────────────────────────────────

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  author: string | null;
  created_at_i: number;
  num_comments: number | null;
}

export function useHNSearch(query: string, sort: HNSearchSort) {
  const [hits, setHits] = useState<HNStory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const pageRef = useRef(0);
  const nbPagesRef = useRef(0);
  const requestSeq = useRef(0);

  const fetchPage = useCallback(
    async (page: number): Promise<{ stories: HNStory[]; nbPages: number; nbHits: number }> => {
      const endpoint = sort === "new" ? "search_by_date" : "search";
      const params = new URLSearchParams({
        query,
        tags: "story",
        hitsPerPage: String(PAGE_SIZE),
        page: String(page),
      });
      const res = await fetch(`${SEARCH_API}/${endpoint}?${params}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const stories: HNStory[] = (data.hits as AlgoliaHit[])
        .filter((h) => h.title)
        .map((h) => ({
          id: Number(h.objectID),
          title: h.title!,
          url: h.url || undefined,
          score: h.points ?? 0,
          by: h.author ?? "",
          time: h.created_at_i,
          descendants: h.num_comments ?? 0,
        }));
      return { stories, nbPages: data.nbPages ?? 0, nbHits: data.nbHits ?? stories.length };
    },
    [query, sort]
  );

  useEffect(() => {
    if (!query.trim()) {
      requestSeq.current++;
      setHits([]);
      setTotal(0);
      setLoading(false);
      setError(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(false);
    fetchPage(0)
      .then(({ stories, nbPages, nbHits }) => {
        if (seq !== requestSeq.current) return;
        pageRef.current = 0;
        nbPagesRef.current = nbPages;
        setHits(stories);
        setTotal(nbHits);
      })
      .catch(() => {
        if (seq === requestSeq.current) setError(true);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [query, sort, fetchPage]);

  const hasMore = pageRef.current + 1 < nbPagesRef.current;

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const { stories } = await fetchPage(next);
      if (seq !== requestSeq.current) return;
      pageRef.current = next;
      setHits((prev) => [...prev, ...stories]);
    } catch {
      // keep whatever is loaded; the sentinel will retry on next intersection
    } finally {
      if (seq === requestSeq.current) setLoadingMore(false);
    }
  }, [fetchPage, loading, loadingMore, hasMore]);

  return { hits, total, loading, loadingMore, hasMore, error, loadMore };
}
