import { create } from "zustand";
import { claimAudioChannel, releaseAudioChannel } from "@/lib/audioChannel";
import { toPlayableSrc } from "@/lib/localAudioSrc";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { PlayMode, nextIndexOnEnded, nextIndexOnSkip } from "@/features/music/queue";

export type PodcastStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface PodcastTrack {
  /** Direct enclosure URL (mp3/m4a) — playable as-is in an <audio> element. */
  audioUrl: string;
  title: string;
  feedTitle: string;
}

interface PodcastPlayerState {
  status: PodcastStatus;
  track: PodcastTrack | null;
  /** Seconds, mirrored from the <audio> element. */
  position: number;
  duration: number;
  speed: number;
  /** Non-null while playing a music-library queue; single podcast episodes
   * play with no playlist and keep the original close-on-ended behavior. */
  playlist: PodcastTrack[] | null;
  playlistIndex: number;
  playMode: PlayMode;

  play: (track: PodcastTrack) => void;
  playQueue: (tracks: PodcastTrack[], startIndex: number, mode?: PlayMode) => void;
  skip: (direction: 1 | -1) => void;
  setPlayMode: (mode: PlayMode) => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (delta: number) => void;
  setSpeed: (v: number) => void;
  stop: () => void;
}

/** Unlike the sentence-based TTS player, podcast playback is one long file, so
 * the store owns a module-level <audio> element directly: actions drive it and
 * its events write back into the store. No React effect choreography needed. */
let audio: HTMLAudioElement | null = null;

const pauseAudio = () => audio?.pause();

// Only one track plays at a time, so a single slot (revoked on replace/stop)
// is enough here — unlike the duration-probing in MusicPage.tsx, which
// resolves several tracks concurrently and owns its blob URLs individually.
let currentBlobUrl: string | null = null;

async function resolvePlayableSrc(url: string): Promise<string> {
  const src = await toPlayableSrc(url);
  if (src !== url) {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = src;
  }
  return src;
}

function getAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";

  audio.addEventListener("play", () => {
    claimAudioChannel(pauseAudio);
    usePodcastPlayerStore.setState({ status: "playing" });
  });
  audio.addEventListener("pause", () => {
    usePodcastPlayerStore.setState((s) => (s.status === "idle" ? s : { ...s, status: "paused" }));
  });
  audio.addEventListener("waiting", () => {
    usePodcastPlayerStore.setState((s) => (s.status === "playing" ? { ...s, status: "loading" } : s));
  });
  audio.addEventListener("playing", () => {
    usePodcastPlayerStore.setState({ status: "playing" });
  });
  // Some WebViews (e.g. WebKitGTK on Linux) don't reliably re-fire "playing"
  // after a seek-triggered "waiting" stall — only "seeked"/"canplay". Use them
  // as a fallback so the spinner doesn't get stuck forever after dragging the seek bar.
  const clearStallIfPlaying = () => {
    if (!audio!.paused) {
      usePodcastPlayerStore.setState((s) => (s.status === "loading" ? { ...s, status: "playing" } : s));
    }
  };
  audio.addEventListener("seeked", clearStallIfPlaying);
  audio.addEventListener("canplay", clearStallIfPlaying);
  audio.addEventListener("timeupdate", () => {
    usePodcastPlayerStore.setState({ position: audio!.currentTime });
  });
  audio.addEventListener("durationchange", () => {
    if (isFinite(audio!.duration)) usePodcastPlayerStore.setState({ duration: audio!.duration });
  });
  audio.addEventListener("ended", () => {
    const s = usePodcastPlayerStore.getState();
    if (s.playlist) {
      const next = nextIndexOnEnded(s.playlistIndex, s.playlist.length, s.playMode);
      if (next !== null) {
        playAt(next);
        return;
      }
    }
    // Episode (or queue) finished — close the bar rather than leaving a
    // stalled "paused at the end" state.
    s.stop();
  });
  audio.addEventListener("error", () => {
    console.error("[podcastPlayer] audio error", {
      code: audio!.error?.code,
      message: audio!.error?.message,
      src: audio!.src,
      networkState: audio!.networkState,
    });
    if (usePodcastPlayerStore.getState().status !== "idle") {
      usePodcastPlayerStore.setState({ status: "error" });
    }
  });
  return audio;
}

