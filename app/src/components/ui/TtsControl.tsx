import React, { useState } from "react";
import { Pause, Play, RotateCw, SkipBack, SkipForward, Square, Volume2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useArticlePlayer } from "@/hooks/useArticlePlayer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const SPEEDS = [0.75, 1, 1.25, 1.5];

/** The one place any speech synthesis in the app surfaces: the reader's
 *  article playback and the selection toolbar's speak button both drive
 *  `ttsPlayerStore`, so both show up here and both can be paused, skipped or
 *  cancelled from here.
 *
 *  Deliberately unrelated to the podcast/music player, which owns real audio
 *  files and keeps its own bar — the two only ever interact through
 *  `audioChannel`, which stops one when the other starts.
 *
 *  Also the mount point for `useArticlePlayer`, the hook that does the actual
 *  synthesis and playback. It has to live somewhere always-rendered, which is
 *  why this component renders as `null` when idle rather than being mounted
 *  conditionally by its parent. */
export function TtsControl() {
  useArticlePlayer();

  const t = useT();
  const [open, setOpen] = useState(false);
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
  const origin = usePlayerOriginStore((s) => s.origin);
  const goToOrigin = usePlayerOriginStore((s) => s.goToOrigin);

  if (status === "idle") return null;

  const isPlaying = status === "playing";
  const isLoading = status === "loading";
  const isError = status === "error";
  // A single sentence — a tapped word, or one line from the selection toolbar —
  // has nowhere to skip to, so the transport collapses to stop/pause.
  const multi = sentences.length > 1;
  const current = sentences[currentIndex]?.text ?? "";

  const stopAll = () => {
    stop();
    setOpen(false);
  };

  return (
    <>
      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            title={isError ? t("tts.playbackError") : current || t("tts.speaking")}
            aria-label={t("tts.speaking")}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
              isError ? "text-destructive hover:bg-destructive/10" : "text-primary hover:bg-primary/10"
            }`}
          >
            {isLoading ? (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
            ) : (
              <Volume2 className={`h-4 w-4 shrink-0 ${isPlaying ? "animate-pulse" : ""}`} />
            )}
            {multi && (
              <span className="hidden font-mono tabular-nums sm:inline">
                {currentIndex + 1}/{sentences.length}
              </span>
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-72 p-2">
          <p className="px-1.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("tts.speaking")}
          </p>

          {/* What is being read right now — without it the transport controls
            * have no subject, which matters when this was started from a
            * selection on a page you have since navigated away from. */}
          <p className="line-clamp-3 px-1.5 pb-2 text-xs leading-relaxed text-foreground">
            {isError ? t("tts.playbackError") : current}
          </p>

          <div className="flex items-center gap-1 border-t border-border pt-2">
            {multi && (
              <Button
                variant="ghost" size="icon" onClick={prev} disabled={currentIndex <= 0}
                title={t("tts.prev")} aria-label={t("tts.prev")}
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <SkipBack className="h-3.5 w-3.5" />
              </Button>
            )}

            <Button
              variant="ghost" size="icon" onClick={isError ? retry : toggle}
              title={isError ? t("tts.retry") : isPlaying ? t("tts.pause") : t("tts.play")}
              aria-label={isError ? t("tts.retry") : isPlaying ? t("tts.pause") : t("tts.play")}
              className="h-7 w-7 rounded-md text-foreground"
            >
              {isError ? <RotateCw className="h-3.5 w-3.5" /> : isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>

            {multi && (
              <Button
                variant="ghost" size="icon" onClick={next}
                title={t("tts.next")} aria-label={t("tts.next")}
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </Button>
            )}

            <Button
              variant="ghost" size="icon" onClick={stopAll}
              title={t("tts.stop")} aria-label={t("tts.stop")}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-destructive"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>

            <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
              {SPEEDS.map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  onClick={() => setSpeed(s)}
                  className={`h-auto rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-transparent ${
                    speed === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}x
                </Button>
              ))}
            </div>
          </div>

          {origin && (
            <Button
              variant="ghost"
              onClick={() => { goToOrigin(); setOpen(false); }}
              className="mt-1 h-7 w-full justify-start rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">{t("tts.backToSource")}</span>
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
