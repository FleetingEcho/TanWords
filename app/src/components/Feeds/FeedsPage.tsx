import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import { useReadingStore } from "@/store/readingStore";
import { useAnalyzeArticle } from "@/hooks/useAnalyzeArticle";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useFeedsNavStore } from "@/store/feedsNavStore";
import { useSettingsStore, type RssTabSelection } from "@/store/settingsStore";
import { ReaderView } from "@/components/Reader/ReaderView";
import type { FetchedArticle } from "@/components/Reader/ArticleReader";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";
import { FeedTabs } from "./FeedTabs";
import { AddFeedDialog } from "./AddFeedDialog";
import { EntryGrid } from "./EntryGrid";
import { HackerNewsSection } from "./HackerNewsSection";
import { TranslateModal } from "@/components/Reading/TranslateModal";
import { flattenHnComments } from "@/lib/hnComments";
import { useHnCommentsStore } from "@/store/hnCommentsStore";
import { useTitleTranslateStore } from "@/store/titleTranslateStore";
import { domainOf, titleTranslateKey } from "./feedUtils";
import { DEFAULT_FEEDS } from "./defaultFeeds";
import { Button } from "@/components/ui/button";

const STALE_MS = 15 * 60 * 1000;
const SEEDED_FLAG = "rss_defaults_seeded";

/** Default feeds added in a later release, after existing installs had already
 * run the one-time SEEDED_FLAG seeding — those installs need a follow-up
 * seeding pass so JS Party / Syntax still show up as real subscriptions (not
 * just AddFeedDialog suggestions) without re-adding anything the user has
 * since unsubscribed from the original batch. */
const SEEDED_FLAG_V2 = "rss_defaults_seeded_v2";
const V2_DEFAULT_URLS = new Set([
  "https://changelog.com/jsparty/feed",
  "https://feed.syntax.fm",
]);

/** One-time cleanup: the hnrss.org RSS subscription is superseded by the
 * native Hacker News section (New/Top/Best via HN's own API) — drop it from
 * existing installs so it doesn't keep showing up as a regular feed tab. */
const HN_RSS_URL = "https://hnrss.org/frontpage?points=100";
const HN_NATIVE_MIGRATED_FLAG = "tanwords_hn_native_migrated";

/** Pulse placeholders shown while the first DB read is in flight, so opening
 * the page never sits on a blank screen while feeds/entries load. */
function EntrySkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-5 space-y-4 animate-fade-in">
      <div className="h-4 w-24 rounded bg-muted animate-pulse" />
      <div className="w-full aspect-[21/9] rounded-2xl bg-muted animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-border overflow-hidden">
            <div className="w-full aspect-[16/9] bg-muted animate-pulse" />
            <div className="p-3.5 space-y-2">
              <div className="h-3.5 w-3/4 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** SQLite datetime('now') is UTC without a zone marker — parse it as UTC. */
function isStale(lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return true;
  const iso = lastFetchedAt.includes("T") ? lastFetchedAt : lastFetchedAt.replace(" ", "T") + "Z";
  const t = new Date(iso).getTime();
  return isNaN(t) || Date.now() - t > STALE_MS;
}

