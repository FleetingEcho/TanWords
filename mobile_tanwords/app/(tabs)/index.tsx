/**
 * Dashboard (首页) — port of desktop components/Dashboard, re-shaped for mobile:
 * greeting → review CTA (FSRS due count) → stat tiles → recent words →
 * recently read → recent docs. This screen is the UX exemplar for the app:
 * skeleton loading, pull-to-refresh, empty states, haptics, deep links.
 */
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Badge, Card, Divider, EmptyState, SectionHeader, Skeleton, StatTile, tapHaptic } from "@/components/ui";
import { db_dashboard_stats } from "@/db/dashboard";
import { db_get_review_count } from "@/db/srs";
import { db_list_reading_articles, type ReadingArticleItem } from "@/db/reading";
import type { DashboardStats } from "@/hooks/useDB.types";

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return "dash.greeting.morning";
  if (h < 18) return "dash.greeting.afternoon";
  return "dash.greeting.evening";
}

function shortDate(isZh: boolean): string {
  const d = new Date();
  if (!isZh) {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;
}

export default function DashboardScreen() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const isZh = true; // dictionaries are Chinese-first; translations fall back to en via useT

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [recentlyRead, setRecentlyRead] = useState<ReadingArticleItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [statsR, dueR, readR] = await Promise.allSettled([
      db_dashboard_stats(),
      db_get_review_count(),
      db_list_reading_articles({ sort: "recent", limit: 5 }),
    ]);
    if (statsR.status === "fulfilled") setStats(statsR.value);
    if (dueR.status === "fulfilled") setDueCount(dueR.value);
    if (readR.status === "fulfilled") setRecentlyRead(readR.value.items);
    setLoaded(true);
  }, []);

  // Refresh on every focus — cheap queries, keeps due badge + recents honest.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.primary} />
        }
      >
        {/* Greeting */}
        <View className="pb-1 pt-3">
          <Text className="text-[28px] font-bold text-foreground">{t(greetingKey())}</Text>
          <Text className="mt-0.5 text-[13px] text-muted-foreground">{shortDate(isZh)}</Text>
        </View>

        {/* Review CTA — the daily habit; always visible, primary when due. */}
        <Card
          className={`mt-4 flex-row items-center gap-3 ${dueCount > 0 ? "bg-accent border-transparent" : ""}`}
          onPress={() => router.push("/review")}
        >
          <View className="rounded-xl bg-primary p-2.5">
            <Ionicons name="albums-outline" size={22} color={p["primary-foreground"]} />
          </View>
          <View className="flex-1">
            <Text className="text-[15px] font-semibold text-foreground">{t("dash.review.title")}</Text>
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              {dueCount > 0 ? t("dash.review.dueCount", { n: dueCount }) : t("dash.review.allDone")}
            </Text>
          </View>
          {dueCount > 0 ? (
            <Badge count={dueCount} tone="destructive" />
          ) : (
            <Ionicons name="checkmark-circle" size={22} color={p.primary} />
          )}
        </Card>

        {/* Stat tiles */}
        <View className="mt-3 flex-row gap-3">
          {loaded && stats ? (
            <>
              <StatTile
                icon="text-outline"
                label={t("dash.stat.words")}
                value={stats.word_count}
                onPress={() => router.navigate("/learn")}
              />
              <StatTile
                icon="git-network-outline"
                label={t("dash.stat.sentences")}
                value={stats.pattern_count}
                onPress={() => router.navigate("/learn")}
              />
              <StatTile
                icon="document-text-outline"
                label={t("dash.stat.docs")}
                value={stats.doc_count}
                onPress={() => router.navigate("/docs")}
              />
            </>
          ) : (
            <>
              <Skeleton className="h-[92px] flex-1" />
              <Skeleton className="h-[92px] flex-1" />
              <Skeleton className="h-[92px] flex-1" />
            </>
          )}
        </View>

        {/* Recent words */}
        <SectionHeader
          title={t("dash.recentWords")}
          actionLabel={t("dash.viewAll")}
          onAction={() => router.navigate("/learn")}
        />
        {loaded ? (
          stats && stats.recent_words.length > 0 ? (
            <Card className="p-0">
              {stats.recent_words.map((w, i) => (
                <View key={w.id}>
                  {i > 0 ? <Divider className="mx-4" /> : null}
                  <WordsRow word={w.word} zh={w.zh} level={w.level} onPress={() => {
                    tapHaptic();
                    router.push(`/word/${encodeURIComponent(w.word)}`);
                  }} />
                </View>
              ))}
            </Card>
          ) : (
            <Card className="items-center py-6">
              <Text className="text-[13px] text-muted-foreground">{t("dash.empty.words")}</Text>
            </Card>
          )
        ) : (
          <Skeleton className="h-[180px]" />
        )}

        {/* Recently read */}
        <SectionHeader
          title={t("dash.recentlyRead.title")}
          actionLabel={t("dash.viewAll")}
          onAction={() => router.navigate("/reading")}
        />
        {loaded ? (
          recentlyRead.length > 0 ? (
            <Card className="p-0">
              {recentlyRead.map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <Divider className="mx-4" /> : null}
                  <ReadRow title={a.title} source={a.source} onPress={() => {
                    tapHaptic();
                    router.push(`/reading/${a.id}`);
                  }} />
                </View>
              ))}
            </Card>
          ) : (
            <Card className="items-center py-6">
              <Text className="px-4 text-center text-[13px] text-muted-foreground">
                {t("dash.empty.recentlyRead")}
              </Text>
            </Card>
          )
        ) : (
          <Skeleton className="h-[140px]" />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function WordsRow({ word, zh, level, onPress }: { word: string; zh: string; level: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable className="min-h-[48px] flex-row items-center gap-3 px-4 py-2.5" onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}>
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-foreground">{word}</Text>
        {zh ? (
          <Text className="mt-0.5 text-[13px] text-muted-foreground" numberOfLines={1}>
            {zh}
          </Text>
        ) : null}
      </View>
      {level ? (
        <View className="rounded-md bg-muted px-1.5 py-0.5">
          <Text className="text-[10px] font-semibold text-muted-foreground">{level}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={p["muted-foreground"]} />
    </Pressable>
  );
}

function ReadRow({ title, source, onPress }: { title: string; source: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable className="min-h-[48px] flex-row items-center gap-3 px-4 py-2.5" onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}>
      <Ionicons name="book-outline" size={16} color={p["muted-foreground"]} />
      <View className="flex-1">
        <Text className="text-[14px] font-medium text-foreground" numberOfLines={1}>
          {title}
        </Text>
        {source ? (
          <Text className="mt-0.5 text-[12px] text-muted-foreground" numberOfLines={1}>
            {source}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={p["muted-foreground"]} />
    </Pressable>
  );
}
