/**
 * WordLookupSheet — long-press a sentence → its words listed; tap a word →
 * exact-match local lookup first (words table), /word/[word] deep-link when
 * saved, and for unsaved words either the AI quick lookup stream
 * (QUICK_LOOKUP_* prompts from providers/base.ts, EnrichmentText-style
 * blockquotes) or a bare add via db_add_word with the sentence as context —
 * per the task's fallback decision (no basicInfo/enrich infra port here).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Button, tapHaptic } from "@/components/ui";
import { BottomSheet } from "./BottomSheet";
import { speakText } from "@/services/tts";
import { db_get_words, db_add_words_batch } from "@/db/words";
import { findBestProvider } from "@/providers/select";
import { QUICK_LOOKUP_SYSTEM_PROMPT, buildQuickLookupUserPrompt } from "@/providers/base";
import { ensureProviders } from "@/hooks/useAnalyzeArticle";
import { useSettingsStore } from "@/store/settingsStore";
import type { Sentence } from "@/lib/sentences";

const WORD_LINE = /^[A-Za-z][A-Za-z'’-]*$/;

export function WordLookupSheet({
  sentence,
  onClose,
}: {
  sentence: Sentence | null;
  onClose: () => void;
}) {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  const words = useMemo(() => {
    if (!sentence) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tok of sentence.text.split(/[^A-Za-z'’-]+/)) {
      const clean = tok.replace(/^['’-]+|['’-]+$/g, "");
      if (!WORD_LINE.test(clean)) continue;
      const lower = clean.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(clean);
    }
    return out;
  }, [sentence]);

  useEffect(() => setSelectedWord(null), [sentence]);

  return (
    <BottomSheet
      visible={sentence !== null}
      onClose={onClose}
      title={t("readPage.lookup.title")}
      maxHeightPercent={0.8}
    >
      {selectedWord && sentence ? (
        <LookupDetail
          word={selectedWord}
          sentence={sentence}
          onBack={() => setSelectedWord(null)}
          onOpenDetail={(w) => {
            onClose();
            router.push(`/word/${encodeURIComponent(w)}`);
          }}
        />
      ) : (
        <View>
          <Text className="px-5 pb-1 text-[12px] text-muted-foreground">
            {t("readPage.lookup.tapHint")}
          </Text>
          <Text className="px-5 pb-2 text-[14px] leading-6 text-foreground" numberOfLines={3}>
            {sentence?.text}
          </Text>
          <ScrollView style={{ maxHeight: 260 }}>
            <View className="flex-row flex-wrap gap-2 px-5 pb-3">
              {words.map((w) => (
                <Pressable
                  key={w}
                  onPress={() => {
                    tapHaptic();
                    setSelectedWord(w);
                  }}
                  className="rounded-full bg-muted px-3 py-1.5"
                  style={({ pressed }) => (pressed ? { opacity: 0.75 } : undefined)}
                >
                  <Text className="text-[14px] text-foreground">{w}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </BottomSheet>
  );
}

function LookupDetail({
  word,
  sentence,
  onBack,
  onOpenDetail,
}: {
  word: string;
  sentence: Sentence;
  onBack: () => void;
  onOpenDetail: (word: string) => void;
}) {
  const t = useT();
  const p = usePalette();
  const targetLevels = useSettingsStore((s) => s.targetLevels);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "lookup"; display: string; gloss: string; inVocab: boolean }
    | { kind: "error"; message: string; hasProvider: boolean }
  >({ kind: "loading" });
  const [adding, setAdding] = useState<"idle" | "adding" | "added">("idle");
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "loading" });
    setAdding("idle");

    const lower = word.toLowerCase();
    // Exact-match local vocabulary lookup first — no AI call needed.
    try {
      const hits = await db_get_words({ search: word });
      if (controller.signal.aborted) return;
      const exact = hits.find((h) => h.word.toLowerCase() === lower);
      if (exact) {
        setState({ kind: "lookup", display: exact.word, gloss: exact.zh ?? "", inVocab: true });
        return;
      }
    } catch {
      // A failed DB read shouldn't block the AI path; fall through to AI lookup.
    }

    await ensureProviders();
    if (controller.signal.aborted) return;
    const provider = findBestProvider();
    if (!provider?.apiKey) {
      setState({ kind: "error", message: t("readPage.lookup.noProvider"), hasProvider: false });
      return;
    }
    try {
      let acc = "";
      for await (const chunk of provider.generate(
        QUICK_LOOKUP_SYSTEM_PROMPT,
        buildQuickLookupUserPrompt(lower, (targetLevels[0] ?? "C1").toString()),
        controller.signal
      )) {
        if (controller.signal.aborted) return;
        acc += chunk;
        // First non-quote line doubles as the gloss for the bare-add fallback.
        const gloss = acc
          .split("\n")
          .map((l) => l.replace(/^[>\s]+/, "").trim())
          .find((l) => l.length > 0);
        setState({
          kind: "lookup",
          display: lower,
          gloss: gloss ?? acc.trim(),
          inVocab: false,
        });
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
        hasProvider: true,
      });
    }
  }, [word, targetLevels, t]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const addToVocab = useCallback(async () => {
    if (adding !== "idle") return;
    tapHaptic();
    setAdding("adding");
    try {
      // db_add_words_batch carries the sentence as the definition's example_en
      // (context column) — a bare db_add_word can't.
      await db_add_words_batch({
        words: [
          {
            word: word.toLowerCase(),
            zh: state.kind === "lookup" ? state.gloss.split("\n")[0]?.trim() ?? "" : "",
            context: sentence.text,
          },
        ],
        source: "reading",
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAdding("added");
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
        hasProvider: true,
      });
      setAdding("idle");
    }
  }, [adding, word, state, sentence]);

  return (
    <View>
      <Pressable onPress={onBack} hitSlop={8} className="px-5 pb-2" style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}>
        <Text className="text-[13px] font-medium text-primary">‹ {t("readPage.reader.back")}</Text>
      </Pressable>
      <View className="flex-row items-center gap-2 px-5">
        <Text className="text-[20px] font-bold text-foreground">
          {state.kind === "lookup" ? state.display : word.toLowerCase()}
        </Text>
        <Pressable onPress={() => void speakText(word.toLowerCase())} hitSlop={8} style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}>
          <Ionicons name="volume-high-outline" size={18} color={p.primary} />
        </Pressable>
      </View>

      <ScrollView style={{ maxHeight: 280, marginTop: 8 }}>
        <View className="px-5 pb-2">
          {state.kind === "loading" ? (
            <View className="flex-row items-center gap-2 py-3">
              <ActivityIndicator size="small" color={p.primary} />
              <Text className="text-[13px] text-muted-foreground">{t("readPage.lookup.aiLoading")}</Text>
            </View>
          ) : state.kind === "error" ? (
            <View className="gap-1 py-1">
              <Text className="text-[13px] text-destructive">
                {t("readPage.lookup.aiError", { msg: state.message })}
              </Text>
              {state.hasProvider ? (
                <Pressable onPress={() => void load()} hitSlop={8}>
                  <Text className="text-[13px] font-semibold text-primary">{t("readPage.retry")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View className="gap-1 py-1">
              {state.inVocab ? (
                <View className="flex-row items-center gap-1.5 pb-1">
                  <Ionicons name="checkmark-circle" size={13} color={p.primary} />
                  <Text className="text-[12px] font-medium text-primary">{t("readPage.lookup.inVocab")}</Text>
                </View>
              ) : null}
              {state.gloss.split("\n").map((line, i) =>
                line.startsWith(">") ? (
                  <Text key={i} className="mt-1 border-l-2 pl-2 text-[13px] leading-6 text-foreground" style={{ borderColor: p.border }}>
                    {line.replace(/^>\s?/, "")}
                  </Text>
                ) : (
                  <Text key={i} className="mt-1 text-[14px] leading-6 text-foreground">
                    {line}
                  </Text>
                )
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <View className="mx-5 mt-2 flex-row items-center gap-3">
        {state.kind === "lookup" && state.inVocab ? (
          <Button title={t("readPage.lookup.detail")} className="flex-1" onPress={() => onOpenDetail(state.display)} />
        ) : (
          <Button
            title={adding === "added" ? t("readPage.lookup.added") : t("readPage.lookup.add")}
            className="flex-1"
            variant={adding === "added" ? "secondary" : "primary"}
            loading={adding === "adding"}
            disabled={adding === "added" || state.kind === "loading"}
            onPress={() => void addToVocab()}
            icon={
              adding === "added" ? (
                <Ionicons name="checkmark" size={16} color={p["secondary-foreground"]} />
              ) : undefined
            }
          />
        )}
      </View>
      <Text className="px-5 pt-2 text-[11px] text-muted-foreground" numberOfLines={1}>
        “{sentence.text}”
      </Text>
    </View>
  );
}
