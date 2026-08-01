/**
 * Podcasts tab — every cached entry with an audio enclosure, newest first.
 * Rows are the same EntryCard shape as Articles (play chip prominent), and the
 * MiniPlayer bar floats above the list bottom. Desktop keeps the same split:
 * FeedsPage podcast tab filters entries by audio_url.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Divider, EmptyState, Skeleton } from "@/components/ui";
import { db_get_rss_entries, db_get_rss_feeds, db_mark_rss_entry_read } from "@/db/feeds";
import { usePlayerStore } from "@/services/player";
import { useFeedBookmarksStore } from "@/store/feedBookmarksStore";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";
import { EntryCard } from "./EntryCard";

export function PodcastsSegment() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const [entries, setEntries] = useState<RssEntryRow[]>([]);
  const [feedsById, setFeedsById] = useState<Map<number, RssFeed>>(new Map());
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const bookmarksRefresh = useFeedBookmarksStore((s) => s.refresh);
  const bookmarkedUrls = useFeedBookmarksStore((s) => s.urls);
  const bookmarkPending = useFeedBookmarksStore((s) => s.pending);
  const toggleBookmark = useFeedBookmarksStore((s) => s.toggle);
  const { status: playerStatus, track: playerTrack, play, toggle } = usePlayerStore();

  const load = useCallback(async () => {
    const [feedsR, entriesR] = await Promise.allSettled([
      db_get_rss_feeds(),
      db_get_rss_entries({ limit: 300 }),
    ]);
    const feeds = feedsR.status === "fulfilled" ? feedsR.value : [];
    if (entriesR.status === "fulfilled") {
      const eps = entriesR.value.filter((e) => e.audio_url);
      setEntries(eps);
    }
    setFeedsById(new Map(feeds.map((f) => [f.id, f])));
    setBooting(false);
  }, []);

  useEffect(() => {
    void bookmarksRefresh();
    void load();
  }, [bookmarksRefresh, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const openEntry = useCallback(
    (entry: RssEntryRow) => {
      void db_mark_rss_entry_read({ id: entry.id }).then(() => {
        setEntries((cur) => cur.map((e) => (e.id === entry.id ? { ...e, is_read: true } : e)));
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
        toggle();
        return;
      }
      if (entry.audio_url) void play({ url: entry.audio_url, title: entry.title, feedTitle });
    },
    [feedsById, play, toggle, playerTrack, playerStatus]
  );

  let body: React.ReactNode;
  if (booting && entries.length === 0) {
    body = (
      <View className="px-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="mb-3 h-[86px]" />
        ))}
      </View>
    );
  } else if (entries.length === 0) {
    body = (
      <EmptyState
        icon="headset-outline"
        title={t("feeds.podcasts.empty")}
        hint={t("feeds.podcasts.emptyHint")}
      />
    );
  } else {
    body = (
      <FlashList
        data={entries}
        keyExtractor={(e) => `p-${e.id}`}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.primary} />
        }
        renderItem={({ item }) => (
          <EntryCard
            entry={item}
            feedTitle={feedsById.get(item.feed_id)?.title ?? ""}
            bookmarked={bookmarkedUrls.has(item.url)}
            bookmarkPending={bookmarkPending.has(item.url)}
            isActiveTrack={playerTrack?.url === item.audio_url}
            isPlaying={playerTrack?.url === item.audio_url && playerStatus === "playing"}
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
        )}
        ItemSeparatorComponent={() => <Divider className="mx-4" />}
      />
    );
  }

  return <View className="flex-1">{body}</View>;
}
