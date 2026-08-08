import React, { useCallback, useState } from "react";
import { useT } from "@/hooks/useT";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useLayoutStore, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from "@/store/layoutStore";
import {
  PlayIcon, PauseIcon, CloseIcon, RefreshIcon, SkipPrevIcon, SkipNextIcon, ChevronIcon, MusicIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { PLAY_MODES } from "@/features/music/queue";
import { MODE_ICONS } from "@/components/ui/playModeIcons";
import { NowPlayingOverlay } from "@/components/ui/NowPlayingOverlay";
import { PlaybackSpeedSelector } from "@/components/ui/PlaybackSpeedSelector";
import { AudioSeekSlider } from "@/components/ui/AudioSeekSlider";
import { useIsNarrow, useMediaQuery } from "@/components/Vocabulary/hooks/useMediaQuery";

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Bottom bar for podcast episode playback. Mount exactly once (in App.tsx).
 * When sentence TTS starts, audioChannel pauses the episode; the bar stays
 * visible so the page doesn't suddenly lose its bottom edge. */
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
  const playlist = usePodcastPlayerStore((s) => s.playlist);
  const playMode = usePodcastPlayerStore((s) => s.playMode);
  const skip = usePodcastPlayerStore((s) => s.skip);
  const setPlayMode = usePodcastPlayerStore((s) => s.setPlayMode);
  const goToOrigin = usePlayerOriginStore((s) => s.goToOrigin);
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const narrow = useIsNarrow();
  // Below 1024px the sidebar is gone and the floating nav dock replaces it.
  const compact = useMediaQuery("(max-width: 1023px)");
  const [expanded, setExpanded] = useState(false);
  const closeOverlay = useCallback(() => setExpanded(false), []);
  const openOverlay = useCallback(() => setExpanded(true), []);

  if (status === "idle" || !track) return null;

  if (expanded) return <NowPlayingOverlay onClose={closeOverlay} />;

  const isPlaying = status === "playing";
  const isError = status === "error";
  const isLoading = status === "loading";

  return (
    <div
      // Compact widths have no sidebar to clear, so the bar spans the full
      // screen and sits on the bottom edge; the nav dock floats above it. Wide
      // widths dock it beside the sidebar instead — `left: SIDEBAR_WIDTH` at
      // compact width would hang 210px of the bar past the left edge.
      className={`fixed right-0 bottom-0 z-40 flex animate-fade-in cursor-pointer flex-col items-stretch gap-0.5 border-t border-border bg-card/95 px-2 pb-[calc(0.375rem+env(safe-area-inset-bottom))] pt-1 backdrop-blur-xs transition-[left] duration-200 lg:flex-row lg:items-center lg:px-4 lg:py-2.5 ${
        compact ? "left-0" : ""
      }`}
      style={compact ? undefined : { left: sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH }}
      onClick={(e) => {
        // Only blank bar area expands — buttons and the slider keep their own clicks.
        if (e.target === e.currentTarget) openOverlay();
      }}
      title={t("music.expandPlayer")}
    >
      {/* Perched on the bar's top edge, outside it, at every width: a handle
        * sitting proud of the bar reads as "pull this up" far better than one
        * more chevron among the controls. */}
      <Button
        variant="ghost"
        onClick={openOverlay}
        title={t("music.expandPlayer")}
        aria-label={t("music.expandPlayer")}
        // Sits flush on the bar's top edge as a protruding tab: -top-6 puts
        // its bottom exactly on the border, `border-b-0` keeps that shared
        // edge a single line instead of two.
        className="absolute -top-6 left-0 z-10 flex h-6 w-9 items-center justify-center rounded-t-md rounded-b-none border border-b-0 border-border bg-card p-0 text-muted-foreground shadow-sm hover:text-foreground"
      >
        <ChevronIcon direction="left" className="h-3.5 w-3.5 rotate-90" />
      </Button>

      {/* Its own row only where the single row can't hold it. Wide windows keep
        * everything inline — see the `lg:` slider further down. */}
      {narrow && (
      <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <AudioSeekSlider position={position} duration={duration} onSeek={seekTo} ariaLabel={t("podcast.seek")} />
          </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-1 lg:gap-3">
      {playlist && (
        <Button
          variant="ghost"
          onClick={() => skip(-1)}
          className="w-8 h-8 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title={t("music.prev")}
        >
          <SkipPrevIcon className="w-4 h-4" />
        </Button>
      )}

      <Button
        variant="ghost"
        onClick={() => seekBy(-15)}
        className="hidden lg:flex h-8 px-2 rounded-md items-center justify-center text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title={t("podcast.back15")}
      >
        -15s
      </Button>

      {isError ? (
        <Button
          variant="ghost"
          onClick={toggle}
          className="w-9 h-9 p-0 rounded-full flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors shrink-0"
          title={t("podcast.retry")}
        >
          <RefreshIcon className="w-4 h-4" />
        </Button>
      ) : isLoading ? (
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center bg-primary/10 shrink-0"
          title={t("podcast.loading")}
        >
          <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={toggle}
          className="group w-9 h-9 p-0 rounded-full flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          title={isPlaying ? t("podcast.pause") : t("podcast.play")}
        >
          {isPlaying ? (
            <>
              {/* A static pause icon is a little dull for "this is actively playing" — spin a
                * music note instead, swapping to the actual pause icon on hover so the click
                * target stays obvious. */}
              <MusicIcon className="w-4 h-4 animate-[spin_12s_linear_infinite] group-hover:hidden" />
              <PauseIcon className="w-4 h-4 hidden group-hover:block" />
            </>
          ) : (
            <PlayIcon className="w-4 h-4" />
          )}
        </Button>
      )}

      <Button
        variant="ghost"
        onClick={() => seekBy(15)}
        className="hidden lg:flex h-8 px-2 rounded-md items-center justify-center text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title={t("podcast.forward15")}
      >
        +15s
      </Button>

      {playlist && (
        <Button
          variant="ghost"
          onClick={() => skip(1)}
          className="w-8 h-8 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title={t("music.next")}
        >
          <SkipNextIcon className="w-4 h-4" />
        </Button>
      )}

      <span className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground lg:inline">
        {formatTime(position)} / {formatTime(duration)}
      </span>

      {/* `min-w`, not `min-w-0`: it is the only flexible item in the row, so
        * without a floor every added control ate into it until the slider was
        * a lone thumb sitting on top of the timestamp. Now the title (which
        * truncates) gives way first. */}
      <div className="hidden min-w-48 flex-1 lg:block">
        <AudioSeekSlider position={position} duration={duration} onSeek={seekTo} ariaLabel={t("podcast.seek")} />
      </div>

      <Button
        variant="ghost"
        // The chevron that opens the full player is desktop-only, so on a phone
        // the title itself is the way in — "back to source" stays a desktop
        // affordance rather than the one tap a phone user is most likely to make.
        onClick={narrow ? openOverlay : goToOrigin}
        title={narrow ? t("music.expandPlayer") : t("tts.backToSource")}
        className="h-auto min-w-0 flex flex-1 shrink flex-col items-start overflow-hidden text-left hover:opacity-80 hover:bg-transparent transition-opacity lg:max-w-56"
      >
        <span className="w-full truncate text-xs font-medium text-foreground">{track.title}</span>
        <span className="w-full truncate text-[10px] text-muted-foreground">
          {isError ? t("podcast.error") : track.feedTitle}
        </span>
      </Button>

      {playlist && (() => {
        const ModeIcon = MODE_ICONS[playMode];
        return (
          <Button
            variant="ghost"
            onClick={() => setPlayMode(PLAY_MODES[(PLAY_MODES.indexOf(playMode) + 1) % PLAY_MODES.length])}
            className={`hidden lg:flex w-8 h-8 p-0 rounded-md items-center justify-center hover:bg-muted transition-colors shrink-0 ${
              playMode === "order" ? "text-muted-foreground hover:text-foreground" : "text-primary"
            }`}
            title={t(`music.mode.${playMode}`)}
          >
            <ModeIcon className="w-4 h-4" />
          </Button>
        );
      })()}

      <span className="hidden lg:block">
        <PlaybackSpeedSelector value={speed} onChange={setSpeed} />
      </span>

      <Button
        variant="ghost"
        onClick={stop}
        className="w-8 h-8 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title={t("podcast.close")}
      >
        <CloseIcon className="w-4 h-4" />
      </Button>
      </div>
    </div>
  );
}
