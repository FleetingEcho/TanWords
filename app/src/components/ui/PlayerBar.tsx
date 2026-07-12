import React from "react";
import { useT } from "@/hooks/useT";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { useArticlePlayer } from "@/hooks/useArticlePlayer";
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

  if (status === "idle") return null;

  const isPlaying = status === "playing";
  const isError = status === "error";
  const isLoading = status === "loading";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm px-4 py-2.5 flex items-center gap-3 animate-fade-in">
      <button
        onClick={prev}
        disabled={currentIndex <= 0}
        className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors shrink-0"
        title={t("tts.prev")}
      >
        <SkipPrevIcon className="w-4 h-4" />
      </button>

      {isError ? (
        <button
          onClick={retry}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors shrink-0"
          title={t("tts.retry")}
        >
          <RefreshIcon className="w-4 h-4" />
        </button>
      ) : isLoading ? (
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center bg-primary/10 shrink-0"
          title={t("tts.synthesizing")}
        >
          <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      ) : (
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          title={isPlaying ? t("tts.pause") : t("tts.play")}
        >
          {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
        </button>
      )}

      <button
        onClick={next}
        disabled={currentIndex >= sentences.length - 1}
        className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors shrink-0"
        title={t("tts.next")}
      >
        <SkipNextIcon className="w-4 h-4" />
      </button>

      <span className="text-xs font-mono text-muted-foreground shrink-0">
        {t("tts.sentenceProgress", { current: sentences.length ? currentIndex + 1 : 0, total: sentences.length })}
      </span>

      <div className="flex-1 min-w-0 truncate text-xs text-muted-foreground px-2 flex items-center gap-1.5">
        {isLoading && <span className="shrink-0 text-primary/70 animate-pulse">{t("tts.synthesizing")}</span>}
        <span className="truncate">{sentences[currentIndex]?.text ?? ""}</span>
      </div>

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
  );
}
