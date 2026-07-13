import { create } from "zustand";
import { claimAudioChannel, releaseAudioChannel } from "@/lib/audioChannel";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";

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

  play: (track: PodcastTrack) => void;
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
    // Episode finished — close the bar rather than leaving a stalled "paused at the end" state.
    usePodcastPlayerStore.getState().stop();
  });
  audio.addEventListener("error", () => {
    if (usePodcastPlayerStore.getState().status !== "idle") {
      usePodcastPlayerStore.setState({ status: "error" });
    }
  });
  return audio;
}

export const usePodcastPlayerStore = create<PodcastPlayerState>((set, get) => ({
  status: "idle",
  track: null,
  position: 0,
  duration: 0,
  speed: 1,

  play: (track) => {
    const el = getAudio();
    // The TTS player and podcast player share the bottom bar slot — starting
    // one fully stops the other (audioChannel alone would only pause it).
    useTtsPlayerStore.getState().stop();
    claimAudioChannel(pauseAudio);

    const { track: current } = get();
    if (current?.audioUrl === track.audioUrl) {
      el.play().catch(() => set({ status: "error" }));
      return;
    }

    set({ track, status: "loading", position: 0, duration: 0 });
    el.src = track.audioUrl;
    el.playbackRate = get().speed;
    el.play().catch(() => set({ status: "error" }));
  },

  toggle: () => {
    const el = getAudio();
    const { status } = get();
    if (status === "playing" || status === "loading") el.pause();
    else if (status === "paused") {
      claimAudioChannel(pauseAudio);
      el.play().catch(() => set({ status: "error" }));
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
    releaseAudioChannel(pauseAudio);
    set({ status: "idle", track: null, position: 0, duration: 0 });
  },
}));
