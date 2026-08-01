/**
 * HN tab — native Hacker News browser (desktop HackerNewsSection): section
 * segmented tabs (热门/最新/精选) + Algolia search, stories from
 * services/hn.ts. List state persists in hnBrowseStore across mount cycles
 * (segment switches unmount the list; the store is the "already loaded"
 * memory, mirroring the desktop's reason for that store).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Divider, EmptyState, SearchBar, SegmentedTabs, Skeleton, tapHaptic } from "@/components/ui";
import { fetchHnSection, searchHn, type HnStorySummary } from "@/services/hn";
import { useHnBrowseStore } from "@/store/hnBrowseStore";
import { HnStoryRow } from "./HnStoryRow";

const PAGE = 25;

export function HnSegment() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const section = useHnBrowseStore((s) => s.section);
  const query = useHnBrowseStore((s) => s.query);
  const activeQuery = useHnBrowseStore((s) => s.activeQuery);
  const stories = useHnBrowseStore((s) => s.stories);
  const hasMore = useHnBrowseStore((s) => s.hasMore);
  const status = useHnBrowseStore((s) => s.status);
  const loadedKey = useHnBrowseStore((s) => s.loadedKey);

  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** onEndReached fires on mount for short lists — gate it briefly. */
  const [endReachedArmedAt, setEndReachedArmedAt] = useState(0);

  const keyFor = activeQuery ? `search:${activeQuery}` : `section:${section}`;

  const loadFirstPage = useCallback(
    async (force: boolean) => {
      const key = activeQuery ? `search:${activeQuery}` : `section:${section}`;
      if (!force && loadedKey === key && stories.length > 0) return;
      const store = useHnBrowseStore.getState();
      store.setStatus("loading");
      store.setLoadedKey(key);
      try {
        if (activeQuery) {
          const page = await searchHn(activeQuery, 0);
          store.setStories(page.stories);
          store.setHasMore(page.page + 1 < page.total_pages);
          store.setNextSearchPage(1);
        } else {
          const pageData = await fetchHnSection(section, 0, PAGE);
          store.setStories(pageData.stories);
          store.setHasMore(PAGE < pageData.total);
        }
        store.setStatus("ready");
        setEndReachedArmedAt(Date.now() + 400);
      } catch (e) {
        console.error("[hn] load failed:", e);
        store.setStatus("error");
      }
    },
    [activeQuery, section, loadedKey, stories.length]
  );

  useEffect(() => {
    void loadFirstPage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, section]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadFirstPage(true);
    setRefreshing(false);
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || status !== "ready" || stories.length === 0) return;
    if (Date.now() < endReachedArmedAt) return;
    setLoadingMore(true);
    const store = useHnBrowseStore.getState();
    try {
      if (activeQuery) {
        const page = await searchHn(activeQuery, store.nextSearchPage);
        store.setStories((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...page.stories.filter((x) => !seen.has(x.id))];
        });
        store.setHasMore(page.page + 1 < page.total_pages);
        store.setNextSearchPage(page.page + 1);
      } else {
        const pageData = await fetchHnSection(section, stories.length, PAGE);
        store.setStories((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...pageData.stories.filter((x) => !seen.has(x.id))];
        });
        store.setHasMore(stories.length + PAGE < pageData.total);
      }
    } catch (e) {
      console.error("[hn] load more failed:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [activeQuery, section, hasMore, loadingMore, status, stories.length, endReachedArmedAt]);

  const switchSection = useCallback((v: "top" | "new" | "best") => {
    useHnBrowseStore.setState({ section: v, query: "", activeQuery: "" });
  }, []);

  const submitSearch = useCallback(() => {
    if (query.trim() !== activeQuery) {
      useHnBrowseStore.setState({ activeQuery: query.trim() });
    }
  }, [query, activeQuery]);

  const openStory = useCallback(
    (story: HnStorySummary) => router.push({ pathname: "/reader/[url]", params: { url: story.url, hnItemId: String(story.id) } }),
    [router]
  );
  const openComments = useCallback(
    (story: HnStorySummary) =>
      router.push({
        pathname: "/feed/hackernews",
        params: {
          id: String(story.id),
          title: story.title,
          url: story.url,
          by: story.by ?? "",
          score: String(story.score ?? 0),
          time: String(story.time ?? 0),
          descendants: String(story.descendants ?? 0),
        },
      }),
    [router]
  );

  /* ---------- header ---------- */
  const header = (
    <View className="gap-2 px-4 pb-2 pt-1">
      <SegmentedTabs
        options={[
          { key: "top" as const, label: t("hn.section.top") },
          { key: "new" as const, label: t("hn.section.new") },
          { key: "best" as const, label: t("hn.section.best") },
        ]}
        value={activeQuery ? ("top" as const) : section}
        onChange={switchSection}
      />
      <SearchBar
        value={query}
        onChangeText={(v) => {
          useHnBrowseStore.getState().setQuery(v);
          if (v === "" && activeQuery) useHnBrowseStore.getState().setActiveQuery("");
        }}
        placeholder={t("hn.search.placeholder")}
      />
      {query.trim() !== "" && query.trim() !== activeQuery ? (
        <View className="items-end">
          <SearchButton onPress={submitSearch} label={t("hn.search.submit")} />
        </View>
      ) : null}
    </View>
  );

  /* ---------- body ---------- */
  let body: React.ReactNode;
  if (status === "loading" && stories.length === 0) {
    body = (
      <View className="px-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="mb-3 h-[84px]" />
        ))}
      </View>
    );
  } else if (status === "error") {
    body = (
      <EmptyState icon="cloud-offline-outline" title={t("hn.section.error")} actionTitle={t("podcast.retry")} onAction={() => void refresh()} />
    );
  } else if (stories.length === 0) {
    body = <EmptyState icon="search-outline" title={t("hn.search.empty")} />;
  } else {
    body = (
      <FlashList
        data={stories}
        keyExtractor={(story) => `hn-${story.id}`}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={p.primary} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <View className="py-3">
              <Skeleton className="mx-4 h-[56px]" />
            </View>
          ) : null
        }
        renderItem={({ item }) => <HnStoryRow story={item} onOpen={openStory} onOpenComments={openComments} />}
        ItemSeparatorComponent={() => <Divider className="mx-4" />}
      />
    );
  }

  return (
    <View className="flex-1">
      {header}
      {body}
    </View>
  );
}

function SearchButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      className="min-h-[32px] items-center justify-center rounded-lg bg-primary px-4"
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
    >
      <Text className="text-[13px] font-semibold text-primary-foreground">{label}</Text>
    </Pressable>
  );
}
