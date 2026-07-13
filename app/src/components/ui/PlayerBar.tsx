import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { useArticlePlayer } from "@/hooks/useArticlePlayer";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useLayoutStore, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from "@/store/layoutStore";
import { PlayIcon, PauseIcon, SkipPrevIcon, SkipNextIcon, CloseIcon, RefreshIcon } from "@/components/ui/icons";

const SPEEDS = [0.75, 1, 1.25, 1.5];

/** Mount exactly once (in App.tsx) — the actual playback mechanics live in
 * `useArticlePlayer`, this component is purely the sunk-to-bottom controls. */
export function PlayerBar() {
  useArticlePlayer();

  const t = useT();
  const status = useTtsPlayerStore((s) => s.status);
  const sentences = useTtsPlayerStore((s) => s.sentences);
  const currentIndex = useTtsPlayerStore((s) => s.currentIndex);
  const speed = useTtsPlayerStore((s) => s.speed);
  const toggle = useTtsPlayerStore((s) => s.toggle);
  const next = useTtsPlayerStore((s) => s.next);
  const prev = useTtsPlayerStore((s) => s.prev);
  const retry = useTtsPlayerStore((s) => s.retry);
  const setSpeed = useTtsPlayerStore((s) => s.setSpeed);
  const stop = useTtsPlayerStore((s) => s.stop);
  const jumpTo = useTtsPlayerStore((s) => s.jumpTo);
  const goToOrigin = usePlayerOriginStore((s) => s.goToOrigin);
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);

  // ── Slider: local state for drag-follow, store-driven currentIndex ────
  // ALL hooks must live above the early-return, otherwise the hook count
  // changes when status transitions in/out of "idle" (Rules of Hooks).
  const [sliderIdx, setSliderIdx] = useState(currentIndex);
  const pendingIdxRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingIdxRef.current === null) setSliderIdx(currentIndex);
  }, [currentIndex]);

  const handleSliderInput = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    const idx = parseInt((e.target as HTMLInputElement).value, 10);
    pendingIdxRef.current = idx;
    setSliderIdx(idx);
  }, []);

  const commitSlider = useCallback(() => {
    const idx = pendingIdxRef.current;
    pendingIdxRef.current = null;
    if (idx !== null && idx !== currentIndex) {
      jumpTo(idx);
    }
  }, [currentIndex, jumpTo]);

  // ── Early return (after all hooks) ──────────────────────────────────────
  if (status === "idle") return null;

  const isPlaying = status === "playing";
  const isError = status === "error";
  const isLoading = status === "loading";
  const maxIndex = Math.max(0, sentences.length - 1);
  // Fraction of sentences fully finished — the current sentence (still playing)
  // doesn't count as done, so this never shows 100% until playback actually stops.
  const progressPercent = sentences.length > 0 ? Math.round((sliderIdx / sentences.length) * 100) : 0;

  return (
    <div
      className="fixed bottom-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm px-4 py-2.5 flex flex-col gap-1.5 animate-fade-in transition-[left] duration-200"
      style={{ left: sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH }}
    >
      {/* ── Sentence-level progress bar ──────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0 w-max-[100px] text-right">
          {t("tts.sentenceProgress", { current: sentences.length ? sliderIdx + 1 : 0, total: sentences.length })}
        </span>
        <div className="relative flex-1 h-5 flex items-center">
          <input
            type="range"
            min={0}
            max={maxIndex}
            value={sliderIdx}
            onInput={handleSliderInput}
            onMouseUp={commitSlider}
            onTouchEnd={commitSlider}
            onKeyUp={commitSlider}
            className="w-full h-1.5 appearance-none rounded-full cursor-pointer
              bg-muted
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
              [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:opacity-0
              [&::-webkit-slider-thumb]:transition-opacity [&::-webkit-slider-thumb]:shadow-sm
              hover:[&::-webkit-slider-thumb]:opacity-100
              [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer
              [&::-moz-range-thumb]:opacity-0 hover:[&::-moz-range-thumb]:opacity-100
              [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full"
            style={{
              background: sentences.length > 0
                ? `linear-gradient(to right, hsl(var(--primary)) ${progressPercent}%, hsl(var(--muted)) ${progressPercent}%)`
                : undefined,
            }}
          />
        </div>
      </div>

      {/* ── Controls row ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={prev}
          disabled={currentIndex <= 0}
          className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors shrink-0"
          title={t("tts.prev")}
        >
          <SkipPrevIcon className="w-4 h-4" />
        </button>

        {/* Always a <button> — icon/spinner swap inside, never unmounts the element.
            This eliminates the DOM swap flash during sentence transitions. */}
        <button
          onClick={isError ? retry : toggle}
          disabled={isLoading}
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            isError
              ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
          title={isError ? t("tts.retry") : isPlaying ? t("tts.pause") : t("tts.play")}
        >
          {isLoading ? (
            <div className="w-4 h-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
          ) : isError ? (
            <RefreshIcon className="w-4 h-4" />
          ) : isPlaying ? (
            <PauseIcon className="w-4 h-4" />
          ) : (
            <PlayIcon className="w-4 h-4" />
          )}
        </button>

        <button
          onClick={next}
          disabled={currentIndex >= sentences.length - 1}
          className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors shrink-0"
          title={t("tts.next")}
        >
          <SkipNextIcon className="w-4 h-4" />
        </button>

        <button
          onClick={goToOrigin}
          title={t("tts.backToSource")}
          className="flex-1 min-w-0 truncate text-xs text-muted-foreground px-2 flex items-center gap-1.5 hover:text-foreground transition-colors text-left"
        >
          {isLoading && <span className="shrink-0 text-primary/70 animate-pulse">{t("tts.synthesizing")}</span>}
          <span className="truncate">{sentences[currentIndex]?.text ?? ""}</span>
        </button>

        <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg shrink-0">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                speed === s ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <button
          onClick={stop}
          className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title={t("tts.close")}
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
