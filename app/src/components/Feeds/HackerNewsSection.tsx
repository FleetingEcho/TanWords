import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/hooks/useT";
import type { RssFeed } from "@/hooks/useDB.types";
import { SearchIcon, CloseIcon } from "@/components/ui/icons";
import { EntryGrid, type FeedViewMode } from "./EntryGrid";
import type { DisplayEntry } from "./EntryCard";

type HnSection = "top" | "new" | "best";

interface HnStorySummary {
  id: number;
  title: string;
  url: string;
  by: string | null;
  score: number | null;
  time: number | null;
  descendants: number | null;
}

interface HnSectionPage {
  stories: HnStorySummary[];
  total: number;
}

interface HnSearchPage {
  stories: HnStorySummary[];
  page: number;
  total_pages: number;
}

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;
const SECTIONS: HnSection[] = ["top", "new", "best"];
/** Sky-blue placeholder cover for entries with no image — a fixed identity for the
 *  native HN browser rather than the usual hash-of-feed-title gradient. */
const HN_COVER_COLOR = "linear-gradient(135deg, hsl(199 89% 64%), hsl(211 92% 46%))";
const HN_FEED_ID = -1;
/** Native browsing has no local feed row. Deliberately left with no title (rather than
 *  a synthetic "Hacker News" one) so the meta row's domain label still falls back to
 *  each story's own site (github.com, etc.) instead of "Hacker News" on every row —
 *  the placeholder cover's "H" is supplied separately via `coverLetter`. */
const EMPTY_FEEDS_BY_ID = new Map<number, RssFeed>();

/** Adapts a live HN story into the same shape EntryGrid/EntryCard already render for RSS —
 *  `is_read: true` since this view isn't persisted, so there's nothing real to track.
 *  `points`/`commentCount` render as icon badges instead of a plain-text summary line. */
function toEntryRow(story: HnStorySummary): DisplayEntry {
  return {
    id: story.id,
    feed_id: HN_FEED_ID,
    title: story.title,
    url: story.url,
    author: story.by ?? "",
    summary: "",
    image_url: null,
    audio_url: null,
    audio_duration: null,
    hn_item_id: story.id,
    published: story.time ? new Date(story.time * 1000).toISOString() : "",
    is_read: true,
    fetched_at: "",
    points: story.score,
    commentCount: story.descendants,
  };
}

interface Props {
  viewMode: FeedViewMode;
  learningId: number | null;
  onOpen: (entry: DisplayEntry) => void;
  onLearn: (entry: DisplayEntry) => void;
  onTranslate?: (entry: DisplayEntry) => void;
  translatingId?: number | null;
}

/** Native Hacker News browser — New/Top/Best via HN's Firebase API, or search via
 *  Algolia's HN Search API, both paginated via an explicit "More" click. Nothing
 *  here is persisted: no read tracking, no offline cache. */
export function HackerNewsSection({ viewMode, learningId, onOpen, onLearn, onTranslate, translatingId }: Props) {
  const t = useT();
  const [section, setSection] = useState<HnSection>("top");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [stories, setStories] = useState<HnStorySummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSeq = useRef(0);
  const nextSearchPage = useRef(0);

  const isSearching = activeQuery.trim().length > 0;

  // Debounce the search box — waits for typing to pause before hitting Algolia.
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setActiveQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const loadMore = async (seq: number, reset: boolean) => {
    if (isSearching) {
      const page = reset ? 0 : nextSearchPage.current;
      const result = await invoke<HnSearchPage>("search_hn", { query: activeQuery, page });
      if (seq !== requestSeq.current) return;
      setStories((prev) => (reset ? result.stories : [...prev, ...result.stories]));
      nextSearchPage.current = result.page + 1;
      setHasMore(result.page + 1 < result.total_pages);
    } else {
      const offset = reset ? 0 : stories.length;
      const result = await invoke<HnSectionPage>("fetch_hn_section", { section, offset, limit: PAGE_SIZE });
      if (seq !== requestSeq.current) return;
      setStories((prev) => (reset ? result.stories : [...prev, ...result.stories]));
      setHasMore(offset + result.stories.length < result.total);
    }
  };

  // Section switch or a new committed search: start a fresh request "session"
  // so any in-flight response for the view the user just left can't land after the fact.
  useEffect(() => {
    const seq = ++requestSeq.current;
    setStatus("loading");
    setStories([]);
    setHasMore(false);
    loadMore(seq, true)
      .then(() => { if (seq === requestSeq.current) setStatus("ready"); })
      .catch(() => { if (seq === requestSeq.current) setStatus("error"); });
  }, [section, activeQuery]);

  // Explicit "more" click only — no auto-load-on-scroll. (An IntersectionObserver-based
  // sentinel used to trigger this automatically, but a collapsed date group can shrink
  // the page without the sentinel ever leaving the viewport, so it kept re-firing.)
  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    loadMore(seq, false).catch(() => {}).finally(() => setLoadingMore(false));
  };

  const entries = stories.map(toEntryRow);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setSection(s); setQuery(""); setActiveQuery(""); }}
              className={`flex h-8 items-center rounded-full border px-3 text-xs transition-colors ${
                !isSearching && section === s
                  ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                  : "border-border font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t(`hn.section.${s}`)}
            </button>
          ))}
        </div>

        <div className="relative w-56 shrink-0">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("hn.search.placeholder")}
            className="h-8 w-full rounded-full border border-input bg-background pl-8 pr-7 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label={t("hn.search.clear")}
              title={t("hn.search.clear")}
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {status === "loading" ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          </div>
        ) : status === "error" ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("hn.section.error")}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("hn.search.empty")}</p>
          </div>
        ) : (
          <EntryGrid
            entries={entries}
            feedsById={EMPTY_FEEDS_BY_ID}
            learningId={learningId}
            onOpen={onOpen}
            onLearn={onLearn}
            onPlay={() => {}}
            onTranslate={onTranslate}
            translatingId={translatingId}
            viewMode={viewMode}
            trackRead={false}
            coverColor={HN_COVER_COLOR}
            coverLetter="H"
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
          />
        )}
      </div>
    </div>
  );
}
