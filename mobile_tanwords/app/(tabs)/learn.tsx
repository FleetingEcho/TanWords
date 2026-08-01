/**
 * Learn (学习) tab — vocabulary words, saved sentence patterns, and the FSRS
 * review entry. Mobile port of desktop components/Vocabulary:
 * WordListPanel/VocabularyPage/PatternLibrary → three segments in one tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, RefreshControl, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Badge,
  EmptyState,
  Screen,
  ScreenHeader,
  SearchBar,
  SegmentedTabs,
  Skeleton,
  tapHaptic,
} from "@/components/ui";
import { PatternCard, ReviewSummaryCard, WordActionsSheet, WordRow } from "@/components/learn";
import { usePalette } from "@/lib/theme";
import { useT } from "@/hooks/useT";
import { db_get_words, db_set_word_starred, db_delete_word } from "@/db/words";
import { db_list_patterns, db_set_pattern_starred, type PatternItem } from "@/db/patterns";
import { db_get_review_count, DEFAULT_NEW_LIMIT } from "@/db/srs";
import type { WordListItem } from "@/hooks/useDB.types";

type Segment = "words" | "patterns" | "review";

export default function LearnScreen() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const [segment, setSegment] = useState<Segment>("words");
  const [dueCount, setDueCount] = useState(0);

  // Words
  const [words, setWords] = useState<WordListItem[]>([]);
  const [wordsLoading, setWordsLoading] = useState(true);
  const [wordsRefreshing, setWordsRefreshing] = useState(false);
  const [wordsError, setWordsError] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Patterns
  const [patterns, setPatterns] = useState<PatternItem[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(true);
  const [patternsRefreshing, setPatternsRefreshing] = useState(false);
  const [patternsLoadedOnce, setPatternsLoadedOnce] = useState(false);
  const [expandedPatternId, setExpandedPatternId] = useState<number | null>(null);

  // Long-press sheet
  const [sheetItem, setSheetItem] = useState<WordListItem | null>(null);

  // Debounce: keystroke-tight but doesn't hit SQLite on every character.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(searchText.trim()), 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchText]);

  const loadWords = useCallback(async (search: string) => {
    try {
      setWordsError(false);
      const rows = await db_get_words({ search: search || null });
      setWords(rows);
    } catch (e) {
      console.warn("[learn] db_get_words failed", e);
      setWordsError(true);
    } finally {
      setWordsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWords(debouncedSearch);
  }, [debouncedSearch, loadWords]);

  const loadPatterns = useCallback(async () => {
    try {
      const rows = await db_list_patterns();
      setPatterns(rows);
    } catch (e) {
      console.warn("[learn] db_list_patterns failed", e);
    } finally {
      setPatternsLoading(false);
      setPatternsLoadedOnce(true);
    }
  }, []);

  const loadDue = useCallback(async () => {
    try {
      setDueCount(await db_get_review_count());
    } catch (e) {
      console.warn("[learn] db_get_review_count failed", e);
    }
  }, []);

  // Refresh the whole tab on focus (reviews done elsewhere change the badge).
  useFocusEffect(
    useCallback(() => {
      void loadDue();
      if (patternsLoadedOnce) void loadPatterns();
    }, [loadDue, loadPatterns, patternsLoadedOnce])
  );

  useEffect(() => {
    if (segment === "patterns" && !patternsLoadedOnce) void loadPatterns();
  }, [segment, patternsLoadedOnce, loadPatterns]);

  // ── Word actions ────────────────────────────────────────────────────────
  const onToggleStar = useCallback(
    (item: WordListItem) => {
      void db_set_word_starred({ wordId: item.id, starred: !item.starred })
        .then(() => loadWords(debouncedSearch))
        .catch((e) => console.warn("[learn] star failed", e));
    },
    [debouncedSearch, loadWords]
  );

  const onDeleteWord = useCallback(
    (item: WordListItem) => {
      Alert.alert(
        t("vocab.deleteConfirmTitle", { word: item.word }),
        t("vocab.deleteConfirmMessage"),
        [
          { text: t("vocab.cancel"), style: "cancel" },
          {
            text: t("vocab.deleteWord"),
            style: "destructive",
            onPress: () => {
              void db_delete_word({ wordId: item.id })
                .then(() => {
                  void loadWords(debouncedSearch);
                  void loadDue();
                })
                .catch((e) => console.warn("[learn] delete failed", e));
            },
          },
        ]
      );
    },
    [t, debouncedSearch, loadWords, loadDue]
  );

  const headerRight = useMemo(
    () =>
      dueCount > 0 ? <Badge count={dueCount} tone="destructive" /> : undefined,
    [dueCount]
  );

  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <>
          <ScreenHeader title={t("vocab.title")} right={headerRight} />
          <View className="px-4 pb-2">
            <SegmentedTabs<Segment>
              value={segment}
              onChange={setSegment}
              options={[
                { key: "words", label: t("vocab.tabWords") },
                { key: "patterns", label: t("vocab.tabPatterns") },
                { key: "review", label: t("vocab.tabReview") },
              ]}
            />
          </View>
        </>
      }
    >
      {segment === "words" ? (
        <View className="flex-1" onTouchStart={() => Keyboard.dismiss()}>
          <SearchBar
            value={searchText}
            onChangeText={setSearchText}
            placeholder={t("vocab.search")}
          />
          <FlashList
            data={words}
            keyExtractor={(w) => String(w.id)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: 24 }}
            refreshControl={
              <RefreshControl
                refreshing={wordsRefreshing}
                tintColor={p.primary}
                onRefresh={() => {
                  setWordsRefreshing(true);
                  void loadWords(debouncedSearch).finally(() => setWordsRefreshing(false));
                }}
              />
            }
            renderItem={({ item }) => (
              <WordRow
                item={item}
                onPress={(w) => router.push(`/word/${encodeURIComponent(w.word)}`)}
                onLongPress={setSheetItem}
              />
            )}
            ItemSeparatorComponent={() => <View className="mx-4 h-px bg-border" />}
            ListEmptyComponent={
              wordsLoading ? (
                <View className="gap-2 px-4 pt-4">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <Skeleton key={i} className="h-[52px]" />
                  ))}
                </View>
              ) : wordsError ? (
                <EmptyState
                  icon="alert-circle-outline"
                  title={t("vocab.networkError")}
                  hint={t("vocab.retry")}
                  actionTitle={t("vocab.retry")}
                  onAction={() => void loadWords(debouncedSearch)}
                />
              ) : (
                <EmptyState
                  icon="text-outline"
                  title={t("vocab.empty")}
                  hint={t("dash.empty.words")}
                />
              )
            }
          />
        </View>
      ) : segment === "patterns" ? (
        <FlashList
          data={patterns}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={patternsRefreshing}
              tintColor={p.primary}
              onRefresh={() => {
                setPatternsRefreshing(true);
                void loadPatterns().finally(() => setPatternsRefreshing(false));
              }}
            />
          }
          renderItem={({ item }) => (
            <PatternCard
              item={item}
              expanded={expandedPatternId === item.id}
              onToggle={(it) =>
                setExpandedPatternId((prev) => (prev === it.id ? null : it.id))
              }
              onToggleStar={(it) => {
                void db_set_pattern_starred({ patternId: it.id, starred: !it.starred })
                  .then(loadPatterns)
                  .catch((e) => console.warn("[learn] pattern star failed", e));
              }}
            />
          )}
          ListEmptyComponent={
            patternsLoading ? (
              <View className="gap-2 pt-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[72px]" />
                ))}
              </View>
            ) : (
              <EmptyState
                icon="chatbox-ellipses-outline"
                title={t("dash.patterns.title")}
                hint={t("dash.empty.patterns")}
              />
            )
          }
        />
      ) : (
        <ReviewSummaryCard
          dueCount={dueCount}
          newLimit={DEFAULT_NEW_LIMIT}
          onStart={() => {
            tapHaptic();
            router.push("/review");
          }}
        />
      )}

      <WordActionsSheet
        item={sheetItem}
        onClose={() => setSheetItem(null)}
        onToggleStar={onToggleStar}
        onDelete={onDeleteWord}
      />
    </Screen>
  );
}
