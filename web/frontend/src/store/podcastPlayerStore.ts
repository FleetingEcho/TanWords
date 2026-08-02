import { create } from "zustand";
import { PlayMode, nextIndexOnEnded, nextIndexOnSkip } from "@/lib/playQueue";

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
  /** Non-null while playing a queue; single podcast episodes play with no
   * playlist and keep the original close-on-ended behavior. */
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

/** Podcast playback is one long file, so the store owns a module-level
 * <audio> element directly: actions drive it and its events write back into
 * the store. No React effect choreography needed.
 *
 * Web scope: remote enclosure URLs only, always through this element. The
 * desktop's local-file adapter (native_audio commands), the TTS channel
 * coordination, and the asset:// pass-through are all gone with the music
 * page and the TTS player. */
let audio: HTMLAudioElement | null = null;

/** True while forcing duration resolution (see the "loadedmetadata" listener
 * below) — suppresses position updates during the probe seek so the seek bar
 * doesn't visibly jump to the end for a frame. */
let resolvingDuration = false;

function getAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";

  audio.addEventListener("play", () => {
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
  // Some browsers don't reliably re-fire "playing" after a seek-triggered
  // "waiting" stall — only "seeked"/"canplay". Use them as a fallback so the
  // spinner doesn't get stuck forever after dragging the seek bar.
  const clearStallIfPlaying = () => {
    if (!audio!.paused) {
      usePodcastPlayerStore.setState((s) => (s.status === "loading" ? { ...s, status: "playing" } : s));
    }
  };
  audio.addEventListener("seeked", clearStallIfPlaying);
  audio.addEventListener("canplay", clearStallIfPlaying);
  audio.addEventListener("timeupdate", () => {
    if (resolvingDuration) return;
    usePodcastPlayerStore.setState({ position: audio!.currentTime });
  });
  audio.addEventListener("durationchange", () => {
    if (isFinite(audio!.duration)) usePodcastPlayerStore.setState({ duration: audio!.duration });
  });
  audio.addEventListener("loadedmetadata", () => {
    const el = audio!;
    if (isFinite(el.duration)) return;
    // Some remote podcast enclosures (chunked transfer, no Content-Length) report
    // duration as Infinity until playback reaches the end — durationchange never
    // fires with a real number, so the bar is stuck at 0:00 for the whole episode
    // even though playback and position both work fine. Seeking far past the end
    // forces the browser to resolve the true duration immediately (which then
    // fires "durationchange" for real); snap back to where playback actually was
    // once that settles.
    const resumeAt = el.currentTime;
    resolvingDuration = true;
    const onSeeked = () => {
      el.removeEventListener("seeked", onSeeked);
      el.currentTime = resumeAt;
      resolvingDuration = false;
    };
    el.addEventListener("seeked", onSeeked);
    el.currentTime = 1e101;
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

// Serializes every queue jump so only one load is ever in flight and only the
// most recent request actually executes — a stale async load must not override
// a newer user click (the "song and name don't match" bug this replaced).
let loadChain: Promise<void> = Promise.resolve();
let loadRequestSeq = 0;

async function playAt(index: number) {
  const mySeq = ++loadRequestSeq;
  const previous = loadChain;
  let resolveGate!: () => void;
  loadChain = new Promise((resolve) => { resolveGate = resolve; });
  await previous;
  try {
    if (mySeq !== loadRequestSeq) return;
    await playAtInner(index);
  } finally {
    resolveGate();
  }
}

/** Loads and plays playlist[index]. Always resets currentTime — unlike play(),
 * which treats a same-URL call as resume, a queue jump to the same track
 * (loop-one) must restart from the top. */
async function playAtInner(index: number) {
  const el = getAudio();
  const s = usePodcastPlayerStore.getState();
  const track = s.playlist?.[index];
  if (!track) return;
  usePodcastPlayerStore.setState({ track, playlistIndex: index, status: "loading", position: 0, duration: 0 });
  try {
    el.src = track.audioUrl;
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
    const { track: current, status: currentStatus } = get();
    if (current?.audioUrl === track.audioUrl) {
      // Same episode tapped again — resume.
      if (currentStatus !== "playing") {
        el.play().catch((e) => { console.error("[podcastPlayer] play() rejected", e); set({ status: "error" }); });
      }
      return;
    }

    set({ track, playlist: null, playlistIndex: 0, status: "loading", position: 0, duration: 0 });
    try {
      el.src = track.audioUrl;
      el.playbackRate = get().speed;
      void el.play().catch((e) => {
        if (get().track !== track) return; // superseded while loading
        console.error("[podcastPlayer] play() rejected", e);
        set({ status: "error" });
      });
    } catch (e) {
      console.error("[podcastPlayer] play() rejected", e);
      set({ status: "error" });
    }
  },

  playQueue: (tracks, startIndex, mode) => {
    if (tracks.length === 0) return;
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
    // Same invalidation as play(): a queued playAt() must not surface after
    // the user has stopped the player.
    loadRequestSeq++;
    el.pause();
    el.removeAttribute("src");
    set({ status: "idle", track: null, playlist: null, playlistIndex: 0, position: 0, duration: 0 });
  },
}));
