/**
 * EntryCard — one RSS entry row (article or podcast episode), the mobile shape
 * of desktop components/Feeds/EntryCard.tsx: unread dot, feed·time meta,
 * title (read → muted), 2-line summary, thumbnail, play chip for episodes,
 * bookmark action. React.memo: FlashList rows re-render on store updates.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { tapHaptic } from "@/components/ui";
import type { RssEntryRow } from "@/hooks/useDB.types";
import { formatDuration, relativeTime } from "./format";

export interface EntryCardProps {
  entry: RssEntryRow;
  feedTitle: string;
  bookmarked: boolean;
  bookmarkPending: boolean;
  /** This entry's audio is loaded in the player (playing or paused). */
  isActiveTrack: boolean;
  isPlaying: boolean;
  onOpen: (entry: RssEntryRow) => void;
  onPlay: (entry: RssEntryRow) => void;
  onToggleBookmark: (entry: RssEntryRow) => void;
}

export const EntryCard = React.memo(function EntryCard({
  entry,
  feedTitle,
  bookmarked,
  bookmarkPending,
  isActiveTrack,
  isPlaying,
  onOpen,
  onPlay,
  onToggleBookmark,
}: EntryCardProps) {
  const t = useT();
  const p = usePalette();
  const hasAudio = Boolean(entry.audio_url);
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onOpen(entry);
      }}
      className="px-4 py-3"
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      <View className="flex-row gap-3">
        <View className="flex-1">
          {/* meta: unread dot + feed · time */}
          <View className="mb-1 flex-row items-center gap-1.5">
            {!entry.is_read ? <View className="h-2 w-2 rounded-full bg-primary" /> : null}
            <Text className="flex-1 text-[12px] text-muted-foreground" numberOfLines={1}>
              {feedTitle}
              {entry.published ? ` · ${relativeTime(entry.published, t)}` : ""}
            </Text>
          </View>
          <Text
            numberOfLines={2}
            className={`text-[15px] font-semibold leading-5 ${entry.is_read ? "text-muted-foreground" : "text-foreground"}`}
          >
            {entry.title}
          </Text>
          {entry.summary ? (
            <Text numberOfLines={2} className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              {entry.summary}
            </Text>
          ) : null}
        </View>
        {entry.image_url ? (
          <Image
            source={{ uri: entry.image_url }}
            style={{ width: 72, height: 72, borderRadius: 10 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={100}
          />
        ) : null}
      </View>
      {hasAudio ? (
        <View className="mt-2 flex-row items-center justify-between">
          <Pressable
            onPress={() => {
              tapHaptic();
              onPlay(entry);
            }}
            hitSlop={6}
            className="min-h-[32px] flex-row items-center gap-1.5 rounded-full bg-accent px-3 py-1"
            style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
          >
            <Ionicons
              name={isActiveTrack && isPlaying ? "pause" : "play"}
              size={13}
              color={p["accent-foreground"]}
            />
            <Text className="text-[12px] font-semibold text-accent-foreground">
              {isActiveTrack && isPlaying
                ? t("podcast.pause")
                : entry.audio_duration
                  ? formatDuration(entry.audio_duration)
                  : t("podcast.play")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onToggleBookmark(entry)}
            hitSlop={10}
            disabled={bookmarkPending}
            className="min-h-[32px] min-w-[32px] items-center justify-center"
          >
            <Ionicons
              name={bookmarked ? "bookmark" : "bookmark-outline"}
              size={17}
              color={bookmarked ? p.primary : p["muted-foreground"]}
            />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
});
