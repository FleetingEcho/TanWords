/**
 * app/reading/[id].tsx — saved-article reader.
 *
 * Paragraphs are split into sentences (src/lib/sentences.ts — same splitter
 * desktop uses); a marked sentence raises SentenceActionBar
 * (speak / translate); speak-all runs the app-wide TTS player
 * (src/services/tts.ts) with the current sentence highlighted word-for-word;
 * long-press a sentence opens WordLookupSheet (exact-match local vocab first,
 * AI quick-lookup / bare add otherwise). Playback stops when the screen loses
 * focus or unmounts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Button, Card, LoadingView, Screen, tapHaptic } from "@/components/ui";
import { db_get_reading_article, type ReadingArticleDetail } from "@/db/reading";
import { splitSentences, type Sentence } from "@/lib/sentences";
import { speakText, useTtsPlayer } from "@/services/tts";
import { SentenceActionBar } from "@/components/reading/SentenceActionBar";
import { WordLookupSheet } from "@/components/reading/WordLookupSheet";

export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = Number(id);
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const [article, setArticle] = useState<ReadingArticleDetail | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [marked, setMarked] = useState<Sentence | null>(null);
  const [lookupSentence, setLookupSentence] = useState<Sentence | null>(null);
  /** Global offsets of the currently-playing sentence, for highlight. */
  const [live, setLive] = useState<{ start: number; end: number } | null>(null);

  const tts = useTtsPlayer();

  const load = useCallback(async () => {
    try {
      const a = await db_get_reading_article({ id: articleId, touch: true });
      if (!a) {
        setLoadState("missing");
        return;
      }
      setArticle(a);
      setLoadState("ok");
    } catch (e) {
      console.error("[reading] article load failed:", e);
      setLoadState("error");
    }
  }, [articleId]);

  useEffect(() => {
    void load();
    return () => {
      // Leaving the reader always stops playback (task requirement).
      useTtsPlayer.getState().stop();
    };
  }, [load]);

  // Paragraphs keep GLOBAL offsets into article.content so the TTS player's
  // sentence offsets (from its own splitSentences on the full text) match the
  // spans below without any remapping.
  const paragraphs = useMemo(() => {
    if (!article) return [] as { start: number; text: string }[];
    const content = article.content;
    const out: { start: number; text: string }[] = [];
    const re = /\n[ \t\r]*\n[ \t\r\n]*/g;
    let m: RegExpExecArray | null;
    let segStart = 0;
    while ((m = re.exec(content))) {
      out.push({ start: segStart, text: content.slice(segStart, m.index) });
      segStart = m.index + m[0].length;
    }
    out.push({ start: segStart, text: content.slice(segStart) });
    return out.filter((p) => p.text.trim().length > 0);
  }, [article]);

  const startSpeakAll = useCallback(() => {
    if (!article) return;
    tapHaptic();
    // Generation-safe: callbacks are detached by the player's stop().
    useTtsPlayer.getState().start(article.content, {
      onSentence: (s) => setLive({ start: s.start, end: s.end }),
      onFinish: () => setLive(null),
      onError: () => setLive(null),
    });
  }, [article]);

  const stopSpeakAll = useCallback(() => {
    tapHaptic();
    useTtsPlayer.getState().stop();
    setLive(null);
  }, []);

  const speakOne = useCallback(
    (s: Sentence) => {
      tapHaptic();
      void Haptics.selectionAsync().catch(() => {});
      // speakText shares the player queue: it stops any speak-all chain first.
      void speakText(s.text);
    },
    []
  );

  const header = (
    <View className="flex-row items-center gap-2 px-2 pb-2 pt-2">
      <Pressable
        onPress={() => {
          tapHaptic();
          router.back();
        }}
        hitSlop={8}
        className="h-[44px] w-[44px] items-center justify-center"
        style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
        accessibilityLabel={t("readPage.reader.back")}
      >
        <Ionicons name="chevron-back" size={24} color={p.foreground} />
      </Pressable>
      <View className="flex-1">
        <Text className="text-[16px] font-semibold text-foreground" numberOfLines={1}>
          {article?.title || t("readPage.untitled")}
        </Text>
        <Text className="text-[12px] text-muted-foreground" numberOfLines={1}>
          {t("readPage.reader.wordsMeta", {
            source: article?.source || "paste",
            words: article?.word_count ?? 0,
          })}
        </Text>
      </View>
      {tts.status === "idle" ? (
        <Pressable
          onPress={startSpeakAll}
          hitSlop={8}
          className="h-[44px] w-[44px] items-center justify-center"
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
          accessibilityLabel={t("readPage.reader.listenAll")}
        >
          <Ionicons name="play-circle-outline" size={26} color={p.primary} />
        </Pressable>
      ) : (
        <View className="flex-row items-center">
          <Pressable
            onPress={() => {
              tapHaptic();
              if (tts.status === "playing") tts.pause();
              else void tts.resume();
            }}
            hitSlop={8}
            className="h-[44px] w-[44px] items-center justify-center"
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
            accessibilityLabel={tts.status === "playing" ? t("readPage.reader.pause") : t("readPage.reader.resume")}
          >
            <Ionicons
              name={tts.status === "playing" ? "pause-circle" : "play-circle"}
              size={28}
              color={p.primary}
            />
          </Pressable>
          <Pressable
            onPress={stopSpeakAll}
            hitSlop={8}
            className="h-[44px] w-[44px] items-center justify-center"
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
            accessibilityLabel={t("readPage.reader.stop")}
          >
            <Ionicons name="stop-circle-outline" size={26} color={p.destructive} />
          </Pressable>
        </View>
      )}
    </View>
  );

  if (loadState === "loading") {
    return (
      <Screen scroll={false} header={header}>
        <LoadingView />
      </Screen>
    );
  }

  if (loadState === "missing" || loadState === "error" || !article) {
    return (
      <Screen scroll={false} header={header}>
        <View className="flex-1 items-center justify-center px-6">
          <Card className="w-full items-center py-8">
            <Ionicons
              name={loadState === "missing" ? "document-outline" : "alert-circle-outline"}
              size={28}
              color={p["muted-foreground"]}
            />
            <Text className="mt-3 text-[15px] font-semibold text-foreground">
              {loadState === "missing" ? t("readPage.reader.notFound") : t("readPage.translate.error")}
            </Text>
            {loadState === "error" ? (
              <Button title={t("readPage.retry")} variant="secondary" size="sm" className="mt-4" onPress={() => { setLoadState("loading"); void load(); }} />
            ) : (
              <Button title={t("readPage.reader.back")} variant="secondary" size="sm" className="mt-4" onPress={() => router.back()} />
            )}
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false} header={header}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-10 pt-1"
        showsVerticalScrollIndicator={false}
      >
        {paragraphs.map((para) => (
          <ParagraphView
            key={para.start}
            text={para.text}
            offsetStart={para.start}
            marked={marked}
            live={live}
            onMark={(s) => {
              tapHaptic();
              setMarked((prev) => (prev && prev.start === s.start ? null : s));
            }}
            onLookup={(s) => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setLookupSentence(s);
            }}
          />
        ))}
      </ScrollView>

      {marked ? (
        <SentenceActionBar
          sentence={marked}
          onClose={() => setMarked(null)}
          onSpeak={speakOne}
        />
      ) : null}

      <WordLookupSheet sentence={lookupSentence} onClose={() => setLookupSentence(null)} />
    </Screen>
  );
}