/** Loads and plays playlist[index]. Always resets src — unlike play(), which
 * treats a same-URL call as resume, a queue jump to the same track (loop-one)
 * must restart from the top. */
async function playAt(index: number) {
  const el = getAudio();
  const s = usePodcastPlayerStore.getState();
  const track = s.playlist?.[index];
  if (!track) return;
  usePodcastPlayerStore.setState({ track, playlistIndex: index, status: "loading", position: 0, duration: 0 });
  try {
    const src = await resolvePlayableSrc(track.audioUrl);
    // A newer playAt/play/stop may have run while we were fetching; bail so
    // we don't stomp a since-changed track with this stale load.
    if (usePodcastPlayerStore.getState().track !== track) return;
    el.src = src;
    el.currentTime = 0;
    el.playbackRate = s.speed;
    await el.play();
  } catch (e) {
    console.error("[podcastPlayer] play() rejected", e);
    usePodcastPlayerStore.setState({ status: "error" });
  }
}

export const usePodcastPlayerStore = create<PodcastPlayerState>((set, get) => ({
  status: "idle",
  track: null,
  position: 0,
  duration: 0,
  speed: 1,
  playlist: null,
  playlistIndex: 0,
  playMode: "order",

  play: (track) => {
    const el = getAudio();
    // The TTS player and podcast player share the bottom bar slot — starting
    // one fully stops the other (audioChannel alone would only pause it).
    useTtsPlayerStore.getState().stop();
    claimAudioChannel(pauseAudio);

    const { track: current } = get();
    if (current?.audioUrl === track.audioUrl) {
      el.play().catch((e) => { console.error("[podcastPlayer] play() rejected", e); set({ status: "error" }); });
      return;
    }

    set({ track, playlist: null, playlistIndex: 0, status: "loading", position: 0, duration: 0 });
    resolvePlayableSrc(track.audioUrl)
      .then((src) => {
        if (get().track !== track) return; // superseded while fetching
        el.src = src;
        el.playbackRate = get().speed;
        return el.play();
      })
      .catch((e) => {
        console.error("[podcastPlayer] play() rejected", e);
        set({ status: "error" });
      });
  },

  playQueue: (tracks, startIndex, mode) => {
    if (tracks.length === 0) return;
    useTtsPlayerStore.getState().stop();
    claimAudioChannel(pauseAudio);
    set({ playlist: tracks, playMode: mode ?? get().playMode });
    playAt(Math.min(Math.max(0, startIndex), tracks.length - 1));
  },

  skip: (direction) => {
    const { playlist, playlistIndex, playMode } = get();
    if (!playlist) return;
    const next = nextIndexOnSkip(playlistIndex, playlist.length, playMode, direction);
    if (next !== null) playAt(next);
  },

  setPlayMode: (mode) => set({ playMode: mode }),

  toggle: () => {
    const el = getAudio();
    const { status } = get();
    if (status === "playing" || status === "loading") el.pause();
    else if (status === "paused") {
      claimAudioChannel(pauseAudio);
      el.play().catch((e) => { console.error("[podcastPlayer] play() rejected", e); set({ status: "error" }); });
    } else if (status === "error") {
      const { track } = get();
      if (track) {
        set({ track: null });
        get().play(track);
      }
    }
  },

  seekTo: (seconds) => {
    const el = getAudio();
    const { duration } = get();
    el.currentTime = Math.min(Math.max(0, seconds), duration || seconds);
    set({ position: el.currentTime });
  },

  seekBy: (delta) => get().seekTo(getAudio().currentTime + delta),

  setSpeed: (v) => {
    getAudio().playbackRate = v;
    set({ speed: v });
  },

  stop: () => {
    const el = getAudio();
    el.pause();
    el.removeAttribute("src");
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    releaseAudioChannel(pauseAudio);
    set({ status: "idle", track: null, playlist: null, playlistIndex: 0, position: 0, duration: 0 });
  },
}));
