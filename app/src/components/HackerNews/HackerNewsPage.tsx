import React, { useCallback, useEffect, useRef, useState } from "react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useT } from "@/hooks/useT";
import {
  HNFeed,
  HNSearchSort,
  HNStory,
  hnItemUrl,
  storyDomain,
  useHackerNews,
  useHNSearch,
} from "@/hooks/useHackerNews";
import { LearnDrawer } from "./LearnDrawer";
import { ReaderView } from "./ReaderView";
import { StoryList } from "./StoryList";
import { FeedHeader } from "./FeedHeader";

const READ_KEY = "tanwords_hn_read";
const SAVED_KEY = "tanwords_hn_saved";

function loadIdMap(key: string): Record<number, number> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function persistIdMap(key: string, map: Record<number, number>) {
  const entries = Object.entries(map);
  // Cap stored entries so localStorage doesn't grow unbounded
  const trimmed = entries.length > 500 ? entries.slice(entries.length - 500) : entries;
  localStorage.setItem(key, JSON.stringify(Object.fromEntries(trimmed)));
}

export function HackerNewsPage() {
  const t = useT();
  const [feed, setFeed] = useState<HNFeed>("top");
  const { stories, loading, loadingMore, hasMore, error, fetchedAt, loadMore, refresh } =
    useHackerNews(feed);
  const [readMap, setReadMap] = useState<Record<number, number>>(() => loadIdMap(READ_KEY));
  const [savedMap, setSavedMap] = useState<Record<number, number>>(() => loadIdMap(SAVED_KEY));
  const [learnStory, setLearnStory] = useState<HNStory | null>(null);
  const [learnPrefill, setLearnPrefill] = useState<string>("");
  const [browse, setBrowse] = useState<{ story: HNStory | null; url: string; title: string } | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [showUrlBar, setShowUrlBar] = useState(false);
  const [, forceTick] = useState(0);

  // Search (Algolia), debounced from the input value
  const [qInput, setQInput] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HNSearchSort>("pop");
  const search = useHNSearch(query, sort);
  const searching = query.trim().length > 0;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(qInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [qInput]);

  const visible = searching ? search.hits : stories;
  const listLoading = searching ? search.loading : loading;
  const listError = searching ? search.error : error;
  const listLoadingMore = searching ? search.loadingMore : loadingMore;
  const listHasMore = searching ? search.hasMore : hasMore;

  // Infinite scroll sentinel — one observer serves both feed and search modes
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  loadMoreRef.current = searching ? search.loadMore : loadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "500px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [browse]);

  // Re-render every minute so "updated N min ago" stays honest
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const timeAgo = useCallback(
    (unixSeconds: number) => {
      const mins = Math.max(0, Math.floor((Date.now() / 1000 - unixSeconds) / 60));
      if (mins < 1) return t("hn.ago.now");
      if (mins < 60) return t("hn.ago.m", { n: mins });
      if (mins < 60 * 24) return t("hn.ago.h", { n: Math.floor(mins / 60) });
      return t("hn.ago.d", { n: Math.floor(mins / (60 * 24)) });
    },
    [t]
  );

  const markRead = (id: number) => {
    setReadMap((prev) => {
      const next = { ...prev, [id]: Date.now() };
      persistIdMap(READ_KEY, next);
      return next;
    });
  };

  const openExternal = async (url: string) => {
    try {
      await openShell(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  // Opens inside the app (reader mode — fetches + extracts the article)
  const openArticle = (story: HNStory) => {
    markRead(story.id);
    setBrowse({ story, url: story.url || hnItemUrl(story.id), title: story.title });
  };

  const openComments = (story: HNStory) => {
    markRead(story.id);
    setBrowse({ story, url: hnItemUrl(story.id), title: story.title });
  };

  const openUrl = (rawUrl: string) => {
    let url = rawUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setBrowse({ story: null, url, title: url });
    setUrlInput("");
    setShowUrlBar(false);
  };

  const handleSaved = (storyId: number, docId: number) => {
    setSavedMap((prev) => {
      const next = { ...prev, [storyId]: docId };
      persistIdMap(SAVED_KEY, next);
      return next;
    });
  };

  const browseDomain = (() => {
    if (!browse) return "";
    if (browse.story) return storyDomain(browse.story);
    try {
      return new URL(browse.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  const updatedLabel = fetchedAt
    ? t("hn.updated", { t: timeAgo(Math.floor(fetchedAt / 1000)) })
    : "";

  return (
    <>
      {browse ? (
        <ReaderView
          url={browse.url}
          title={browse.title}
          domain={browseDomain}
          onBack={() => setBrowse(null)}
          onOpenExternal={() => openExternal(browse.url)}
          onLearn={({ title, text }) => {
            setLearnPrefill(text);
            setLearnStory(
              browse.story ?? {
                id: -Date.now(),
                title,
                url: browse.url,
                score: 0,
                by: "",
                time: Math.floor(Date.now() / 1000),
                descendants: 0,
              }
            );
          }}
        />
      ) : (
        <div className="p-6 space-y-5 animate-fade-in max-w-4xl">
          <FeedHeader
            showUrlBar={showUrlBar}
            urlInput={urlInput}
            onUrlInputChange={setUrlInput}
            onShowUrlBar={setShowUrlBar}
            onOpenUrl={openUrl}
            qInput={qInput}
            onQInputChange={setQInput}
            searching={searching}
            searchLoading={search.loading}
            searchError={search.error}
            searchTotal={search.total}
            sort={sort}
            onSortChange={setSort}
            feed={feed}
            onFeedChange={setFeed}
            loading={loading}
            updatedLabel={updatedLabel}
            onRefresh={refresh}
          />

          <StoryList
            stories={visible}
            loading={listLoading}
            loadingMore={listLoadingMore}
            hasMore={listHasMore}
            error={listError}
            searching={searching}
            readMap={readMap}
            savedMap={savedMap}
            timeAgo={timeAgo}
            sentinelRef={sentinelRef}
            onOpenArticle={openArticle}
            onOpenComments={openComments}
            onOpenExternal={(s) => { markRead(s.id); openExternal(s.url || hnItemUrl(s.id)); }}
            onLearn={setLearnStory}
            onRetry={refresh}
          />
        </div>
      )}

      <LearnDrawer
        story={learnStory}
        initialText={learnPrefill}
        onClose={() => { setLearnStory(null); setLearnPrefill(""); }}
        onSaved={handleSaved}
        onOpenArticle={(s) => openExternal(s.url || hnItemUrl(s.id))}
      />
    </>
  );
}
