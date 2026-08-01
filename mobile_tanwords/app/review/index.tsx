/**
 * /review — FSRS review session (port spec: desktop quiz/review flow over
 * db_get_due_cards + db_review_card; backlog first, then new introductions,
 * both handled inside db_get_due_cards — same as desktop).
 *
 * Session semantics: cards commit to SQLite the moment they are graded
 * (db_review_card), so leaving mid-session never corrupts scheduling —
 * remaining cards simply stay due.
 */
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  Button,
  Card,
  EmptyState,
  LoadingView,
  Screen,
  tapHaptic,
} from "@/components/ui";
import { usePalette } from "@/lib/theme";
import { useT } from "@/hooks/useT";
import { db_get_due_cards, db_review_card } from "@/db/srs";
import type { DueCard } from "@/hooks/useDB.types";

const RATINGS = [
  { rating: 1 as const, key: "vocab.review.again", tone: "bg-destructive" },
  { rating: 2 as const, key: "vocab.review.hard", tone: "bg-secondary" },
  { rating: 3 as const, key: "vocab.review.good", tone: "bg-primary" },
  { rating: 4 as const, key: "vocab.review.easy", tone: "bg-accent" },
] as const;

export default function ReviewScreen() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const [phase, setPhase] = useState<"loading" | "active" | "done">("loading");
  const [cards, setCards] = useState<DueCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [lapses, setLapses] = useState(0);
  const [grading, setGrading] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    setPhase("loading");
    try {
      const due = await db_get_due_cards();
      setCards(due);
      setIdx(0);
      setRevealed(false);
      setReviewed(0);
      setLapses(0);
      setPhase("active");
    } catch (e) {
      console.warn("[review] load failed", e);
      setCards([]);
      setPhase("active"); // falls through to the empty state below
    }
  }, []);

  if (!started.current) {
    started.current = true;
    void start();
  }

  const card = cards[idx] ?? null;

  const grade = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || grading) return;
      setGrading(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      try {
        await db_review_card({ wordId: card.word_id, rating });
      } catch (e) {
        // Port of desktop behavior: grading failures log and advance; the card
        // stays due and reappears next session instead of blocking the queue.
        console.warn("[review] grade failed", e);
      }
      setReviewed((n) => n + 1);
      if (rating === 1) setLapses((n) => n + 1);
      if (idx + 1 >= cards.length) {
        setPhase("done");
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        setIdx((i) => i + 1);
        setRevealed(false);
      }
      setGrading(false);
    },
    [card, cards.length, grading, idx]
  );

  return (
    <Screen
      scroll={false}
      padded
      header={
        <View className="flex-row items-center justify-between px-4 pb-2 pt-2">
          <Pressable
            onPress={() => {
              tapHaptic();
              router.back();
            }}
            hitSlop={12}
            className="min-h-[44px] min-w-[44px] justify-center"
          >
            <Ionicons name="close" size={26} color={p["muted-foreground"]} />
          </Pressable>
          {phase === "active" && cards.length > 0 ? (
            <Text className="text-[13px] font-medium text-muted-foreground">
              {idx + 1} / {cards.length}
            </Text>
          ) : null}
          <View className="min-w-[44px]" />
        </View>
      }
    >
      {phase === "loading" ? (
        <LoadingView label={t("vocab.loading")} />
      ) : phase === "done" ? (
        <View className="flex-1 items-center justify-center px-6 pb-16">
          <View className="mb-4 rounded-full bg-accent p-5">
            <Ionicons name="checkmark-circle" size={44} color={p["accent-foreground"]} />
          </View>
          <Text className="text-[22px] font-bold text-foreground">{t("vocab.review.doneTitle")}</Text>
          <Text className="mt-2 text-[15px] text-muted-foreground">
            {t("vocab.review.doneSummary", { reviewed, lapses })}
          </Text>
          <Button
            title={t("vocab.review.backHome")}
            className="mt-6 self-stretch"
            onPress={() => router.navigate("/")}
          />
        </View>
      ) : !card ? (
        <View className="flex-1 justify-center">
          <EmptyState
            icon="checkmark-done-outline"
            title={t("vocab.review.allDone")}
            hint={t("vocab.review.empty")}
            actionTitle={t("vocab.review.backHome")}
            onAction={() => router.navigate("/")}
          />
        </View>
      ) : (
        <View className="flex-1 pb-4">
          {/* Flip-to-reveal card */}
          <Pressable
            className="flex-1"
            onPress={() => {
              if (!revealed) {
                tapHaptic();
                setRevealed(true);
              }
            }}
          >
            <Card className="flex-1 items-center justify-center p-6">
              {card.level ? (
                <View className="absolute left-4 top-4 rounded-md bg-muted px-1.5 py-0.5">
                  <Text className="text-[10px] font-semibold text-muted-foreground">
                    {card.level}
                  </Text>
                </View>
              ) : null}
              <Text className="text-center text-[30px] font-bold leading-10 text-foreground">
                {card.word}
              </Text>
              {revealed ? (
                <View className="mt-5 items-center gap-3">
                  {card.zh ? (
                    <Text className="text-center text-[17px] leading-7 text-foreground">
                      {card.zh}
                    </Text>
                  ) : null}
                  {card.context_sentence ? (
                    <Text className="mt-1 text-center text-[14px] italic leading-6 text-muted-foreground">
                      {card.context_sentence}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Text className="mt-6 text-[13px] text-muted-foreground">
                  {t("vocab.review.tapToReveal")}
                </Text>
              )}
            </Card>
          </Pressable>

          {/* Grade bar — 44px+ targets; disabled until revealed like Anki. */}
          <View className="mt-3 flex-row gap-2">
            {RATINGS.map((r) => (
              <Pressable
                key={r.rating}
                disabled={!revealed || grading}
                onPress={() => void grade(r.rating)}
                className={`min-h-[48px] flex-1 items-center justify-center rounded-xl ${r.tone} ${
                  !revealed || grading ? "opacity-40" : ""
                }`}
                style={({ pressed }) => (pressed && revealed ? { opacity: 0.85 } : undefined)}
              >
                <Text
                  className={`text-[14px] font-semibold ${
                    r.rating === 1 || r.rating === 3
                      ? "text-primary-foreground"
                      : "text-foreground"
                  }`}
                >
                  {t(r.key)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}
