import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { LevelBadge } from "@/components/shared/LevelBadge";
import type { DueCard, SrsRating } from "@/hooks/useDB.types";

type Phase = "loading" | "empty" | "review" | "done";

/** FSRS due-card review — the web-only UI over the desktop app's
 *  `db_get_due_cards` / `db_review_card` commands (desktop never grew one;
 *  the commands existed for MCP tools). One card at a time: word first, tap
 *  (or Space) to reveal the gloss, then grade yourself against FSRS's three
 *  ratings. Grade buttons are intentionally huge — this screen is a phone
 *  screen first. */
export function ReviewPanel({ onExit, onFinished }: { onExit: () => void; onFinished: (reviewed: number) => void }) {
  const db = useDB();
  const t = useT();
  const [phase, setPhase] = useState<Phase>("loading");
  const [cards, setCards] = useState<DueCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  // Cards successfully graded. `index` alone under-counts on the last card:
  // the done phase is entered WITHOUT incrementing it, so the summary showed
  // `cards.length - 1`.
  const [reviewedCount, setReviewedCount] = useState(0);

  const load = useCallback(async () => {
    setPhase("loading");
    setRevealed(false);
    setIndex(0);
    setReviewedCount(0);
    const due = await db.getDueCards();
    if (phase === "loading" && due.length === 0 && cards.length === 0) {
      // First load failed silently (getDueCards logs and returns []) vs a real
      // empty queue is indistinguishable — the empty screen's Retry covers both,
      // and the user sees the honest empty state either way.
    }
    setCards(due);
    setPhase(due.length === 0 ? "empty" : "review");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cards intentionally excluded: load() resets the queue.
  }, [db]);

  useEffect(() => { void load(); }, [load]);

  const card: DueCard | null = phase === "review" ? cards[index] ?? null : null;

  const grade = useCallback(async (rating: SrsRating) => {
    if (!card || grading) return;
    setGrading(true);
    const result = await db.reviewCard(card.word_id, rating);
    setGrading(false);
    if (!result) {
      toast.error(t("vocab.review.gradeFailed"));
      return;
    }
    setReviewedCount((n) => n + 1);
    if (index + 1 >= cards.length) {
      setPhase("done");
      onFinished(cards.length);
    } else {
      setIndex(index + 1);
      setRevealed(false);
    }
    // FSRS can be flaky to feel out; nothing else to do per card — the server
    // already rescheduled it.
  }, [card, grading, index, cards.length, db, t, onFinished]);

  // Desktop keyboard: Space reveals, 1/2/3 grade again/hard/good.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (phase !== "review") return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && (event.key === "1" || event.key === "2" || event.key === "3")) {
        const rating = event.key === "1" ? "again" : event.key === "2" ? "hard" : "good";
        void grade(rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, revealed, grade]);

  if (phase === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="w-6 h-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-semibold">{t("vocab.review.emptyTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("vocab.review.emptyHint")}</p>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={() => void load()} className="h-10">{t("vocab.review.refresh")}</Button>
          <Button variant="ghost" onClick={onExit} className="h-10">{t("vocab.review.backToWords")}</Button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-semibold">{t("vocab.review.doneTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("vocab.review.doneHint", { n: reviewedCount })}</p>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={() => void load()} className="h-10">{t("vocab.review.againRound")}</Button>
          <Button variant="ghost" onClick={onExit} className="h-10">{t("vocab.review.backToWords")}</Button>
        </div>
      </div>
    );
  }

  if (!card) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* progress + exit */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-3">
        <span className="text-xs text-muted-foreground">{t("vocab.review.progress", { done: Math.min(reviewedCount + 1, cards.length), total: cards.length })}</span>
        <Button variant="ghost" size="sm" onClick={onExit} className="h-9 text-xs">{t("vocab.review.backToWords")}</Button>
      </div>

      {/* the card itself — tap to reveal */}
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="mx-4 mt-3 flex min-h-[40vh] flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-6 py-8 text-center transition-colors hover:border-primary/30 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <span className="text-3xl font-bold tracking-wide">{card.word}</span>
          <LevelBadge level={card.level} />
        </span>
        {revealed ? (
          <div className="space-y-3 animate-fade-in">
            {card.zh && <p className="text-lg text-foreground/90">{card.zh}</p>}
            {card.context_sentence && (
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md">{card.context_sentence}</p>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{t("vocab.review.tapToReveal")}</span>
        )}
      </button>

      {/* grading — big tappable targets first, keyboard for desktop */}
      <div className="flex shrink-0 gap-2 px-4 py-4">
        {!revealed ? (
          <Button className="h-12 flex-1 text-base" onClick={() => setRevealed(true)}>
            {t("vocab.review.show")}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={grading}
              onClick={() => void grade("again")}
              className="h-12 flex-1 text-base border-rose-300/60 text-rose-600 hover:bg-rose-50 dark:border-rose-800/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              {t("vocab.review.again")}
            </Button>
            <Button
              variant="outline"
              disabled={grading}
              onClick={() => void grade("hard")}
              className="h-12 flex-1 text-base border-amber-300/60 text-amber-600 hover:bg-amber-50 dark:border-amber-800/60 dark:text-amber-400 dark:hover:bg-amber-950/40"
            >
              {t("vocab.review.hard")}
            </Button>
            <Button
              variant="outline"
              disabled={grading}
              onClick={() => void grade("good")}
              className="h-12 flex-1 text-base border-emerald-300/60 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800/60 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
            >
              {t("vocab.review.good")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
