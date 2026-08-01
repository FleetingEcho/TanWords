/**
 * AcceptSheet — the AI-extraction accept flow, bottom-sheet modal.
 *
 * Behavior ported from the desktop review cards
 * (app/src/components/AiChat/VocabExtractionCard.tsx / SentenceExtractionCard.tsx):
 *  - multi-select is OPT-OUT: everything starts selected, tap to deselect
 *  - a 全选 header toggle per tab (unchecked/indeterminate states)
 *  - batch "加入所选" writes; words via db_add_words_batch (INSERT OR IGNORE,
 *    duplicates reported as skipped), patterns via db_save_sentence_pattern
 *    (deduped by exact sentence)
 *  - source tags recorded as "reading" (desktop used "chat" for chat-originated)
 *
 * The sheet owns saving; the parent owns article persistence + navigation
 * (onSaved fires after every chosen row is written).
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Button, Divider, SegmentedTabs, tapHaptic } from "@/components/ui";
import { BottomSheet } from "./BottomSheet";
import { db_add_words_batch } from "@/db/words";
import { db_save_sentence_pattern } from "@/db/patterns";
import type { ExtractedPattern, ExtractedWord } from "@/ai/analyze";

export interface AcceptResult {
  wordsAdded: number;
  wordsSkipped: number;
  patternsAdded: number;
}

type TabKey = "words" | "patterns";

function LevelChip({ level }: { level: string }) {
  if (!level) return null;
  return (
    <View className="rounded bg-muted px-1.5 py-0.5">
      <Text className="text-[10px] font-semibold text-muted-foreground">{level}</Text>
    </View>
  );
}

function CheckDot({ checked }: { checked: boolean }) {
  const p = usePalette();
  return (
    <Ionicons
      name={checked ? "checkmark-circle" : "ellipse-outline"}
      size={24}
      color={checked ? p.primary : p["muted-foreground"]}
    />
  );
}

export function AcceptSheet({
  visible,
  words,
  patterns,
  onSaved,
  onCancel,
}: {
  visible: boolean;
  words: ExtractedWord[];
  patterns: ExtractedPattern[];
  /** Fires after chosen items are persisted (possibly zero). */
  onSaved: (r: AcceptResult) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const p = usePalette();
  const [tab, setTab] = useState<TabKey>(words.length > 0 ? "words" : "patterns");
  const [deselectedWords, setDeselectedWords] = useState<Record<number, boolean>>({});
  const [deselectedPatterns, setDeselectedPatterns] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedWords = useMemo(
    () => words.map((_, i) => i).filter((i) => !deselectedWords[i]),
    [words, deselectedWords]
  );
  const selectedPatterns = useMemo(
    () => patterns.map((_, i) => i).filter((i) => !deselectedPatterns[i]),
    [patterns, deselectedPatterns]
  );
  const totalSelected = selectedWords.length + selectedPatterns.length;

  const onTab = words.length > 0 && patterns.length > 0 ? tab : words.length > 0 ? "words" : "patterns";
  const currentDeselected = onTab === "words" ? deselectedWords : deselectedPatterns;
  const setCurrentDeselected = onTab === "words" ? setDeselectedWords : setDeselectedPatterns;
  const currentLen = onTab === "words" ? words.length : patterns.length;
  const currentSelectedCount = onTab === "words" ? selectedWords.length : selectedPatterns.length;

  const toggleAll = () => {
    tapHaptic();
    const selectAll = currentSelectedCount < currentLen;
    const next = { ...currentDeselected };
    for (let i = 0; i < currentLen; i++) next[i] = !selectAll;
    setCurrentDeselected(next);
  };

  const save = async (allWords: number[], allPatterns: number[]) => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    let wordsAdded = 0;
    let wordsSkipped = 0;
    let patternsAdded = 0;
    try {
      if (allWords.length > 0) {
        const result = await db_add_words_batch({
          words: allWords.map((i) => {
            const w = words[i];
            return {
              word: w.word,
              zh: w.zh,
              word_type: w.word_type || null,
              level: w.level || null,
              context: w.context || null,
            };
          }),
          source: "reading",
        });
        wordsAdded = result.added;
        wordsSkipped = result.skipped;
      }
      for (const i of allPatterns) {
        const pt = patterns[i];
        try {
          const saved = await db_save_sentence_pattern({
            sentence: pt.sentence,
            zh: pt.zh,
            skeleton: pt.skeleton,
            note: pt.note,
            level: pt.level,
            source: "reading",
          });
          if (saved.created) patternsAdded += 1;
        } catch {
          // One malformed row must not sink the rest — count it as unsaved.
        }
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved({ wordsAdded, wordsSkipped, patternsAdded });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const deselectedCount = words.length - selectedWords.length + (patterns.length - selectedPatterns.length);

  return (
    <BottomSheet visible={visible} onClose={saving ? undefined : onCancel} title={t("readPage.accept.title")}>
      {words.length > 0 && patterns.length > 0 ? (
        <View className="mx-5 mb-2">
          <SegmentedTabs<TabKey>
            options={[
              { key: "words", label: t("readPage.accept.tab.words", { n: words.length }) },
              { key: "patterns", label: t("readPage.accept.tab.patterns", { n: patterns.length }) },
            ]}
            value={onTab}
            onChange={setTab}
          />
        </View>
      ) : null}

      {/* Select-all row (opt-out model, same as desktop). */}
      <Pressable
        onPress={toggleAll}
        className="mx-5 mb-1 mt-1 min-h-[36px] flex-row items-center justify-end gap-2"
        style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
      >
        <Text className="text-[12px] text-muted-foreground">
          {t("readPage.accept.selected", { n: currentSelectedCount, total: currentLen })}
        </Text>
        <Text className="text-[13px] font-medium text-primary">{t("readPage.accept.selectAll")}</Text>
        {currentSelectedCount === currentLen ? (
          <Ionicons name="checkmark-circle" size={18} color={p.primary} />
        ) : (
          <Ionicons name="ellipse-outline" size={18} color={p["muted-foreground"]} />
        )}
      </Pressable>
      <Divider className="mx-5" />

      <View className="min-h-[160px]">
        {onTab === "words" ? (
          <FlashList
            data={words}
            keyExtractor={(item, i) => `w-${i}-${item.word}`}
            renderItem={({ item, index }) => {
              const checked = !deselectedWords[index];
              return (
                <Pressable
                  onPress={() => {
                    tapHaptic();
                    setDeselectedWords((prev) => ({ ...prev, [index]: checked }));
                  }}
                  className="min-h-[56px] flex-row items-start gap-3 px-5 py-3"
                  style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
                >
                  <View className="pt-0.5">
                    <CheckDot checked={checked} />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
                        {item.word}
                      </Text>
                      {item.word_type ? (
                        <View className="rounded bg-muted px-1.5 py-0.5">
                          <Text className="text-[10px] text-muted-foreground">{item.word_type}</Text>
                        </View>
                      ) : null}
                      <LevelChip level={item.level} />
                    </View>
                    <Text className="mt-0.5 text-[13px] text-foreground" numberOfLines={2}>
                      {item.zh}
                    </Text>
                    {item.context ? (
                      <Text className="mt-1 text-[11px] italic leading-4 text-muted-foreground" numberOfLines={2}>
                        “{item.context}”
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
          />
        ) : (
          <FlashList
            data={patterns}
            keyExtractor={(item, i) => `p-${i}-${item.sentence.slice(0, 24)}`}
            renderItem={({ item, index }) => {
              const checked = !deselectedPatterns[index];
              return (
                <Pressable
                  onPress={() => {
                    tapHaptic();
                    setDeselectedPatterns((prev) => ({ ...prev, [index]: checked }));
                  }}
                  className="min-h-[56px] flex-row items-start gap-3 px-5 py-3"
                  style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
                >
                  <View className="pt-0.5">
                    <CheckDot checked={checked} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[14px] font-medium leading-5 text-foreground" numberOfLines={3}>
                      {item.sentence}
                    </Text>
                    <Text className="mt-0.5 text-[13px] text-muted-foreground" numberOfLines={2}>
                      {item.zh}
                    </Text>
                    {item.skeleton || item.note ? (
                      <Text className="mt-1 text-[11px] italic leading-4 text-muted-foreground" numberOfLines={2}>
                        {[item.skeleton, item.note].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>

      {saveError ? (
        <Text className="mx-5 mt-2 text-[13px] text-destructive">{saveError}</Text>
      ) : null}

      <View className="mx-5 mt-3 flex-row items-center gap-3">
        {saving ? (
          <View className="h-[44px] flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary">
            <ActivityIndicator size="small" color={p["primary-foreground"]} />
            <Text className="text-[15px] font-semibold text-primary-foreground">
              {t("readPage.accept.adding")}
            </Text>
          </View>
        ) : (
          <>
            <Button
              title={t("readPage.accept.addSelected", { n: totalSelected })}
              onPress={() => void save(selectedWords, selectedPatterns)}
              disabled={totalSelected === 0}
              className="flex-1"
            />
            {deselectedCount > 0 ? (
              <Button
                title={t("readPage.accept.addAll")}
                variant="secondary"
                onPress={() =>
                  void save(
                    words.map((_, i) => i),
                    patterns.map((_, i) => i)
                  )
                }
              />
            ) : null}
          </>
        )}
      </View>
    </BottomSheet>
  );
}
