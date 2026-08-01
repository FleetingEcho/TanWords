/**
 * Articles tab — cached rss_entries (desktop FeedsPage lists), flattened for
 * mobile: horizontal feed filter chips (全**部** + per-feed unread badges) on
 * top, grouped date buckets (今天/昨天/本周/更早) as FlashList headers.
 * Pull-to-refresh re-fetches every feed's RSS document then re-queries; the
 * desktop kicks this off from the Feeds page header (feeds.refresh).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Button, Divider, EmptyState, Skeleton, tapHaptic } from "@/components/ui";
import {
  db_get_rss_entries,
  db_get_rss_feeds,
  db_get_rss_unread_counts,
  db_mark_rss_entry_read,
  db_replace_feed_entries,
} from "@/db/feeds";
import { fetchAndParseFeed } from "@/services/rss";
import { usePlayerStore } from "@/services/player";
import { useFeedBookmarksStore } from "@/store/feedBookmarksStore";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";
import { EntryCard } from "./EntryCard";
import { dateGroupOf, type DateGroup } from "./format";

const PAGE_SIZE = 50;

type Row =
  | { kind: "header"; key: string; titleKey: DateGroup }
  | { kind: "entry"; key: string; entry: RssEntryRow };

export function ArticlesSegment() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [unread, setUnread] = useState<Map<number, number>>(new Map());
  const [filterFeedId, setFilterFeedId] = useState<number | null>(null);
  const [entries, setEntries] = useState<RssEntryRow[]>([]);
  const [totalLoaded, setTotalLoaded] = useState(PAGE_SIZE);
  const [booting, setBooting] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const bookmarksRefresh = useFeedBookmarksStore((s) => s.refresh);

  const query = useCallback(async (feedId: number | null, lim: number) => {
    const [feedsR, unreadR, entriesR] = await Promise.allSettled([
      db_get_rss_feeds(),
      db_get_rss_unread_counts(),
      db_get_rss_entries({ feedId, limit: lim }),
    ]);
    if (feedsR.status === "fulfilled") setFeeds(feedsR.value);
    if (unreadR.status === "fulfilled") setUnread(new Map(unreadR.value));
    if (entriesR.status === "fulfilled") setEntries(entriesR.value);
    const firstError =
      entriesR.status === "rejected"
        ? entriesR.reason
        : feedsR.status === "rejected"
          ? feedsR.reason
          : null;
    setLoadError(firstError ? String(firstError instanceof Error ? firstError.message : firstError) : null);
    return entriesR;
  }, []);

  const syncFeeds = useCallback(
    async (list: RssFeed[]) => {
      // Article + podcast feeds both refresh here (entries land in the same table).
      const results = await Promise.allSettled(
        list.map(async (f) => {
          const parsed = await fetchAndParseFeed(f.url);
          await db_replace_feed_entries({ feedId: f.id, entries: parsed.entries });
        })
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      setSyncError(failed > 0 ? t("feeds.syncFailed") : null);
    },
    [t]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await bookmarksRefresh();
        await db_get_rss_entries({ feedId: null, limit: PAGE_SIZE }).then((rows) => setEntries(rows)).catch(() => {});
        const feedsList = await db_get_rss_feeds().catch(() => [] as RssFeed[]);
        const unreadPairs = await db_get_rss_unread_counts().catch(() => [] as Array<[number, number]>);
        if (cancelled) return;
        setFeeds(feedsList);
        setUnread(new Map(unreadPairs));
        setBooting(false);
        // First visit: kick a one-shot sync so feeds subscribed on the desktop
        // aren't stale until the first manual pull-to-refresh.
        if (feedsList.length > 0) {
          setSyncing(true);
          try {
            await syncFeeds(feedsList);
            if (!cancelled) await query(filterFeedId, PAGE_SIZE);
          } finally {
            if (!cancelled) setSyncing(false);
          }
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
          setSyncing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    let list = feeds;
    try {
      list = await db_get_rss_feeds();
      setFeeds(list);
    } catch {
      /* keep existing list */
    }
    if (list.length > 0) {
      try {
        await syncFeeds(list);
      } catch {
        setSyncError(t("feeds.syncFailed"));
      }
    }
    await query(filterFeedId, Math.max(totalLoaded, PAGE_SIZE)).catch(() => {});
    setSyncing(false);
  }, [feeds, filterFeedId, totalLoaded, query, syncFeeds, t]);

  const switchFilter = useCallback(
    (feedId: number | null) => {
      setFilterFeedId(feedId);
      void query(feedId, PAGE_SIZE).catch(() => {});
      setTotalLoaded(PAGE_SIZE);
    },
    [query]
  );

  const loadMore = useCallback(() => {
    const next = totalLoaded + PAGE_SIZE;
    setTotalLoaded(next);
    void query(filterFeedId, next).catch(() => {});
  }, [filterFeedId, totalLoaded, query]);

  /* ---------- grouping ---------- */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastGroup: DateGroup | null = null;
    for (const entry of entries) {
      const g = dateGroupOf(entry.published);
      if (g !== lastGroup) {
        out.push({ kind: "header", key: `h-${g}-${out.length}`, titleKey: g });
        lastGroup = g;
      }
      out.push({ kind: "entry", key: `e-${entry.id}`, entry });
    }
    return out;
  }, [entries]);

  const feedsById = useMemo(() => new Map(feeds.map((f) => [f.id, f])), [feeds]);
  const totalUnread = useMemo(() => [...unread.values()].reduce((a, b) => a + b, 0), [unread]);
  const articleFeeds = useMemo(
    // Chips list every feed with unread entries (or just feeds): podcasts show
    // up here too on desktop's "全部" view; the podcast tab filters by enclosure.
    () => feeds.filter((f) => f.category !== "podcast" || unread.has(f.id)),
    [feeds, unread]
  );

  const toggleBookmark = useFeedBookmarksStore((s) => s.toggle);
  const bookmarkedUrls = useFeedBookmarksStore((s) => s.urls);
  const bookmarkPending = useFeedBookmarksStore((s) => s.pending);
  const playerStatus = usePlayerStore((s) => s.status);
  const playerTrack = usePlayerStore((s) => s.track);
  const playerPlay = usePlayerStore((s) => s.play);
  const playerToggle = usePlayerStore((s) => s.toggle);

  const openEntry = useCallback(
    (entry: RssEntryRow) => {
      void db_mark_rss_entry_read({ id: entry.id }).then(() => {
        setEntries((cur) => cur.map((e) => (e.id === entry.id ? { ...e, is_read: true } : e)));
        void db_get_rss_unread_counts().then((pairs) => setUnread(new Map(pairs))).catch(() => {});
      }).catch(() => {});
      const feedTitle = feedsById.get(entry.feed_id)?.title ?? "";
      router.push({
        pathname: "/reader/[url]",
        params: {
          url: entry.url,
          entryId: String(entry.id),
          ...(feedTitle ? { feedTitle } : {}),
        },
      });
    },
    [feedsById, router]
  );

  const playEntry = useCallback(
    (entry: RssEntryRow) => {
      const feedTitle = feedsById.get(entry.feed_id)?.title ?? "";
      if (playerTrack?.url === entry.audio_url && (playerStatus === "playing" || playerStatus === "paused")) {
        playerToggle();
        return;
      }
      if (entry.audio_url) {
        void playerPlay({ url: entry.audio_url, title: entry.title, feedTitle });
      }
    },
    [feedsById, playerPlay, playerToggle, playerTrack, playerStatus]
  );

  /* ---------- header: filter chips ---------- */
  const chips = (
    <View>
      <View className="px-4 pb-2 pt-1">
        <Text className="text-[13px] text-muted-foreground">
          {syncing ? t("feeds.refreshing") : totalUnread > 0 ? t("feeds.unreadSummary", { n: totalUnread }) : ""}
        </Text>
      </View>
      <View className="pb-1">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {[{ id: null as number | null, title: t("feeds.all") }, ...articleFeeds.map((f) => ({ id: f.id as number | null, title: f.title }))].map((item) => {
            const active = filterFeedId === item.id;
            const count = item.id === null ? totalUnread : unread.get(item.id) ?? 0;
            return (
              <Pressable
                key={String(item.id ?? "all")}
                onPress={() => {
                  tapHaptic();
                  switchFilter(item.id);
                }}
                className={`min-h-[32px] flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${active ? "bg-primary" : "bg-muted"}`}
                style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
              >
                <Text className={`text-[12px] font-medium ${active ? "text-primary-foreground" : "text-foreground"}`} numberOfLines={1}>
                  {item.title}
                </Text>
                {count > 0 ? (
                  <View className={`min-w-[18px] items-center rounded-full px-1 ${active ? "bg-primary-foreground" : "bg-primary"}`}>
                    <Text className={`text-[10px] font-bold ${active ? "text-primary" : "text-primary-foreground"}`}>
                      {count > 99 ? "99+" : count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );

  /* ---------- body ---------- */
  let body: React.ReactNode;
  if (booting && entries.length === 0) {
    body = (
      <View className="px-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="mb-3 h-[86px]" />
        ))}
      </View>
    );
  } else if (loadError) {
    body = (
      <View className="items-center px-6 pt-10">
        <Text className="text-center text-[13px] text-destructive">{loadError}</Text>
        <Button title={t("podcast.retry")} variant="secondary" size="sm" className="mt-3" onPress={() => void onRefresh()} />
      </View>
    );
  } else if (feeds.length === 0) {
    body = (
      <EmptyState
        icon="newspaper-outline"
        title={t("feeds.noFeeds.title")}
        hint={t("feeds.noFeeds.mobileHint")}
      />
    );
  } else if (entries.length === 0) {
    body = (
      <EmptyState
        icon="file-tray-outline"
        title={t("feeds.noArticles")}
        hint={syncError ?? undefined}
        actionTitle={t("feeds.refresh")}
        onAction={() => void onRefresh()}
      />
    );
  } else {
    body = (
      <FlashList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl refreshing={syncing} onRefresh={() => void onRefresh()} tintColor={p.primary} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <Text className="bg-background px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t(item.titleKey)}
            </Text>
          ) : (
            <EntryCard
              entry={item.entry}
              feedTitle={feedsById.get(item.entry.feed_id)?.title ?? ""}
              bookmarked={bookmarkedUrls.has(item.entry.url)}
              bookmarkPending={bookmarkPending.has(item.entry.url)}
              isActiveTrack={playerTrack?.url === item.entry.audio_url}
              isPlaying={playerTrack?.url === item.entry.audio_url && playerStatus === "playing"}
              onOpen={openEntry}
              onPlay={playEntry}
              onToggleBookmark={(e) =>
                void toggleBookmark({
                  url: e.url,
                  title: e.title,
                  feedTitle: feedsById.get(e.feed_id)?.title ?? "",
                  domain: (() => {
                    try {
                      return new URL(e.url).hostname.replace(/^www\./, "");
                    } catch {
                      return "";
                    }
                  })(),
                  summary: e.summary,
                  imageUrl: e.image_url ?? null,
                  audioUrl: e.audio_url ?? null,
                  audioDuration: e.audio_duration ?? null,
                  hnItemId: e.hn_item_id ?? null,
                  published: e.published,
                })
              }
            />
          )
        }
        ItemSeparatorComponent={() => <Divider className="mx-4" />}
      />
    );
  }

  return (
    <View className="flex-1">
      {chips}
      {body}
    </View>
  );
}
