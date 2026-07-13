import React from "react";
import { useT } from "@/hooks/useT";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useLayoutStore, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from "@/store/layoutStore";
import { PlayIcon, PauseIcon, CloseIcon, RefreshIcon } from "@/components/ui/icons";

const SPEEDS = [0.75, 1, 1.25, 1.5];

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Bottom bar for podcast episode playback. Mount exactly once (in App.tsx).
 * Yields the bar slot to the TTS PlayerBar whenever TTS is active — by then
 * the audioChannel has already paused the episode, so hiding is safe. */
export function PodcastPlayerBar() {
  const t = useT();
  const status = usePodcastPlayerStore((s) => s.status);
  const track = usePodcastPlayerStore((s) => s.track);
  const position = usePodcastPlayerStore((s) => s.position);
  const duration = usePodcastPlayerStore((s) => s.duration);
  const speed = usePodcastPlayerStore((s) => s.speed);
  const toggle = usePodcastPlayerStore((s) => s.toggle);
  const seekTo = usePodcastPlayerStore((s) => s.seekTo);
  const seekBy = usePodcastPlayerStore((s) => s.seekBy);
  const setSpeed = usePodcastPlayerStore((s) => s.setSpeed);
  const stop = usePodcastPlayerStore((s) => s.stop);
  const ttsActive = useTtsPlayerStore((s) => s.status !== "idle");
  const goToOrigin = usePlayerOriginStore((s) => s.goToOrigin);
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);

  if (status === "idle" || !track || ttsActive) return null;

  const isPlaying = status === "playing";
  const isError = status === "error";
  const isLoading = status === "loading";

  return (
    <div
      className="fixed bottom-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm px-4 py-2.5 flex items-center gap-3 animate-fade-in transition-[left] duration-200"
      style={{ left: sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH }}
    >
      <button
        onClick={() => seekBy(-15)}
        className="h-8 px-2 rounded-md flex items-center justify-center text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title={t("podcast.back15")}
      >
        -15s
      </button>

      {isError ? (
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors shrink-0"
          title={t("podcast.retry")}
        >
          <RefreshIcon className="w-4 h-4" />
        </button>
      ) : isLoading ? (
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center bg-primary/10 shrink-0"
          title={t("podcast.loading")}
        >
          <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      ) : (
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          title={isPlaying ? t("podcast.pause") : t("podcast.play")}
        >
          {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
        </button>
      )}

      <button
        onClick={() => seekBy(15)}
        className="h-8 px-2 rounded-md flex items-center justify-center text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title={t("podcast.forward15")}
      >
        +15s
      </button>

      <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
        {formatTime(position)} / {formatTime(duration)}
      </span>

      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={1}
        value={Math.min(position, duration || position)}
        onChange={(e) => seekTo(Number(e.target.value))}
        disabled={!duration}
        aria-label={t("podcast.seek")}
        className="flex-1 min-w-0 h-1.5 cursor-pointer disabled:cursor-default"
        style={{ accentColor: "hsl(var(--primary))" }}
      />

      <button
        onClick={goToOrigin}
        title={t("tts.backToSource")}
        className="w-56 min-w-0 hidden md:flex flex-col shrink-0 text-left hover:opacity-80 transition-opacity"
      >
        <span className="truncate text-xs font-medium text-foreground">{track.title}</span>
        <span className="truncate text-[10px] text-muted-foreground">
          {isError ? t("podcast.error") : track.feedTitle}
        </span>
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
        title={t("podcast.close")}
      >
        <CloseIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
