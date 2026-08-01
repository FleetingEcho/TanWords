/**
 * /feed/hackernews — HN story detail + threaded comments.
 * Story metadata arrives as route params from the list (services/hn has no
 * single-item fetch exported); comments always fetch by id.
 */
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { Screen, tapHaptic } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { HnCommentList } from "@/components/feeds/HnComments";
import { domainOf, relativeTime } from "@/components/feeds/format";
import { useFeedBookmarksStore } from "@/store/feedBookmarksStore";

export default function HnStoryScreen() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    url?: string;
    by?: string;
    score?: string;
    time?: string;
    descendants?: string;
  }>();

  const storyId = Number(params.id ?? "0");
  const title = params.title ?? "";
  const url = params.url ?? `https://news.ycombinator.com/item?id=${storyId}`;
  const score = Number(params.score ?? "0");
  const by = params.by ?? "";
  const timeSec = Number(params.time ?? "0");
  const descendants = Number(params.descendants ?? "0");
  const discussionUrl = `https://news.ycombinator.com/item?id=${storyId}`;
  const isSelfPost = useMemo(() => /news\.ycombinator\.com\/item\?id=/.test(url), [url]);

  const bookmarked = useFeedBookmarksStore((s) => s.urls.has(url));
  const bookmarks = useFeedBookmarksStore();

  const toggleBookmark = () => {
    void bookmarks.toggle({
      url,
      title,
      feedTitle: "Hacker News",
      domain: domainOf(url),
      summary: "",
      imageUrl: null,
      audioUrl: null,
      audioDuration: null,
      hnItemId: storyId || null,
      published: timeSec ? new Date(timeSec * 1000).toISOString() : "",
    });
  };

  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <View className="flex-row items-center border-b border-border px-2 py-1">
          <IconBtn name="chevron-back" onPress={() => router.back()} a11y={t("hn.reader.back")} />
          <Text className="flex-1 text-center text-[13px] text-muted-foreground" numberOfLines={1}>
            Hacker News
          </Text>
          <IconBtn
            name={bookmarked ? "bookmark" : "bookmark-outline"}
            onPress={toggleBookmark}
            a11y={bookmarked ? t("feeds.unbookmark") : t("feeds.bookmark")}
          />
          <IconBtn
            name="open-outline"
            onPress={() => void WebBrowser.openBrowserAsync(url).catch(() => {})}
            a11y={t("hn.reader.external")}
          />
        </View>
      }
    >
      <View className="flex-1">
        {/* story card */}
        <View className="border-b border-border px-4 pb-3 pt-2">
          <Text selectable className="text-[17px] font-semibold leading-6 text-foreground">
            {title}
          </Text>
          <Text className="mt-1.5 text-[12px] text-muted-foreground" numberOfLines={1}>
            {isSelfPost ? domainOf(discussionUrl) : domainOf(url)}
            {by ? ` · ${by}` : ""}
            {timeSec ? ` · ${relativeTime(timeSec * 1000, t)}` : ""}
          </Text>
          <View className="mt-2 flex-row items-center gap-4">
            <View className="flex-row items-center gap-1">
              <Ionicons name="triangle" size={13} color={p.primary} />
              <Text className="text-[12px] font-semibold text-foreground">{score}</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Ionicons name="chatbubble-outline" size={13} color={p["muted-foreground"]} />
              <Text className="text-[12px] text-muted-foreground">
                {t("hn.comments.title")} · {descendants}
              </Text>
            </View>
            <View className="flex-1" />
            {!isSelfPost ? (
              <TextAction
                label={t("hn.reader.external")}
                onPress={() => void WebBrowser.openBrowserAsync(url).catch(() => {})}
              />
            ) : null}
            <TextAction
              label={t("hn.reader.openDiscussion")}
              onPress={() => void WebBrowser.openBrowserAsync(discussionUrl).catch(() => {})}
            />
          </View>
        </View>
        {/* comments */}
        {storyId > 0 ? (
          <HnCommentList storyId={storyId} />
        ) : (
          <View className="flex-1" />
        )}
      </View>
    </Screen>
  );
}

function IconBtn({ name, onPress, a11y }: { name: keyof typeof Ionicons.glyphMap; onPress: () => void; a11y?: string }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      hitSlop={8}
      className="min-h-[40px] min-w-[40px] items-center justify-center"
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
    >
      <Ionicons name={name} size={20} color={p.foreground} />
    </Pressable>
  );
}

function TextAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      hitSlop={6}
      className="min-h-[32px] justify-center"
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      <Text className="text-[12px] font-medium text-primary">{label}</Text>
    </Pressable>
  );
}
