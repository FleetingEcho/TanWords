/**
 * Documents list (文档) — port of the desktop Documents sidebar list
 * (app/src/components/Documents), re-shaped mobile: search bar with FTS,
 * pinned-first FlashList, long-press row actions (pin/delete), new-doc in
 * the header right.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Card, Divider, EmptyState, Screen, ScreenHeader, SearchBar, Skeleton, tapHaptic } from "@/components/ui";
import {
  db_create_document,
  db_delete_document,
  db_get_documents,
  db_set_document_pinned,
  type DocumentListItem,
} from "@/db/documents";
import { formatUpdatedAt, snippetOf } from "@/components/docs/format";

function DocRow({
  item,
  isZh,
  untitledLabel,
  onPress,
  onLongPress,
}: {
  item: DocumentListItem;
  isZh: boolean;
  untitledLabel: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const p = usePalette();
  const preview =
    item.snippet.length > 0 ? item.snippet.replace(/[«»]/g, "") : snippetOf(item.content_text);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onLongPress();
      }}
      delayLongPress={350}
      style={({ pressed }) => [
        { minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, justifyContent: "center" },
        pressed ? { backgroundColor: p.muted } : null,
      ]}
    >
      <View className="flex-row items-center gap-1.5">
        {item.pinned ? (
          <Ionicons name="pin" size={12} color={p.primary} style={{ transform: [{ rotate: "45deg" }] }} />
        ) : null}
        <Text className="flex-1 text-[15px] font-semibold text-foreground" numberOfLines={1}>
          {item.title === "Untitled" ? untitledLabel : item.title}
        </Text>
        {item.protected ? <Ionicons name="lock-closed" size={13} color={p["muted-foreground"]} /> : null}
      </View>
      {preview ? (
        <Text className="mt-0.5 text-[13px] text-muted-foreground" numberOfLines={2}>
          {preview}
        </Text>
      ) : null}
      <Text className="mt-1 text-[12px] text-muted-foreground">
        {formatUpdatedAt(item.updated_at, isZh)}
      </Text>
    </Pressable>
  );
}

export default function DocsScreen() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const isZh = true; // dictionaries are Chinese-first; en fallback handled by useT

  const [items, setItems] = useState<DocumentListItem[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 300ms debounce so FTS MATCH doesn't run per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (q: string) => {
    try {
      const r = await db_get_documents({ search: q || null });
      setItems(r.items);
    } catch (e) {
      console.warn("docs list failed", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(debounced);
    }, [load, debounced])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(debounced);
    } finally {
      setRefreshing(false);
    }
  }, [load, debounced]);

  const createDoc = useCallback(async () => {
    try {
      const id = await db_create_document();
      router.push(`/doc/${id}`);
    } catch (e) {
      console.warn("create doc failed", e);
    }
  }, [router]);

  const rowActions = useCallback(
    (item: DocumentListItem) => {
      Alert.alert(item.title, undefined, [
        {
          text: item.pinned ? t("doc.unpin") : t("doc.pin"),
          onPress: () => {
            void db_set_document_pinned({ id: item.id, pinned: !item.pinned })
              .then(() => load(debounced))
              .catch(() => {});
          },
        },
        {
          text: t("doc.delete"),
          style: "destructive",
          onPress: () => {
            Alert.alert(t("doc.deleteDocTitle"), t("doc.deleteConfirm"), [
              { text: t("doc.cancel"), style: "cancel" },
              {
                text: t("doc.delete"),
                style: "destructive",
                onPress: () => {
                  void db_delete_document({ id: item.id })
                    .then(() => load(debounced))
                    .catch(() => {});
                },
              },
            ]);
          },
        },
        { text: t("doc.cancel"), style: "cancel" },
      ]);
    },
    [t, load, debounced]
  );

  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <ScreenHeader
          title={t("nav.documents")}
          right={
            <Pressable
              onPress={() => {
                tapHaptic();
                void createDoc();
              }}
              hitSlop={10}
              className="rounded-full bg-primary p-2"
            >
              <Ionicons name="create-outline" size={20} color={p["primary-foreground"]} />
            </Pressable>
          }
        />
      }
    >
      <View className="px-4 pb-2 pt-2">
        <SearchBar value={query} onChangeText={setQuery} placeholder={t("doc.search")} />
      </View>

      {!loaded ? (
        <View className="px-4">
          <Skeleton className="mb-2 h-[64px]" />
          <Skeleton className="mb-2 h-[64px]" />
          <Skeleton className="mb-2 h-[64px]" />
          <Skeleton className="mb-2 h-[64px]" />
          <Skeleton className="mb-2 h-[64px]" />
        </View>
      ) : items.length === 0 ? (
        <Card className="mx-4 mt-2">
          <EmptyState
            icon="document-text-outline"
            title={debounced ? t("doc.noSearchResults") : t("doc.emptyState")}
            hint={debounced ? undefined : t("doc.emptyStateHint")}
            actionTitle={debounced ? undefined : t("doc.newDoc")}
            onAction={debounced ? undefined : () => void createDoc()}
          />
        </Card>
      ) : (
        <Card className="mx-4 flex-1 overflow-hidden p-0">
          <FlashList
            data={items}
            keyExtractor={(d) => String(d.id)}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.primary} />
            }
            ItemSeparatorComponent={() => <Divider className="mx-4" />}
            renderItem={({ item }) => (
              <DocRow
                item={item}
                isZh={isZh}
                untitledLabel={t("doc.untitled")}
                onPress={() => {
                  tapHaptic();
                  router.push(`/doc/${item.id}`);
                }}
                onLongPress={() => rowActions(item)}
              />
            )}
          />
        </Card>
      )}
    </Screen>
  );
}
