/**
 * Feeds (订阅) — desktop FeedsPage flattened for mobile: 文章 / 播客 / HN /
 * 收藏 segments under a large-title header. The podcast MiniPlayer is mounted
 * globally above the tab bar (see app/(tabs)/_layout.tsx) so playback persists
 * while switching tabs (desktop PlayerBar semantics).
 */
import React, { useState } from "react";
import { View } from "react-native";
import { Screen, ScreenHeader, SegmentedTabs } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { ArticlesSegment } from "@/components/feeds/ArticlesSegment";
import { PodcastsSegment } from "@/components/feeds/PodcastsSegment";
import { HnSegment } from "@/components/feeds/HnSegment";
import { BookmarksSegment } from "@/components/feeds/BookmarksSegment";

type Segment = "articles" | "podcasts" | "hn" | "bookmarks";

export default function FeedsScreen() {
  const t = useT();
  const [segment, setSegment] = useState<Segment>("articles");

  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <View>
          <ScreenHeader title={t("feeds.title")} />
          <View className="px-4 pb-1">
            <SegmentedTabs<Segment>
              options={[
                { key: "articles", label: t("feeds.section.articles") },
                { key: "podcasts", label: t("feeds.section.podcasts") },
                { key: "hn", label: t("hn.tab") },
                { key: "bookmarks", label: t("feeds.bookmarks.title") },
              ]}
              value={segment}
              onChange={setSegment}
            />
          </View>
        </View>
      }
    >
      <View className="flex-1">
        {segment === "articles" ? (
          <ArticlesSegment />
        ) : segment === "podcasts" ? (
          <PodcastsSegment />
        ) : segment === "hn" ? (
          <HnSegment />
        ) : (
          <BookmarksSegment />
        )}
        {/* MiniPlayer mounts globally in (tabs)/_layout, above the tab bar */}
      </View>
    </Screen>
  );
}
