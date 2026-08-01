/**
 * Bookmarks tab — feedBookmarksStore items, newest first (the store refreshes
 * via db_get_feed_bookmarks). Tap opens the in-app reader; long-press removes.
 * Matches desktop FeedTabs bookmark panel semantics (onOpenBookmark /
 * onRemoveBookmark), adapted: hover delete-button → long-press.
 */
import React, { useCallback, useEffect } from "react";
import { Alert, Pressable, RefreshControl, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Divider, EmptyState, tapHaptic } from "@/components/ui";
import { useFeedBookmarksStore } from "@/store/feedBookmarksStore";
import type { FeedBookmark } from "@/hooks/useDB.types";
import { relativeTime } from "./format";

const BookmarkRow = React.memo(function BookmarkRow({
  item,
  onOpen,
  onRemove,
}: {
  item: FeedBookmark;
  onOpen: (b: FeedBookmark) => void;
  onRemove: (b: FeedBookmark) => void;
}) {
  const p = usePalette();
  const t = useT();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onOpen(item);
      }}
      onLongPress={() => {
        void import("expo-haptics").then((h) => h.impactAsync(h.ImpactFeedbackStyle.Medium).catch(() => {}));
        Alert.alert(t("feeds.unbookmark"), item.title, [
          { text: t("feeds.bookmarks.cancel"), style: "cancel" },
          { text: t("feeds.recentlyRead.remove"), style: "destructive", onPress: () => onRemove(item) },
        ]);
      }}
      className="px-4 py-3"
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      <View className="flex-row items-start gap-2.5">
        <Text numberOfLines={2} className="flex-1 text-[15px] font-semibold leading-5 text-foreground">
          {item.title}
        </Text>
      </View>
      <Text numberOfLines={2} className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
        {item.summary}
      </Text>
      <Text numberOfLines={1} className="mt-1.5 text-[11px] text-muted-foreground">
        {item.feed_title}
        {item.domain ? ` · ${item.domain}` : ""}
        {item.created_at ? ` · ${relativeTime(item.created_at, t)}` : ""}
      </Text>
    </Pressable>
  );
});

export function BookmarksSegment() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const { items, loaded, refresh, remove } = useFeedBookmarksStore();
  const [pullRefreshing, setPullRefreshing] = React.useState(false);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  const onRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refresh();
    } finally {
      setPullRefreshing(false);
    }
  }, [refresh]);

  const open = useCallback(
    (b: FeedBookmark) => {
      router.push({
        pathname: "/reader/[url]",
        params: { url: b.url, ...(b.feed_title ? { feedTitle: b.feed_title } : {}) },
      });
    },
    [router]
  );

  return (
    <View className="flex-1">
      {!loaded && items.length === 0 ? null : items.length === 0 ? (
        <EmptyState icon="bookmarks-outline" title={t("feeds.bookmarks.empty")} hint={t("feeds.bookmarks.hint")} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(b) => `b-${b.id}-${b.url}`}
          contentContainerStyle={{ paddingBottom: 96 }}
          refreshControl={
            <RefreshControl refreshing={pullRefreshing} onRefresh={() => void onRefresh()} tintColor={p.primary} />
          }
          renderItem={({ item }) => (
            <BookmarkRow item={item} onOpen={open} onRemove={(b) => void remove(b.url)} />
          )}
          ItemSeparatorComponent={() => <Divider className="mx-4" />}
        />
      )}
    </View>
  );
}
