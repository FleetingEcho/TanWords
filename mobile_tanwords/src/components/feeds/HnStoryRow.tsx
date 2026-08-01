/**
 * HnStoryRow — one Hacker News story in a FlashList. Desktop
 * HackerNewsSection renders score/comment count as icon badges (upvote /
 * chat bubble); same here, with a tappable row. React.memo for list churn.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { tapHaptic } from "@/components/ui";
import { useFeedBookmarksStore } from "@/store/feedBookmarksStore";
import type { HnStorySummary } from "@/services/hn";
import { domainOf, relativeTime } from "./format";

export interface HnStoryRowProps {
  story: HnStorySummary;
  onOpen: (story: HnStorySummary) => void;
  onOpenComments: (story: HnStorySummary) => void;
}

export const HnStoryRow = React.memo(function HnStoryRow({ story, onOpen, onOpenComments }: HnStoryRowProps) {
  const t = useT();
  const p = usePalette();
  const bookmarked = useFeedBookmarksStore((s) => s.urls.has(story.url));
  const toggle = useFeedBookmarksStore((s) => s.toggle);
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onOpen(story);
      }}
      className="px-4 py-3"
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      <Text numberOfLines={2} className="text-[15px] font-semibold leading-5 text-foreground">
        {story.title}
      </Text>
      <Text numberOfLines={1} className="mt-1 text-[12px] text-muted-foreground">
        {domainOf(story.url)}
        {story.by ? ` · ${story.by}` : ""}
        {story.time ? ` · ${relativeTime(story.time * 1000, t)}` : ""}
      </Text>
      <View className="mt-2 flex-row items-center gap-4">
        <View className="flex-row items-center gap-1">
          <Ionicons name="triangle-outline" size={13} color={p.primary} />
          <Text className="text-[12px] font-semibold text-foreground">{story.score ?? 0}</Text>
        </View>
        <Pressable
          onPress={() => {
            tapHaptic();
            onOpenComments(story);
          }}
          hitSlop={8}
          className="min-h-[28px] flex-row items-center gap-1"
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
        >
          <Ionicons name="chatbubble-outline" size={13} color={p["muted-foreground"]} />
          <Text className="text-[12px] text-muted-foreground">{story.descendants ?? 0}</Text>
        </Pressable>
        <View className="flex-1" />
        <Pressable
          onPress={() =>
            void toggle({
              url: story.url,
              title: story.title,
              feedTitle: "Hacker News",
              domain: domainOf(story.url),
              summary: "",
              imageUrl: null,
              audioUrl: null,
              audioDuration: null,
              hnItemId: story.id,
              published: story.time ? new Date(story.time * 1000).toISOString() : "",
            })
          }
          hitSlop={10}
          className="min-h-[28px] min-w-[28px] items-center justify-center"
        >
          <Ionicons
            name={bookmarked ? "bookmark" : "bookmark-outline"}
            size={16}
            color={bookmarked ? p.primary : p["muted-foreground"]}
          />
        </Pressable>
      </View>
    </Pressable>
  );
});
