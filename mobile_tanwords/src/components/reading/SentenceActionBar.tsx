/**
 * SentenceActionBar — the fixed bottom bar shown when a sentence is marked
 * in the article reader: 朗读单句 / 翻译 / 关闭, with the streamed
 * translation expanding above the buttons.
 *
 * Translation: one non-tool call through the provider registry
 * (translate pipeline — providers/base.ts buildSystemPrompt("translate")),
 * aborted when the bar closes or a different sentence gets marked.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { tapHaptic } from "@/components/ui";
import { findBestProvider } from "@/providers/select";
import { ensureProviders } from "@/hooks/useAnalyzeArticle";
import type { Sentence } from "@/lib/sentences";

export function SentenceActionBar({
  sentence,
  onClose,
  onSpeak,
}: {
  sentence: Sentence;
  onClose: () => void;
  onSpeak: (s: Sentence) => void;
}) {
  const t = useT();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopTranslation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTranslating(false);
  }, []);

  const runTranslate = useCallback(async () => {
    tapHaptic();
    stopTranslation();
    setTranslating(true);
    setTranslateError(null);
    setTranslation("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await ensureProviders();
      const provider = findBestProvider();
      if (!provider?.apiKey) throw new Error(t("reading.translate.noProvider"));
      let acc = "";
      for await (const chunk of provider.translate({
        text: sentence.text,
        targetLang: "中文",
        mode: "translate",
      })) {
        if (controller.signal.aborted) return;
        acc += chunk;
        setTranslation(acc);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setTranslation(null);
      setTranslateError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setTranslating(false);
    }
  }, [sentence.text, stopTranslation, t]);

  // A new marked sentence invalidates the old translation panel.
  useEffect(() => {
    stopTranslation();
    setTranslation(null);
    setTranslateError(null);
  }, [sentence.text, stopTranslation]);

  useEffect(() => stopTranslation, [stopTranslation]);

  return (
    <View
      className="border-t border-border bg-card"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {translation !== null || translating || translateError ? (
        <View className="border-b border-border px-4 pb-1 pt-2">
          {translateError ? (
            <Text className="text-[13px] text-destructive">{translateError}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
              <Text className="pb-2 text-[14px] leading-6 text-foreground">{translation}</Text>
            </ScrollView>
          )}
        </View>
      ) : null}
      <Text className="px-4 pt-2 text-[12px] text-muted-foreground" numberOfLines={1}>
        {sentence.text}
      </Text>
      <View className="flex-row items-stretch gap-2 px-4 pb-1 pt-2">
        <ActionButton
          icon="volume-high-outline"
          label={t("readPage.action.speak")}
          onPress={() => onSpeak(sentence)}
        />
        <ActionButton
          icon="language-outline"
          label={translating ? t("readPage.translate.loading") : t("readPage.action.translate")}
          loading={translating}
          onPress={() => void runTranslate()}
        />
        <ActionButton icon="close" label={t("readPage.action.close")} onPress={onClose} />
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  loading = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      className="min-h-[44px] flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-muted"
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
    >
      {loading ? (
        <ActivityIndicator size="small" color={p.foreground} />
      ) : (
        <Ionicons name={icon} size={16} color={p.foreground} />
      )}
      <Text className="text-[13px] font-medium text-foreground" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
