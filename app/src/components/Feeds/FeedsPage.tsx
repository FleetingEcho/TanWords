import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@/ipc/backend";
import { openExternal as openShell } from "@/ipc/shell";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import { useLearnArticle } from "@/hooks/useLearnArticle";
import { useLearnChatStore } from "@/store/learnChatStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useFeedsNavStore } from "@/store/feedsNavStore";
import { useFeedBookmarksStore } from "@/store/feedBookmarksStore";
import { useSettingsStore, type RssTabSelection } from "@/store/settingsStore";
import type { FetchedArticle } from "@/components/Reader/ArticleReader";
import type { RssEntryRow, RssFeed, FeedBookmark } from "@/hooks/useDB.types";
import { FeedTabs } from "./FeedTabs";
import { AddFeedDialog } from "./AddFeedDialog";
import { FeedsMainContent, type BrowseTarget } from "./FeedsMainContent";
import { TranslateModal } from "@/components/shared/TranslateModal";
import { AiChatModal } from "@/components/AiChat/AiChatModal";
import { flattenHnComments } from "@/lib/hnComments";
import { useHnCommentsStore } from "@/store/hnCommentsStore";
import { useTitleTranslateStore } from "@/store/titleTranslateStore";
import { domainOf, isStale, titleTranslateKey } from "./feedUtils";
import { seedDefaults } from "./feedSeeding";
import { addRecentlyRead, getRecentlyRead, clearRecentlyRead, removeRecentlyRead, type RecentlyReadItem } from "@/lib/recentlyRead";

/** One-time cleanup: the hnrss.org RSS subscription is superseded by the
 * native Hacker News section (New/Top/Best via HN's own API) — drop it from
 * existing installs so it doesn't keep showing up as a regular feed tab. */
const HN_RSS_URL = "https://hnrss.org/frontpage?points=100";
const HN_NATIVE_MIGRATED_FLAG = "tanwords_hn_native_migrated";