export function FeedsPage() {
  const t = useT();
  const db = useDB();
  const { navigate } = useNavStore();
  const { setDraft } = useReadingStore();
  const { analyze } = useAnalyzeArticle();
  const feedsViewMode = useSettingsStore((s) => s.feedsViewMode);
  const setFeedsViewMode = useSettingsStore((s) => s.setFeedsViewMode);

  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [entries, setEntries] = useState<RssEntryRow[]>([]);
  const [unreadByFeed, setUnreadByFeed] = useState<Map<number, number>>(new Map());
  const [failedFeeds, setFailedFeeds] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<RssTabSelection>(() => useSettingsStore.getState().defaultRssTab);
  const [booting, setBooting] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [learningId, setLearningId] = useState<number | null>(null);
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
  const [browse, setBrowse] = useState<{
    url: string;
    title: string;
    domain: string;
    /** Set for podcast entries — the reader's listen button plays this instead of TTS. */
    audioUrl: string | null;
    feedTitle: string;
    /** Set for entries from hnrss.org-style feeds — shows HN comments below the article. */
    hnItemId: number | null;
  } | null>(null);
  const syncingRef = useRef(false);
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

  /** Sync sequentially in the backend, then update the visible cache once for the whole batch. */
  const syncFeeds = useCallback(async (targets: RssFeed[]) => {
    if (syncingRef.current || targets.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    const failed = new Set<number>();
    for (const feed of targets) {
      try {
        await db.syncRssFeed(feed.id);
      } catch {
        failed.add(feed.id);
      }
    }
    await refreshEntries(selectedRef.current);
    setFailedFeeds(failed);
    setFeeds(await db.getRssFeeds());
    syncingRef.current = false;
    setSyncing(false);
  }, [db, refreshEntries]);

  /** First run only: subscribe the curated defaults (user can unsubscribe freely).
   *  The flag ensures deleted defaults never come back. */
  const seedDefaults = async (existing: RssFeed[]): Promise<RssFeed[]> => {
    try {
      const seeded = await invoke<string | null>("db_get_setting", { key: SEEDED_FLAG });
      if (!seeded) {
        if (existing.length === 0) {
          for (const p of DEFAULT_FEEDS) {
            await db.addRssFeed(p.url, p.title, "", p.desc);
          }
        }
        await invoke("db_set_setting", { key: SEEDED_FLAG, value: "true" });
        return existing.length === 0 ? await db.getRssFeeds() : existing;
      }
      return await seedV2Defaults(existing);
    } catch {
      return existing; // web mode / settings unavailable — skip seeding
    }
  };

  /** One-time follow-up for installs that already ran the original seeding
   * before this batch of defaults existed. Adds any of V2_DEFAULT_URLS not
   * already subscribed, then never touches them again. */
  const seedV2Defaults = async (existing: RssFeed[]): Promise<RssFeed[]> => {
    const seededV2 = await invoke<string | null>("db_get_setting", { key: SEEDED_FLAG_V2 });
    if (seededV2) return existing;

    const subscribedUrls = new Set(existing.map((f) => f.url));
    const toAdd = DEFAULT_FEEDS.filter((p) => V2_DEFAULT_URLS.has(p.url) && !subscribedUrls.has(p.url));
    for (const p of toAdd) {
      await db.addRssFeed(p.url, p.title, "", p.desc);
    }
    await invoke("db_set_setting", { key: SEEDED_FLAG_V2, value: "true" });
    return toAdd.length > 0 ? await db.getRssFeeds() : existing;
  };

  // Initial load: paint cached data first. Network refresh starts after a short
  // idle window so app launch/navigation remains responsive.
  useEffect(() => {
    let syncTimer: number | undefined;
    (async () => {
      try {
        let list = await seedDefaults(await db.getRssFeeds());
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
        const stale = list.filter((f) => isStale(f.last_fetched_at));
        syncTimer = window.setTimeout(() => { void syncFeeds(stale); }, 1200);
      } finally {
        setBooting(false);
      }
    })();
    return () => { if (syncTimer !== undefined) window.clearTimeout(syncTimer); };
  }, []);

  const selectFeed = (sel: RssTabSelection) => {
    setSelected(sel);
    selectedRef.current = sel;
    setBrowse(null);
    refreshEntries(sel);
  };

  const handleRefresh = () => syncFeeds(feeds);

  const handleAdded = async () => {
    const list = await db.getRssFeeds();
    setFeeds(list);
    syncFeeds(list.filter((f) => isStale(f.last_fetched_at)));
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
    setBrowse({
      url: entry.url,
      title: entry.title,
      domain: domainOf(entry.url),
      audioUrl: entry.audio_url ?? null,
      feedTitle: feedsById.get(entry.feed_id)?.title ?? domainOf(entry.url),
      hnItemId: entry.hn_item_id ?? null,
    });
  };

  const goToReading = (title: string, text: string, sourceUrl: string, commentsText?: string, hnItemId?: number | null) => {
    setDraft({ title, text, sourceUrl, origin: "rss", commentsText, hnItemId });
    navigate("reading");
  };

  const openExternal = async (url: string) => {
    try {
      await openShell(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  /** One-click learn: extract the article text and hand it straight to Reading.
   *  HN entries also pull in their comments (analyzed separately, native/colloquial usage). */
  const learnEntry = async (entry: RssEntryRow) => {
    if (learningId !== null) return;
    setLearningId(entry.id);
    try {
      const article = await invoke<FetchedArticle>("fetch_article", { url: entry.url });
      markRead(entry);
      let commentsText: string | undefined;
      if (entry.hn_item_id) {
        try {
          commentsText = flattenHnComments(await useHnCommentsStore.getState().fetch(entry.hn_item_id)) || undefined;
        } catch {
          // Comments are a bonus pass — never block Learn on them.
        }
      }
      goToReading(article.title || entry.title, article.text_content, entry.url, commentsText, entry.hn_item_id ?? null);
    } catch {
      // Extraction failed (paywall etc.) — fall back to the reader so the user sees why.
      toast(t("reader.extractFailed"));
      openEntry(entry);
    } finally {
      setLearningId(null);
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

  /** Queue this article (and its comments, if HN) for AI analysis in the background —
   *  stays on the Feeds page instead of navigating to Reading like the regular Learn
   *  button does; a toast reports completion with a "View" action once it's ready.
   *  Several entries can run concurrently (tracked as a set, not a single id) since
   *  fetch_article and the AI call are plain async I/O — nothing here blocks the UI. */
  const analyzeInBackground = async (entry: RssEntryRow) => {
    if (analyzingBackgroundIds.has(entry.id)) return;
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
      const result = await analyze({
        text: article.text_content,
        title: article.title || entry.title,
        sourceUrl: entry.url,
        origin: "rss",
        commentsText,
        hnItemId: entry.hn_item_id ?? null,
      });
      toast.success(t("feeds.analyzeBackground.done", { title: result.title }), {
        action: {
          label: t("feeds.analyzeBackground.view"),
          onClick: () => {
            useReadingStore.getState().setPendingArticleId(result.articleId);
            navigate("reading");
          },
        },
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

  // Jump back here from the player bar: reopen the in-app reader for whichever
  // entry started the currently playing audio.
  const pendingBrowse = useFeedsNavStore((s) => s.pendingBrowse);
  const clearPendingBrowse = useFeedsNavStore((s) => s.clearPendingBrowse);

  useEffect(() => {
    if (!pendingBrowse) return;
    setBrowse(pendingBrowse);
    clearPendingBrowse();
  }, [pendingBrowse]);

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
        onAdd={() => setShowAdd(true)}
        onRefresh={handleRefresh}
        viewMode={feedsViewMode}
        onSetViewMode={setFeedsViewMode}
        showTitleTranslations={showTitleTranslations}
        onToggleTitleTranslations={() => setShowTitleTranslations((v) => !v)}
      />

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {browse ? (
          <ReaderView
            url={browse.url}
            title={browse.title}
            domain={browse.domain}
            audio={
              browse.audioUrl
                ? { audioUrl: browse.audioUrl, title: browse.title, feedTitle: browse.feedTitle }
                : undefined
            }
            onBack={() => setBrowse(null)}
            onOpenExternal={() => openExternal(browse.url)}
            onLearn={({ title, text, commentsText }) => goToReading(title, text, browse.url, commentsText, browse.hnItemId)}
            hnItemId={browse.hnItemId}
          />
        ) : selected === "hackernews" ? (
          <HackerNewsSection
            viewMode={feedsViewMode}
            learningId={learningId}
            onOpen={openEntry}
            onLearn={learnEntry}
            onTranslate={translateEntry}
            translatingId={translatingId}
            onAnalyzeBackground={analyzeInBackground}
            analyzingBackgroundIds={analyzingBackgroundIds}
            showTitleTranslations={showTitleTranslations}
            titleTranslations={titleTranslations}
          />
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {booting && entries.length === 0 ? (
                <EntrySkeleton />
              ) : feeds.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                  <p className="text-sm text-muted-foreground max-w-sm">{t("feeds.noFeeds")}</p>
                  <Button
                    onClick={() => setShowAdd(true)}
                    className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    + {t("feeds.addFeed")}
                  </Button>
                </div>
              ) : entries.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    {syncing ? t("feeds.refreshing") : t("feeds.noArticles")}
                  </p>
                </div>
              ) : (
                <EntryGrid
                  entries={entries}
                  feedsById={feedsById}
                  learningId={learningId}
                  onOpen={openEntry}
                  onLearn={learnEntry}
                  onPlay={playEntry}
                  onTranslate={translateEntry}
                  translatingId={translatingId}
                  onAnalyzeBackground={analyzeInBackground}
                  analyzingBackgroundIds={analyzingBackgroundIds}
                  titleTranslations={titleTranslations}
                  viewMode={feedsViewMode}
                />
              )}
            </div>
          </>
        )}
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
    </div>
  );
}