/**
 * One paragraph as a flow of tappable sentence spans. Sentence-text groups are
 * Pressable spans so marks can share native text styling (highlight is a
 * background color on the span). Long-press opens the word lookup sheet.
 */
function ParagraphView({
  text,
  offsetStart,
  marked,
  live,
  onMark,
  onLookup,
}: {
  text: string;
  offsetStart: number;
  marked: Sentence | null;
  live: { start: number; end: number } | null;
  onMark: (s: Sentence) => void;
  onLookup: (s: Sentence) => void;
}) {
  const p = usePalette();
  const sentences = useMemo(() => splitSentences(text), [text]);

  return (
    <Text className="mb-4 text-[16px] leading-8 text-foreground">
      {sentences.map((s, i) => {
        const isMarked = marked !== null && marked.text === s.text && marked.start === s.start;
        const gStart = offsetStart + s.start;
        const isLive = live !== null && gStart >= live.start && gStart < live.end;
        return (
          <Text
            key={`${offsetStart}-${s.start}-${i}`}
            onPress={() => onMark(s)}
            onLongPress={() => onLookup(s)}
            style={{
              backgroundColor: isMarked
                ? p.accent
                : isLive
                  ? p["muted"]
                  : "transparent",
              color: isMarked ? p["accent-foreground"] : p.foreground,
            }}
          >
            {s.text}
            {i < sentences.length - 1 ? " " : ""}
          </Text>
        );
      })}
    </Text>
  );
}
