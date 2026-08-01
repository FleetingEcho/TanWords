/**
 * Threaded HN comments — mobile shape of desktop Reader/HnComments.tsx.
 * The tree comes from services/hn.ts fetchHnComments (already depth-capped and
 * sanitized); here we flatten it into a list of (node, depth) rows honoring a
 * collapse set, and render with left indent guides. Collapse = tap the author
 * row (discoverable via the "n 条回复" chevron).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Divider, EmptyState, Skeleton, tapHaptic } from "@/components/ui";
import { fetchHnComments, type HnComment } from "@/services/hn";
import { CommentBlocks } from "./ReaderBlocks";
import { relativeTime } from "./format";

interface Row {
  node: HnComment;
  depth: number;
  descendantCount: number;
}

function countDescendants(node: HnComment): number {
  let n = 0;
  for (const c of node.children) n += 1 + countDescendants(c);
  return n;
}

function flatten(children: HnComment[], depth: number, collapsed: Set<number>, out: Row[]): void {
  for (const node of children) {
    out.push({ node, depth, descendantCount: countDescendants(node) });
    if (!collapsed.has(node.id) && node.children.length > 0) {
      flatten(node.children, depth + 1, collapsed, out);
    }
  }
}

export function HnCommentList({ storyId }: { storyId: number }) {
  const t = useT();
  const p = usePalette();
  const [roots, setRoots] = useState<HnComment[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const comments = await fetchHnComments(storyId);
      setRoots(comments);
      setError(false);
    } catch (e) {
      console.error("[hn] comments failed:", e);
      setError(true);
    }
  }, [storyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (roots) flatten(roots, 0, collapsed, out);
    return out;
  }, [roots, collapsed]);

  const toggleCollapse = useCallback((id: number) => {
    tapHaptic();
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (roots === null && !error) {
    return (
      <View className="px-4 pt-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="mb-3 h-[72px]" />
        ))}
        <Text className="mt-1 text-center text-[12px] text-muted-foreground">{t("hn.comments.loading")}</Text>
      </View>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title={t("hn.comments.error")}
        actionTitle={t("podcast.retry")}
        onAction={() => void onRefresh()}
      />
    );
  }
  if (rows.length === 0) {
    return <EmptyState icon="chatbubbles-outline" title={t("hn.comments.empty")} />;
  }

  return (
    <FlashList
      data={rows}
      keyExtractor={(r) => `c-${r.node.id}`}
      contentContainerStyle={{ paddingBottom: 40, paddingTop: 4 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.primary} />
      }
      renderItem={({ item }) => {
        const isCollapsed = collapsed.has(item.node.id);
        return (
          <View className="px-4">
            <View style={{ flexDirection: "row" }}>
              {/* indent guides */}
              {Array.from({ length: item.depth }, (_, i) => (
                <View key={i} className="w-[14px] border-l border-border" />
              ))}
              <View className="flex-1 pr-1">
                {/* author row = collapse target */}
                <Pressable
                  onPress={() => item.descendantCount > 0 && toggleCollapse(item.node.id)}
                  className="mt-2 min-h-[28px] flex-row items-center gap-2"
                >
                  <Text className="text-[12px] font-semibold text-primary">
                    {item.node.by ?? t("hn.comments.anonymous")}
                  </Text>
                  {item.node.time ? (
                    <Text className="text-[11px] text-muted-foreground">
                      {relativeTime(item.node.time * 1000, t)}
                    </Text>
                  ) : null}
                  <View className="flex-1" />
                  {item.descendantCount > 0 ? (
                    <View className="flex-row items-center gap-1">
                      {isCollapsed ? (
                        <Text className="text-[11px] font-medium text-accent-foreground">
                          {t("hn.comments.replyCount", { n: item.descendantCount })}
                        </Text>
                      ) : null}
                      <Ionicons
                        name={isCollapsed ? "chevron-down" : "chevron-up"}
                        size={12}
                        color={p["muted-foreground"]}
                      />
                    </View>
                  ) : null}
                </Pressable>
                {!isCollapsed ? <CommentBlocks html={item.node.text} /> : null}
              </View>
            </View>
          </View>
        );
      }}
      ItemSeparatorComponent={() => <View className="h-2" />}
    />
  );
}