export function FeedsPage() {
  const t = useT();
  const db = useDB();
  const { navigate } = useNavStore();
  const { startLearn } = useLearnArticle();
  const feedsViewMode = useSettingsStore((s) => s.feedsViewMode);
  const setFeedsViewMode = useSettingsStore((s) => s.setFeedsViewMode);
  const bookmarks = useFeedBookmarksStore((s) => s.items);
  const bookmarkedUrls = useFeedBookmarksStore((s) => s.urls);
  const bookmarkPendingUrls = useFeedBookmarksStore((s) => s.pending);
  const toggleBookmarkStore = useFeedBookmarksStore((s) => s.toggle);
  const removeBookmarkStore = useFeedBookmarksStore((s) => s.remove);

  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [entries, setEntries] = useState<RssEntryRow[]>([]);
  const [unreadByFeed, setUnreadByFeed] = useState<Map<number, number>>(new Map());
  const [failedFeeds, setFailedFeeds] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<RssTabSelection>(() => useSettingsStore.getState().defaultRssTab);
  const [booting, setBooting] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  /** Entries currently queued for background analysis — a set (not a single id)
   *  since several can run at once without blocking the UI or each other. */
  const [analyzingBackgroundIds, setAnalyzingBackgroundIds] = useState<Set<number>>(new Set());
  /** "Show Chinese titles" toggle (FeedTabs) — stays on across tab switches; a
   *  batch translate is (re-)queued below for whatever's currently on screen. */
  const [showTitleTranslations, setShowTitleTranslations] = useState(false);
  const cachedTitleTranslations = useTitleTranslateStore((s) => s.byKey);
  // Cache stays intact when toggled off (so switching back on is instant again) —
  // only what's actually rendered is gated by the toggle.
  const titleTranslations = showTitleTranslations ? cachedTitleTranslations : undefined;
  const [translateTarget, setTranslateTarget] = useState<{ title: string; articleText: string; hnItemId: number | null } | null>(null);
  const [chatModalSessionId, setChatModalSessionId] = useState<string | null>(null);
  // Store-backed (not useState) so the open article survives navigating to
  // another page and back — see feedsNavStore.
  const browse = useFeedsNavStore((s) => s.browse);
  const setBrowse = useFeedsNavStore((s) => s.setBrowse);
  const [recentlyRead, setRecentlyRead] = useState<RecentlyReadItem[]>(() => getRecentlyRead());
  const syncingRef = useRef(false);
  const forcedSyncQueueRef = useRef<Map<number, RssFeed>>(new Map());
  // The live selection, readable from long-running background syncs — their
  // captured `selected` would otherwise be stale and yank the view back.
  const selectedRef = useRef<RssTabSelection>(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const feedsById = new Map(feeds.map((f) => [f.id, f]));

  const refreshEntries = useCallback(async (sel: RssTabSelection) => {
    if (sel === "hackernews") return; // the native HN section fetches its own data
    const rows = await db.getRssEntries(sel === "all" ? null : sel);
    // The user may have switched tabs while this read was in flight —
    // never overwrite the current tab's list with another tab's rows.
    if (selectedRef.current === sel) setEntries(rows);
    const counts = await db.getRssUnreadCounts();
    setUnreadByFeed(new Map(counts));
  }, [db]);

  // Re-queues (idempotently — translateBatch skips anything already cached/in-flight)
  // whenever the toggle is on and the visible RSS list changes, e.g. a tab switch or
  // background sync bringing in new entries. HackerNewsSection does the same for its
  // own (separately paginated) story list when that tab is selected instead.
  useEffect(() => {
    if (!showTitleTranslations || entries.length === 0) return;
    useTitleTranslateStore.getState().translateBatch(
      entries.map((e) => ({ key: titleTranslateKey(e), title: e.title }))
    );
  }, [showTitleTranslations, entries]);

  // Surfaces the one failure mode translateBatch can't report on its own (no AI
  // provider configured) — otherwise toggling the button on would just silently
  // do nothing, with no indication of why.
  const noTitleProvider = useTitleTranslateStore((s) => s.noProvider);
  useEffect(() => {
    if (showTitleTranslations && noTitleProvider) toast(t("reading.translate.noProvider"));
  }, [showTitleTranslations, noTitleProvider, t]);

  /** Sync sequentially in the backend, then update the visible cache once for the whole batch.
   *  Paused feeds are bulk-sync proof; opening that exact feed queues a forced exception. */
  const syncFeeds = useCallback(async (targets: RssFeed[], force = false) => {
    if (targets.length === 0) return;
    if (syncingRef.current) {
      if (force) targets.forEach((feed) => forcedSyncQueueRef.current.set(feed.id, feed));
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    const failed = new Set<number>();
    let batch = targets;
    let forceBatch = force;
    try {
      while (true) {
        for (const feed of batch) {
          if (feed.is_paused && !forceBatch) continue;
          try {
            await db.syncRssFeed(feed.id, forceBatch);
          } catch {
            failed.add(feed.id);
          }
        }
        const queued = [...forcedSyncQueueRef.current.values()];
        forcedSyncQueueRef.current.clear();
        if (queued.length === 0) break;
        batch = queued;
        forceBatch = true;
      }
      await refreshEntries(selectedRef.current);
      setFailedFeeds(failed);
      setFeeds(await db.getRssFeeds());
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [db, refreshEntries]);

  // Initial load: paint cached data first. Network refresh starts after a short
  // idle window so app launch/navigation remains responsive.
  useEffect(() => {
    let syncTimer: number | undefined;
    (async () => {
      try {
        let list = await seedDefaults(db, await db.getRssFeeds());
        if (!localStorage.getItem(HN_NATIVE_MIGRATED_FLAG)) {
          const legacyHn = list.find((f) => f.url === HN_RSS_URL);
          if (legacyHn) {
            await db.deleteRssFeed(legacyHn.id);
            list = list.filter((f) => f.id !== legacyHn.id);
          }
          localStorage.setItem(HN_NATIVE_MIGRATED_FLAG, "1");
        }
        setFeeds(list);
        // Respect the user's configured default tab, falling back to "all"
        // if it names a feed they've since unsubscribed from.
        const requestedTab = selectedRef.current;
        const validTab: RssTabSelection =
          requestedTab === "all" || requestedTab === "hackernews" || list.some((f) => f.id === requestedTab)
            ? requestedTab
            : "all";
        if (validTab !== requestedTab) {
          selectedRef.current = validTab;
          setSelected(validTab);
        }
        await refreshEntries(validTab);
        setBooting(false);
        const selectedPausedFeed = typeof validTab === "number"
          ? list.find((feed) => feed.id === validTab && feed.is_paused)
          : undefined;
        const stale = list.filter((f) => !f.is_paused && isStale(f.last_fetched_at));
        syncTimer = window.setTimeout(() => {
          void (selectedPausedFeed ? syncFeeds([selectedPausedFeed], true) : syncFeeds(stale));
        }, 1200);
      } finally {
        setBooting(false);
      }
    })();
    return () => { if (syncTimer !== undefined) window.clearTimeout(syncTimer); };
  }, []);

  useEffect(() => {
    void useFeedBookmarksStore.getState().refresh();
  }, []);

  const selectFeed = (sel: RssTabSelection) => {
    setSelected(sel);
    selectedRef.current = sel;
    setBrowse(null);
    refreshEntries(sel);
    if (typeof sel === "number") {
      const feed = feeds.find((candidate) => candidate.id === sel);
      if (feed?.is_paused) void syncFeeds([feed], true);
    }
  };

  const handleRefresh = () => syncFeeds(feeds.filter((feed) => !feed.is_paused));

  const handleAdded = async () => {
    const list = await db.getRssFeeds();
    setFeeds(list);
    syncFeeds(list.filter((f) => !f.is_paused && isStale(f.last_fetched_at)));
  };

  const handleDelete = async (id: number) => {
    await db.deleteRssFeed(id);
    const list = feeds.filter((f) => f.id !== id);
    setFeeds(list);
    if (selected === id) selectFeed("all");
    else refreshEntries(selected);
  };

  const handlePreferences = async (
    id: number,
    category: "article" | "podcast" | null,
    isPinned: boolean
  ) => {
    await db.updateRssFeedPreferences(id, category, isPinned);
    setFeeds(await db.getRssFeeds());
  };

  const handlePausedChange = async (id: number, isPaused: boolean) => {
    await db.setRssFeedPaused(id, isPaused);
    setFeeds((current) => current.map((feed) => feed.id === id ? { ...feed, is_paused: isPaused } : feed));
  };

  const markRead = (entry: RssEntryRow) => {
    if (entry.is_read) return;
    db.markRssEntryRead(entry.id);
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, is_read: true } : e)));
    setUnreadByFeed((prev) => {
      const next = new Map(prev);
      next.set(entry.feed_id, Math.max(0, (next.get(entry.feed_id) ?? 1) - 1));
      return next;
    });
  };

  const openEntry = (entry: RssEntryRow) => {
    markRead(entry);
    const target: BrowseTarget = {
      url: entry.url,
      title: entry.title,
      domain: domainOf(entry.url),
      audioUrl: entry.audio_url ?? null,
      feedTitle: feedsById.get(entry.feed_id)?.title ?? domainOf(entry.url),
      hnItemId: entry.hn_item_id ?? null,
    };
    setBrowse(target);
    addRecentlyRead(target);
    setRecentlyRead(getRecentlyRead());
  };

  const toggleBookmark = (entry: RssEntryRow) => {
    const feedTitle =
      entry.feed_id === -1
        ? "Hacker News"
        : feedsById.get(entry.feed_id)?.title ?? domainOf(entry.url);
    void toggleBookmarkStore({
      url: entry.url,
      title: entry.title,
      feedTitle,
      domain: domainOf(entry.url),
      summary: entry.summary,
      imageUrl: entry.image_url,
      audioUrl: entry.audio_url ?? null,
      audioDuration: entry.audio_duration ?? null,
      hnItemId: entry.hn_item_id ?? null,
      published: entry.published || new Date().toISOString(),
    });
  };

  const openBookmark = (bookmark: FeedBookmark) => {
    const target: BrowseTarget = {
      url: bookmark.url,
      title: bookmark.title,
      domain: bookmark.domain,
      audioUrl: bookmark.audio_url,
      feedTitle: bookmark.feed_title || bookmark.domain,
      hnItemId: bookmark.hn_item_id,
    };
    setBrowse(target);
    addRecentlyRead(target);
    setRecentlyRead(getRecentlyRead());
  };

  const openRecent = (item: RecentlyReadItem) => setBrowse(item);

  const clearRecent = () => {
    clearRecentlyRead();
    setRecentlyRead([]);
  };

  const removeRecent = (url: string) => {
    removeRecentlyRead(url);
    setRecentlyRead((prev) => prev.filter((r) => r.url !== url));
  };

  const openExternal = async (url: string) => {
    try {
      await openShell(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  /** One-click "translate to Chinese": fetches the article and opens TranslateModal — the
   *  modal fetches (or reuses the cached) HN comments itself via hnCommentsStore, given
   *  hnItemId, so there's no need to pre-fetch them here too. */
  const translateEntry = async (entry: RssEntryRow) => {
    if (translatingId !== null) return;
    setTranslatingId(entry.id);
    try {
      const article = await invoke<FetchedArticle>("fetch_article", { url: entry.url });
      setTranslateTarget({
        title: article.title || entry.title,
        articleText: article.text_content,
        hnItemId: entry.hn_item_id ?? null,
      });
    } catch {
      toast(t("reader.extractFailed"));
    } finally {
      setTranslatingId(null);
    }
  };

  /** Queue this article (and its comments, if HN) for AI analysis in the background — stays
   *  on the Feeds page, same headless job as ArticleReader's "Learn" button (useLearnArticle),
   *  keyed by URL in learnChatStore so it survives navigating away and multiple entries can
   *  run at once without affecting each other. Once done, clicking the card's button again
   *  (rather than re-analyzing) opens the resulting AI Chat conversation. */
  const analyzeInBackground = async (entry: RssEntryRow) => {
    const job = useLearnChatStore.getState().jobs[entry.url];
    if (job?.status === "running" || analyzingBackgroundIds.has(entry.id)) return;
    if (job?.status === "done" && job.sessionId) {
      setChatModalSessionId(job.sessionId);
      return;
    }
    setAnalyzingBackgroundIds((prev) => new Set(prev).add(entry.id));
    try {
      const article = await invoke<FetchedArticle>("fetch_article", { url: entry.url });
      markRead(entry);
      let commentsText: string | undefined;
      if (entry.hn_item_id) {
        try {
          commentsText = flattenHnComments(await useHnCommentsStore.getState().fetch(entry.hn_item_id)) || undefined;
        } catch {
          // Comments are a bonus pass — never block analysis on them.
        }
      }
      startLearn(entry.url, {
        title: article.title || entry.title,
        text: article.text_content,
        commentsText,
      });
    } catch (e: any) {
      toast.error(e?.message || t("feeds.analyzeBackground.failed", { title: entry.title }));
    } finally {
      setAnalyzingBackgroundIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  /** Podcast entries: start the episode in the bottom player bar. */
  const playEntry = (entry: RssEntryRow) => {
    if (!entry.audio_url) return;
    markRead(entry);
    const feedTitle = feedsById.get(entry.feed_id)?.title ?? domainOf(entry.url);
    usePodcastPlayerStore.getState().play({
      audioUrl: entry.audio_url,
      title: entry.title,
      feedTitle,
    });
    usePlayerOriginStore.getState().setOrigin({
      kind: "reader",
      url: entry.url,
      title: entry.title,
      domain: domainOf(entry.url),
      audioUrl: entry.audio_url,
      feedTitle,
      hnItemId: entry.hn_item_id ?? null,
    });
  };

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <FeedTabs
        feeds={feeds}
        unreadByFeed={unreadByFeed}
        failedFeeds={failedFeeds}
        selected={selected}
        syncing={syncing}
        onSelect={selectFeed}
        onDelete={handleDelete}
        onPreferences={handlePreferences}
        onPausedChange={handlePausedChange}
        onAdd={() => setShowAdd(true)}
        onRefresh={handleRefresh}
        viewMode={feedsViewMode}
        onSetViewMode={setFeedsViewMode}
        showTitleTranslations={showTitleTranslations}
        onToggleTitleTranslations={() => setShowTitleTranslations((v) => !v)}
        recentlyRead={recentlyRead}
        onOpenRecent={openRecent}
        onClearRecentlyRead={clearRecent}
        onRemoveRecent={removeRecent}
        bookmarks={bookmarks}
        onOpenBookmark={openBookmark}
        onRemoveBookmark={(url) => void removeBookmarkStore(url)}
        bookmarkPendingUrls={bookmarkPendingUrls}
      />

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <FeedsMainContent
          browse={browse}
          onCloseBrowse={() => setBrowse(null)}
          onOpenExternal={openExternal}
          selected={selected}
          feedsViewMode={feedsViewMode}
          booting={booting}
          syncing={syncing}
          feeds={feeds}
          entries={entries}
          feedsById={feedsById}
          translatingId={translatingId}
          analyzingBackgroundIds={analyzingBackgroundIds}
          showTitleTranslations={showTitleTranslations}
          titleTranslations={titleTranslations}
          onOpenEntry={openEntry}
          onPlayEntry={playEntry}
          onTranslateEntry={translateEntry}
          onAnalyzeBackground={analyzeInBackground}
          bookmarkedUrls={bookmarkedUrls}
          bookmarkPendingUrls={bookmarkPendingUrls}
          onToggleBookmark={toggleBookmark}
          onShowAdd={() => setShowAdd(true)}
        />
      </div>

      <AddFeedDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={handleAdded}
        subscribedUrls={new Set(feeds.map((f) => f.url))}
      />

      <TranslateModal
        open={translateTarget !== null}
        onClose={() => setTranslateTarget(null)}
        title={translateTarget?.title ?? ""}
        articleText={translateTarget?.articleText ?? ""}
        hnItemId={translateTarget?.hnItemId ?? null}
      />

      <AiChatModal
        open={chatModalSessionId !== null}
        onClose={() => setChatModalSessionId(null)}
        sessionId={chatModalSessionId ?? undefined}
      />
    </div>
  );
}
