/**
 * Reading (精读) tab — paste/import an article → AI extraction → accept flow
 * → persist; plus the saved-article library below.
 *
 * Two states on one screen (per task):
 *  (a) home = paste/URL input card + recent saved articles (FlashList)
 *  (b) streaming = live status card while extraction runs (abortable)
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import {
  Button,
  Card,
  EmptyState,
  Screen,
  ScreenHeader,
  Skeleton,
  tapHaptic,
} from "@/components/ui";
import {
  db_list_reading_articles,
  db_save_reading_article,
  type ReadingArticleItem,
} from "@/db/reading";
import { useAnalyzeArticle, type AnalyzeOutcome } from "@/hooks/useAnalyzeArticle";
import { isAbortError } from "@/ai/analyze";
import { AcceptSheet, type AcceptResult } from "@/components/reading/AcceptSheet";

const URL_RE = /^https?:\/\/\S+$/i;

/** Desktop ScratchPasteScreen.suggestTitle: first line if headline-like,
 *  else the opening words. Applied when the extractor returned no title
 *  (paste flow has no title input on mobile). */
function suggestTitle(text: string): string {
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return "";
  if (first.length <= 120) return first;
  return first.slice(0, 60).replace(/\s+\S*$/, "") + "…";
}

function looksLikeParagraphs(s: string) {
  return s.trim().split(/\s+/).length >= 40;
}

