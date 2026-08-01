/**
 * /reader/[url] — full-screen in-app article reader, the mobile shape of
 * desktop Reader/ReaderView + ReaderToolbar: close (left), open-in-browser +
 * bookmark (right), readability-extracted body (no WebView) via
 * services/readability.ts. Podcast episodes get a play chip that drives the
 * app-wide player; hnrss/saved entries can show HN comments inline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { Image } from "expo-image";
import { Button, Divider, Skeleton, tapHaptic } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { fetchArticle, type ExtractedArticle } from "@/services/readability";
import { usePlayerStore } from "@/services/player";
import { db_get_rss_entries, db_get_rss_feeds } from "@/db/feeds";
import { useFeedBookmarksStore } from "@/store/feedBookmarksStore";
import { ReaderBlocks, htmlToBlocks, textToBlocks } from "@/components/feeds/ReaderBlocks";
import { HnCommentList } from "@/components/feeds/HnComments";
import { domainOf } from "@/components/feeds/format";

type LoadState =
  | { phase: "loading" }
  | { phase: "ok"; article: ExtractedArticle }
  | { phase: "error"; message: string };

export default function ReaderScreen() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    url?: string;
    entryId?: string;
    feedTitle?: string;
    hnItemId?: string;
  }>();

  const url = params.url ?? "";
  const entryId = params.entryId ? Number(params.entryId) : null;
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [resolved, setResolved] = useState<{ audioUrl: string | null; duration: number | null; hnItemId: number | null; feedTitle: string; entryImage: string | null }>({
    audioUrl: null,
    duration: null,
    hnItemId: params.hnItemId ? Number(params.hnItemId) : null,
    feedTitle: params.feedTitle ?? "",
    entryImage: null,
  });

  const bookmarks = useFeedBookmarksStore();
  const bookmarked = useFeedBookmarksStore((s) => s.urls.has(url));
  const player = usePlayerStore();

  /* ---------- data ---------- */
  const loadArticle = useCallback(async () => {
    if (!url) return;
    try {
      const article = await fetchArticle(url);
      setState({ phase: "ok", article });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ phase: "error", message });
    }
  }, [url]);

  useEffect(() => {
    void loadArticle();
    void bookmarks.refresh();
  }, [loadArticle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve entry metadata (audio/hn/image/feed title) from caches.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [entries, feeds] = await Promise.all([db_get_rss_entries({ limit: 500 }), db_get_rss_feeds()]);
        if (cancelled) return;
        const byId = entryId !== null ? entries.find((e) => e.id === entryId) : undefined;
        const byUrl = entries.find((e) => e.url === url);
        const entry = byId ?? byUrl;
        setResolved((cur) => ({
          audioUrl: entry?.audio_url ?? null,
          duration: entry?.audio_duration ?? null,
          hnItemId: cur.hnItemId ?? entry?.hn_item_id ?? null,
          feedTitle: cur.feedTitle || (entry ? feeds.find((f) => f.id === entry.feed_id)?.title ?? "" : ""),
          entryImage: entry?.image_url ?? null,
        }));
      } catch {
        /* metadata resolution is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, entryId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadArticle();
    setRefreshing(false);
  }, [loadArticle]);

  /* ---------- derived ---------- */
  const article = state.phase === "ok" ? state.article : null;
  const title = article?.title ?? "";
  const blocks = useMemo(() => {
    if (!article) return [];
    if (article.html) return htmlToBlocks(article.html);
    return textToBlocks(article.textContent);
  }, [article]);
  const byline = article?.byline ?? "";
  const site = article?.siteName ?? domainOf(url);

  const hasFeaturedImage = useMemo(() => blocks.some((b) => b.kind === "image"), [blocks]);
  const isActiveTrack = resolved.audioUrl !== null && player.track?.url === resolved.audioUrl;
  const isPlayingEpisode = isActiveTrack && player.status === "playing";

  const playEpisode = useCallback(() => {
    if (!resolved.audioUrl) return;
    if (isActiveTrack && (player.status === "playing" || player.status === "paused")) {
      player.toggle();
      return;
    }
    void player.play({ url: resolved.audioUrl, title, feedTitle: resolved.feedTitle });
  }, [resolved.audioUrl, resolved.feedTitle, isActiveTrack, player, title]);

  const toggleBookmark = useCallback(() => {
    void bookmarks.toggle({
      url: article?.url ?? url,
      title: title || url,
      feedTitle: resolved.feedTitle || "Hacker News",
      domain: domainOf(article?.url ?? url),
      summary: article?.excerpt ?? "",
      imageUrl: resolved.entryImage,
      audioUrl: resolved.audioUrl,
      audioDuration: resolved.duration,
      hnItemId: resolved.hnItemId,
      published: "",
    });
  }, [article, bookmarks, resolved, title, url]);

  /* ---------- chrome ---------- */
  const header = (
    <View className="flex-row items-center px-2 py-1">
      <IconBtn name="chevron-back" onPress={() => router.back()} a11y={t("hn.reader.back")} />
      <Text className="flex-1 text-center text-[13px] text-muted-foreground" numberOfLines={1}>
        {resolved.feedTitle || site}
      </Text>
      <IconBtn
        name={bookmarked ? "bookmark" : "bookmark-outline"}
        onPress={toggleBookmark}
        a11y={bookmarked ? t("feeds.unbookmark") : t("feeds.bookmark")}
      />
      <IconBtn
        name="open-outline"
        onPress={() => void WebBrowser.openBrowserAsync(article?.url ?? url).catch(() => {})}
        a11y={t("hn.reader.external")}
      />
    </View>
  );

  /* ---------- body ---------- */
  let body: React.ReactNode;
  if (state.phase === "loading") {
    body = (
      <View className="px-4 pt-3">
        <Skeleton className="mb-2 h-[26px] w-4/5" />
        <Skeleton className="mb-5 h-[14px] w-2/5" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="mb-3 h-[16px] w-full" />
        ))}
      </View>
    );
  } else if (state.phase === "error") {
    body = (
      <View className="items-center px-6 pt-16">
        <Ionicons name="cloud-offline-outline" size={32} color={p["muted-foreground"]} />
        <Text className="mt-3 text-center text-[14px] font-medium text-foreground">{t("hn.section.error")}</Text>
        <Text className="mt-1.5 px-2 text-center text-[12px] leading-5 text-muted-foreground" numberOfLines={3}>
          {state.message}
        </Text>
        <View className="mt-4 flex-row gap-3">
          <Button title={t("podcast.retry")} variant="secondary" size="sm" onPress={() => {
            setState({ phase: "loading" });
            void loadArticle();
          }} />
          <Button
            title={t("hn.reader.external")}
            size="sm"
            onPress={() => void WebBrowser.openBrowserAsync(url).catch(() => {})}
          />
        </View>
      </View>
    );
  } else {
    body = (
      <View className="px-4 pt-2">
        {/* title block */}
        <Text selectable className="text-[22px] font-bold leading-8 text-foreground">
          {title}
        </Text>
        <Text className="mt-1.5 text-[13px] text-muted-foreground" numberOfLines={2}>
          {[site, byline].filter(Boolean).join(" · ")}
        </Text>

        {/* hero image (only when the body itself has no image) */}
        {resolved.entryImage && !hasFeaturedImage ? (
          <Image
            source={{ uri: resolved.entryImage }}
            style={{ width: "100%", height: 200, borderRadius: 12, marginTop: 12 }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : null}

        {/* episode play chip */}
        {resolved.audioUrl ? (
          <Pressable
            onPress={() => {
              tapHaptic();
              playEpisode();
            }}
            className="mt-3 min-h-[40px] flex-row items-center gap-2 self-start rounded-full bg-accent px-4"
            style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
          >
            <Ionicons
              name={isPlayingEpisode ? "pause" : player.status === "loading" && isActiveTrack ? "hourglass" : "play"}
              size={15}
              color={p["accent-foreground"]}
            />
            <Text className="text-[13px] font-semibold text-accent-foreground">
              {isPlayingEpisode ? t("podcast.pause") : t("podcast.listenEpisode")}
            </Text>
          </Pressable>
        ) : null}

        <View className="mt-4">
          <ReaderBlocks blocks={blocks} />
        </View>

        {/* inline HN comments */}
        {resolved.hnItemId ? (
          <View className="mt-4">
            <Pressable
              onPress={() => {
                tapHaptic();
                setShowComments((v) => !v);
              }}
              className="min-h-[44px] flex-row items-center gap-2 rounded-xl bg-muted px-4"
              style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
            >
              <Ionicons name="chatbubbles-outline" size={16} color={p.foreground} />
              <Text className="flex-1 text-[13px] font-semibold text-foreground">{t("hn.comments.title")}</Text>
              <Ionicons name={showComments ? "chevron-up" : "chevron-down"} size={14} color={p["muted-foreground"]} />
            </Pressable>
            {showComments ? (
              <View className="-mx-4" style={{ height: 480 }}>
                <HnCommentList storyId={resolved.hnItemId} />
              </View>
            ) : null}
          </View>
        ) : null}

        <Divider className="my-6" />
        <Pressable
          onPress={() => {
            tapHaptic();
            void WebBrowser.openBrowserAsync(article?.url ?? url).catch(() => {});
          }}
          className="mb-8 min-h-[40px] flex-row items-center justify-center gap-2"
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
        >
          <Ionicons name="open-outline" size={14} color={p.primary} />
          <Text className="text-[13px] font-medium text-primary">{t("hn.reader.external")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {header}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.primary} />
        }
      >
        {body}
      </ScrollView>
    </View>
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
