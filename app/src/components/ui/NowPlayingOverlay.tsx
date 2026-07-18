import React, { useEffect } from "react";
import { useT } from "@/hooks/useT";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { coverGradient } from "@/features/music/cover";
import { PLAY_MODES } from "@/features/music/queue";
import { MODE_ICONS } from "@/components/ui/playModeIcons";
import {
  PlayIcon, PauseIcon, RefreshIcon, SkipPrevIcon, SkipNextIcon, ChevronIcon, MusicIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { PlaybackSpeedSelector } from "@/components/ui/PlaybackSpeedSelector";
import { AudioSeekSlider } from "@/components/ui/AudioSeekSlider";

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Full-screen immersive "now playing" view, expanded from the bottom player
 * bar. Pure presentation over podcastPlayerStore — closing it never
 * interrupts playback. */
export function NowPlayingOverlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  const status = usePodcastPlayerStore((s) => s.status);
  const track = usePodcastPlayerStore((s) => s.track);
  const position = usePodcastPlayerStore((s) => s.position);
  const duration = usePodcastPlayerStore((s) => s.duration);
  const speed = usePodcastPlayerStore((s) => s.speed);
  const playMode = usePodcastPlayerStore((s) => s.playMode);
  const playlist = usePodcastPlayerStore((s) => s.playlist);
  const toggle = usePodcastPlayerStore((s) => s.toggle);
  const seekTo = usePodcastPlayerStore((s) => s.seekTo);
  const skip = usePodcastPlayerStore((s) => s.skip);
  const setSpeed = usePodcastPlayerStore((s) => s.setSpeed);
  const setPlayMode = usePodcastPlayerStore((s) => s.setPlayMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Playback ended (or errored out of existence) while expanded — nothing to show.
  useEffect(() => {
    if (status === "idle" || !track) onClose();
  }, [status, track, onClose]);

  if (status === "idle" || !track) return null;

  const cover = coverGradient(track.feedTitle || track.title);
  const isPlaying = status === "playing";
  const ModeIcon = MODE_ICONS[playMode];

  return (
    <div className="fixed inset-0 z-50 animate-fade-in overflow-hidden" style={{ backgroundImage: cover.css }}>
      {/* Darken toward the bottom so white text always reads */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/45 to-black/75" />

      <div className="relative h-full flex flex-col items-center px-8 py-6">
        <Button
          variant="ghost"
          onClick={onClose}
          title={t("music.collapsePlayer")}
          className="self-start w-9 h-9 p-0 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors -rotate-90"
        >
          <ChevronIcon direction="left" className="w-5 h-5" />
        </Button>

        {/* Disc — spins while playing, freezes on pause */}
        <div className="flex-1 min-h-0 flex items-center justify-center w-full">
          <div
            className="relative rounded-full shadow-2xl"
            style={{
              width: "min(46vh, 60vw, 26rem)",
              height: "min(46vh, 60vw, 26rem)",
              backgroundImage: cover.css,
              animation: "spin 24s linear infinite",
              animationPlayState: isPlaying ? "running" : "paused",
              boxShadow: "0 25px 80px -20px rgba(0,0,0,.7), inset 0 0 0 6px rgba(255,255,255,.12)",
            }}
          >
            {/* Grooves + label to sell the vinyl look */}
            <div className="absolute inset-[12%] rounded-full border border-white/10" />
            <div className="absolute inset-[24%] rounded-full border border-white/10" />
            <div className="absolute inset-[36%] rounded-full border border-white/10" />
            <div className="absolute inset-[42%] rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center">
              <MusicIcon className="w-8 h-8 text-white/70" />
            </div>
          </div>
        </div>

        <div className="w-full max-w-xl text-center mb-2">
          <h2 className="text-2xl font-bold text-white drop-shadow-sm truncate">{track.title}</h2>
          <p className="text-sm text-white/70 mt-1 truncate">{track.feedTitle}</p>
        </div>

        {/* Seek */}
        <div className="w-full max-w-xl flex items-center gap-3 mb-4">
          <span className="text-xs font-mono tabular-nums text-white/70 shrink-0">{formatTime(position)}</span>
          <div className="flex-1 min-w-0">
            <AudioSeekSlider
              position={position}
              duration={duration}
              onSeek={seekTo}
              ariaLabel={t("podcast.seek")}
              variant="glass"
            />
          </div>
          <span className="text-xs font-mono tabular-nums text-white/70 shrink-0">{formatTime(duration)}</span>
        </div>

        {/* Transport */}
        <div className="grid grid-cols-[2.5rem_2.75rem_4rem_2.75rem_2.5rem] items-center gap-5 mb-5">
          <Button
            variant="ghost"
            onClick={() => setPlayMode(PLAY_MODES[(PLAY_MODES.indexOf(playMode) + 1) % PLAY_MODES.length])}
            title={t(`music.mode.${playMode}`)}
            disabled={!playlist}
            className={`w-10 h-10 p-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 ${
              playMode === "order" ? "text-white/60 hover:text-white hover:bg-white/10" : "text-white bg-white/15 hover:bg-white/25"
            }`}
          >
            <ModeIcon className="w-5 h-5" />
          </Button>

          <Button
            variant="ghost"
            onClick={() => skip(-1)}
            disabled={!playlist}
            title={t("music.prev")}
            className="w-11 h-11 p-0 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
          >
            <SkipPrevIcon className="w-6 h-6" />
          </Button>

          {status === "error" ? (
            <Button
              variant="ghost"
              onClick={toggle}
              title={t("podcast.retry")}
              className="w-16 h-16 p-0 rounded-full flex items-center justify-center bg-white text-black hover:bg-white/90 transition-colors shadow-lg"
            >
              <RefreshIcon className="w-7 h-7" />
            </Button>
          ) : status === "loading" ? (
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-white/90 shadow-lg">
              <div className="w-6 h-6 rounded-full border-2 border-black/20 border-t-black animate-spin" />
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={toggle}
              title={isPlaying ? t("podcast.pause") : t("podcast.play")}
              className="w-16 h-16 p-0 rounded-full flex items-center justify-center bg-white text-black hover:bg-white/90 hover:scale-105 transition-all shadow-lg"
            >
              {isPlaying ? <PauseIcon className="w-7 h-7" /> : <PlayIcon className="w-7 h-7 ml-1" />}
            </Button>
          )}

          <Button
            variant="ghost"
            onClick={() => skip(1)}
            disabled={!playlist}
            title={t("music.next")}
            className="w-11 h-11 p-0 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
          >
            <SkipNextIcon className="w-6 h-6" />
          </Button>

          <PlaybackSpeedSelector value={speed} onChange={setSpeed} variant="glass" />
        </div>
      </div>
    </div>
  );
}