export default function ReadingTab() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const [items, setItems] = useState<ReadingArticleItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [draftFromUrl, setDraftFromUrl] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const { analyze, analyzeUrl, abort, running, progress } = useAnalyzeArticle();
  const [outcome, setOutcome] = useState<AnalyzeOutcome | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [fetchingUrl, setFetchingUrl] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await db_list_reading_articles({ sort: "recent", limit: 100 });
      setItems(page.items);
      setTotal(page.total);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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

  const pasteFromClipboard = useCallback(async () => {
    tapHaptic();
    try {
      const text = await Clipboard.getStringAsync();
      if (!text.trim()) {
        setAnalyzeError(t("readPage.clipboardEmpty"));
        return;
      }
      setAnalyzeError(null);
      setDraftFromUrl(null);
      setDraft(text);
      Keyboard.dismiss();
    } catch {
      setAnalyzeError(t("readPage.clipboardFailed"));
    }
  }, [t]);

  const runAnalyze = useCallback(
    async (text: string, sourceUrl?: string | null) => {
      setAnalyzeError(null);
      try {
        const res = await analyze({ text, sourceUrl: sourceUrl ?? null });
        setOutcome(res);
        setSheetVisible(true);
      } catch (e) {
        if (isAbortError(e)) return; // aborted — simply back to the input
        setAnalyzeError(e instanceof Error ? e.message : String(e));
      }
    },
    [analyze]
  );

  const onAnalyzePress = useCallback(async () => {
    tapHaptic();
    const raw = draft.trim();
    if (!raw) return;
    // A lone URL in the box means "import that page" (desktop has a separate
    // URL bar — mobile keeps one box). Strictly a URL: nothing else in the text.
    if (URL_RE.test(raw) && !running) {
      setFetchingUrl(true);
      setAnalyzeError(null);
      try {
        const res = await analyzeUrl(raw);
        setOutcome(res);
        setSheetVisible(true);
        setDraft("");
        setDraftFromUrl(raw);
      } catch (e) {
        if (!isAbortError(e)) setAnalyzeError(e instanceof Error ? e.message : String(e));
      } finally {
        setFetchingUrl(false);
      }
      return;
    }
    if (!looksLikeParagraphs(raw)) {
      setAnalyzeError(t("readPage.tooShort"));
      return;
    }
    await runAnalyze(raw, draftFromUrl);
  }, [draft, draftFromUrl, running, analyzeUrl, runAnalyze, t]);

  const onSaved = useCallback(
    async (r: AcceptResult) => {
      setSheetVisible(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (!outcome) return;
      try {
        const id = await db_save_reading_article({
          title: outcome.title || suggestTitle(outcome.text) || t("readPage.untitled"),
          content: outcome.text,
          source: outcome.source,
          sourceUrl: outcome.sourceUrl,
        });
        setDraft("");
        setDraftFromUrl(null);
        setOutcome(null);
        void load();
        router.push(`/reading/${id}`);
      } catch (e) {
        setAnalyzeError(e instanceof Error ? e.message : String(e));
      }
    },
    [outcome, load, router, t]
  );

  const wordCount = useMemo(
    () => (draft.trim() ? draft.trim().split(/\s+/).length : 0),
    [draft]
  );
  const canAnalyze = wordCount > 0 && !running && !fetchingUrl;
  const boxIsUrl = URL_RE.test(draft.trim());

  const statusLine = running
    ? progress.phase === "fetching_url"
      ? t("readPage.status.fetching")
      : t("readPage.status.extracting", { words: progress.words, patterns: progress.patterns })
    : null;

  return (
    <Screen padded={false} scroll={false}>
      <ScreenHeader title={t("readPage.title")} />

      {/* Input card — hidden while the accept sheet owns the outcome. */}
      <View className="px-4">
        <Card className="gap-2.5">
          <View className="flex-row items-center gap-2">
            <Ionicons name="create-outline" size={16} color={p.primary} />
            <Text className="flex-1 text-[15px] font-semibold text-foreground">
              {t("readPage.inputTitle")}
            </Text>
            {draft.length > 0 && !running ? (
              <Pressable
                onPress={() => {
                  tapHaptic();
                  setDraft("");
                  setDraftFromUrl(null);
                  setAnalyzeError(null);
                }}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={18} color={p["muted-foreground"]} />
              </Pressable>
            ) : null}
          </View>

          <TextInput
            ref={inputRef}
            multiline
            numberOfLines={5}
            value={draft}
            onChangeText={(v) => {
              setDraft(v);
              if (!URL_RE.test(v.trim())) setDraftFromUrl(null);
              if (analyzeError) setAnalyzeError(null);
            }}
            placeholder={t("readPage.placeholder")}
            placeholderTextColor={p["muted-foreground"]}
            className="min-h-[110px] rounded-xl bg-muted p-3 text-[14px] leading-5 text-foreground"
            textAlignVertical="top"
            editable={!running}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Live status while streaming (state b). */}
          {running && statusLine ? (
            <View className="flex-row items-center gap-2 rounded-lg bg-accent px-3 py-2">
              <ActivityIndicator size="small" color={p["accent-foreground"]} />
              <Text className="flex-1 text-[13px] text-accent-foreground" numberOfLines={1}>
                {statusLine}
              </Text>
              <Pressable
                onPress={() => {
                  tapHaptic();
                  abort();
                }}
                hitSlop={8}
                className="rounded-md px-2 py-1"
              >
                <Text className="text-[13px] font-semibold text-accent-foreground">
                  {t("readPage.cancel")}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {analyzeError && !running ? (
            <View className="flex-row items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <Ionicons name="alert-circle-outline" size={16} color={p.destructive} />
              <Text className="flex-1 text-[13px] text-destructive">{analyzeError}</Text>
              {draft.trim().length > 0 ? (
                <Pressable
                  onPress={() => void onAnalyzePress()}
                  hitSlop={8}
                  className="rounded-md px-1 py-0.5"
                >
                  <Text className="text-[13px] font-semibold text-primary">{t("readPage.retry")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-[12px] text-muted-foreground">
              {wordCount > 0 && !boxIsUrl
                ? t("readPage.wordCount", { n: wordCount })
                : boxIsUrl
                  ? t("readPage.urlDetected")
                  : t("readPage.hint")}
            </Text>
            <Button
              title={t("readPage.paste")}
              variant="secondary"
              size="sm"
              onPress={() => void pasteFromClipboard()}
              icon={<Ionicons name="clipboard-outline" size={15} color={p["secondary-foreground"]} />}
            />
            <Button
              title={
                fetchingUrl
                  ? t("readPage.fetching")
                  : boxIsUrl
                    ? t("readPage.import")
                    : t("readPage.analyze")
              }
              size="sm"
              loading={running || fetchingUrl}
              disabled={!canAnalyze}
              onPress={() => void onAnalyzePress()}
              icon={
                boxIsUrl ? (
                  <Ionicons name="link-outline" size={15} color={p["primary-foreground"]} />
                ) : (
                  <Ionicons name="sparkles-outline" size={15} color={p["primary-foreground"]} />
                )
              }
            />
          </View>
        </Card>
      </View>

      {/* Library */}
      <View className="mt-4 flex-1">
        <View className="flex-row items-baseline justify-between px-4 pb-2">
          <Text className="text-[17px] font-semibold text-foreground">{t("readPage.library")}</Text>
          {total > 0 ? (
            <Text className="text-[12px] text-muted-foreground">
              {t("readPage.libraryCount", { n: total })}
            </Text>
          ) : null}
        </View>

        {listError ? (
          <View className="px-4">
            <Card>
              <Text className="text-[13px] text-destructive">{listError}</Text>
            </Card>
          </View>
        ) : items === null ? (
          <View className="gap-2 px-4">
            <Skeleton className="h-[64px]" />
            <Skeleton className="h-[64px]" />
            <Skeleton className="h-[64px]" />
          </View>
        ) : items.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title={t("readPage.emptyTitle")}
            hint={t("readPage.emptyHint")}
            actionTitle={t("readPage.emptyAction")}
            onAction={() => inputRef.current?.focus()}
          />
        ) : (
          <FlashList
            data={items}
            keyExtractor={(a) => String(a.id)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 16 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.primary} />
            }
            renderItem={({ item }) => (
              <ArticleRow
                item={item}
                onPress={() => router.push(`/reading/${item.id}`)}
              />
            )}
          />
        )}
      </View>

      <AcceptSheet
        visible={sheetVisible && outcome !== null}
        words={outcome?.words ?? []}
        patterns={outcome?.patterns ?? []}
        onSaved={(r) => void onSaved(r)}
        onCancel={() => setSheetVisible(false)}
      />
    </Screen>
  );
}

function formatWhen(lastReadAt: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  // SQLite datetime is UTC — slice to what matches a user's glance.
  const d = new Date(lastReadAt.includes("T") ? lastReadAt : lastReadAt.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return lastReadAt;
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return t("readPage.time.today");
  if (days === 1) return t("readPage.time.yesterday");
  if (days < 30) return t("readPage.time.daysAgo", { n: days });
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ArticleRow({ item, onPress }: { item: ReadingArticleItem; onPress: () => void }) {
  const t = useT();
  const p = usePalette();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      className="min-h-[64px] flex-row items-center gap-3 border-b border-border px-4 py-3"
      style={({ pressed }) => (pressed ? { backgroundColor: p.muted } : undefined)}
    >
      <View className="flex-1">
        <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>
          {item.title || t("readPage.untitled")}
        </Text>
        <View className="mt-1 flex-row items-center gap-2">
          <Text className="text-[12px] text-muted-foreground" numberOfLines={1}>
            {item.word_count > 0 ? t("readPage.metaWords", { n: item.word_count }) : ""}
            {item.source ? ` · ${item.source}` : ""}
            {` · ${formatWhen(item.last_read_at, t)}`}
          </Text>
        </View>
      </View>
      {item.comment_count > 0 ? (
        <View className="flex-row items-center gap-1 rounded-full bg-muted px-2 py-0.5">
          <Ionicons name="chatbubble-outline" size={11} color={p["muted-foreground"]} />
          <Text className="text-[11px] text-muted-foreground">{item.comment_count}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={p["muted-foreground"]} />
    </Pressable>
  );
}
