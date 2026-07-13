import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import { useReadingStore } from "@/store/readingStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useFeedsNavStore } from "@/store/feedsNavStore";
import { ReaderView } from "@/components/Reader/ReaderView";
import { RefreshIcon } from "@/components/ui/icons";
import type { FetchedArticle } from "@/components/Reader/ArticleReader";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";
import { FeedRail } from "./FeedRail";
import { AddFeedDialog } from "./AddFeedDialog";
import { EntryGrid } from "./EntryGrid";
import { domainOf } from "./feedUtils";
import { DEFAULT_FEEDS } from "./defaultFeeds";
import { Button } from "@/components/ui/button";

const STALE_MS = 15 * 60 * 1000;
const SEEDED_FLAG = "rss_defaults_seeded";

/** Default feeds added in a later release, after existing installs had already
 * run the one-time SEEDED_FLAG seeding — those installs need a follow-up
 * seeding pass so JS Party / Syntax / Hacker News still show up as real
 * subscriptions (not just AddFeedDialog suggestions) without re-adding
 * anything the user has since unsubscribed from the original batch. */
const SEEDED_FLAG_V2 = "rss_defaults_seeded_v2";
const V2_DEFAULT_URLS = new Set([
  "https://changelog.com/jsparty/feed",
  "https://feed.syntax.fm",
  "https://hnrss.org/frontpage?points=100",
]);

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

  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [entries, setEntries] = useState<RssEntryRow[]>([]);
  const [unreadByFeed, setUnreadByFeed] = useState<Map<number, number>>(new Map());
  const [failedFeeds, setFailedFeeds] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | "all">("all");
  const [booting, setBooting] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [learningId, setLearningId] = useState<number | null>(null);
  const [browse, setBrowse] = useState<{
    url: string;
    title: string;
    domain: string;
    /** Set for podcast entries — the reader's listen button plays this instead of TTS. */
    audioUrl: string | null;
    feedTitle: string;
  } | null>(null);
  const syncingRef = useRef(false);

  const feedsById = new Map(feeds.map((f) => [f.id, f]));

  const refreshEntries = useCallback(async (sel: number | "all") => {
    const rows = await db.getRssEntries(sel === "all" ? null : sel);
    setEntries(rows);
    const counts = await db.getRssUnreadCounts();
    setUnreadByFeed(new Map(counts));
  }, [db]);

  /** Sync the given feeds sequentially; refresh the view after each one lands. */
  const syncFeeds = useCallback(async (targets: RssFeed[], sel: number | "all") => {
    if (syncingRef.current || targets.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    const failed = new Set<number>();
    for (const feed of targets) {
      try {
        await db.syncRssFeed(feed.id);
        await refreshEntries(sel);
      } catch {
        failed.add(feed.id);
      }
    }
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

  // Initial load: render from the DB immediately, then sync stale feeds in the background.
  useEffect(() => {
    (async () => {
      try {
        const list = await seedDefaults(await db.getRssFeeds());
        setFeeds(list);
        await refreshEntries("all");
        setBooting(false);
        syncFeeds(list.filter((f) => isStale(f.last_fetched_at)), "all");
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const selectFeed = (sel: number | "all") => {
    setSelected(sel);
    setBrowse(null);
    refreshEntries(sel);
  };

  const handleRefresh = () => syncFeeds(feeds, selected);

  const handleAdded = async () => {
    const list = await db.getRssFeeds();
    setFeeds(list);
    syncFeeds(list.filter((f) => isStale(f.last_fetched_at)), selected);
  };

  const handleDelete = async (id: number) => {
    await db.deleteRssFeed(id);
    const list = feeds.filter((f) => f.id !== id);
    setFeeds(list);
    if (selected === id) selectFeed("all");
    else refreshEntries(selected);
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
    });
  };

  const goToReading = (title: string, text: string, sourceUrl: string) => {
    setDraft({ title, text, sourceUrl, origin: "rss" });
    navigate("reading");
  };

  const openExternal = async (url: string) => {
    try {
      await openShell(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  /** One-click learn: extract the article text and hand it straight to Reading. */
  const learnEntry = async (entry: RssEntryRow) => {
    if (learningId !== null) return;
    setLearningId(entry.id);
    try {
      const article = await invoke<FetchedArticle>("fetch_article", { url: entry.url });
      markRead(entry);
      goToReading(article.title || entry.title, article.text_content, entry.url);
    } catch {
      // Extraction failed (paywall etc.) — fall back to the reader so the user sees why.
      toast(t("reader.extractFailed"));
      openEntry(entry);
    } finally {
      setLearningId(null);
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

  const selectedFeed = selected === "all" ? null : feedsById.get(selected);

  return (
    <div className="flex h-full animate-fade-in">
      <FeedRail
        feeds={feeds}
        unreadByFeed={unreadByFeed}
        failedFeeds={failedFeeds}
        selected={selected}
        onSelect={selectFeed}
        onDelete={handleDelete}
        onAdd={() => setShowAdd(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
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
            onLearn={({ title, text }) => goToReading(title, text, browse.url)}
          />
        ) : (
          <>
            <div className="flex items-center gap-3 px-6 h-12 border-b border-border shrink-0">
              <h2 className="flex-1 min-w-0 text-sm font-semibold truncate">
                {selectedFeed ? selectedFeed.title || domainOf(selectedFeed.url) : t("feeds.all")}
              </h2>
              {syncing && <span className="text-[11px] text-muted-foreground">{t("feeds.refreshing")}</span>}
              <Button
                variant="ghost"
                onClick={handleRefresh}
                disabled={syncing || feeds.length === 0}
                title={t("feeds.refresh")}
                className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              >
                <RefreshIcon className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              </Button>
            </div>

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
    </div>
  );
}
