import { create } from "zustand";
import { claimAudioChannel, releaseAudioChannel } from "@/lib/audioChannel";
import { toPlayableSrc } from "@/lib/localAudioSrc";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { PlayMode, nextIndexOnEnded, nextIndexOnSkip } from "@/features/music/queue";
import { invoke } from "@/ipc/backend";

export type PodcastStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface PodcastTrack {
  /** Direct enclosure URL (mp3/m4a) — playable as-is in an <audio> element. */
  audioUrl: string;
  title: string;
  feedTitle: string;
  /** Raw filesystem path selects the native local-music adapter. Remote
   * podcasts omit it and continue through HTMLAudioElement. */
  localPath?: string;
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

const pauseAudio = () => {
  if (usePodcastPlayerStore.getState().track?.localPath) void invoke("native_audio_pause").catch(() => {});
  else audio?.pause();
};

// Only one track plays at a time, so a single slot (revoked on replace/stop)
// is enough here — unlike the duration-probing in MusicPage.tsx, which
// resolves several tracks concurrently and owns its blob URLs individually.
let currentBlobUrl: string | null = null;
let nativePoll: number | null = null;
/** True while forcing duration resolution (see the "loadedmetadata" listener
 * below) — suppresses position updates during the probe seek so the seek bar
 * doesn't visibly jump to the end for a frame. */
let resolvingDuration = false;

interface NativeAudioSnapshot {
  status: "idle" | "playing" | "paused" | "ended" | "error";
  positionSec: number;
  durationSec: number;
  speed: number;
  error: string | null;
  generation: number;
}

function stopNativePoll() {
  if (nativePoll !== null) window.clearInterval(nativePoll);
  nativePoll = null;
}

function startNativePoll(track: PodcastTrack) {
  stopNativePoll();
  nativePoll = window.setInterval(async () => {
    if (usePodcastPlayerStore.getState().track !== track) return;
    try {
      const native = await invoke<NativeAudioSnapshot>("native_audio_snapshot");
      if (usePodcastPlayerStore.getState().track !== track) return;
      if (native.status === "ended") {
        stopNativePoll();
        const state = usePodcastPlayerStore.getState();
        if (state.playlist) {
          const next = nextIndexOnEnded(state.playlistIndex, state.playlist.length, state.playMode);
          if (next !== null) { playAt(next); return; }
        }
        state.stop();
        return;
      }
      const status: PodcastStatus = native.status === "playing"
        ? "playing"
        : native.status === "error"
          ? "error"
          : "paused";
      usePodcastPlayerStore.setState({
        status,
        position: native.positionSec,
        duration: native.durationSec,
        speed: native.speed,
      });
    } catch (error) {
      console.error("[nativeAudio] snapshot failed", error);
      usePodcastPlayerStore.setState({ status: "error" });
    }
  }, 250);
}

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

// Tauri doesn't guarantee that concurrent command invocations settle in the order they
// were issued — open_decoder() alone (real file I/O) can take longer for one track than
// another. Firing native_audio_load for a new track while a previous call for a
// *different* track is still in flight let the stale call's Rust-side session-replace
// "win" after a newer one had already taken over: the store (and the bar) showed the new
// track's title while the old track kept playing underneath it — the exact "song and
// name don't match" bug. Serializing every playAt() through this chain, and skipping a
// call outright if a newer one was queued behind it before its turn came up, guarantees
// only one load is ever in flight and only the most recent request actually executes.
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

/** Loads and plays playlist[index]. Always resets src — unlike play(), which
 * treats a same-URL call as resume, a queue jump to the same track (loop-one)
 * must restart from the top. */
async function playAtInner(index: number) {
  const el = getAudio();
  const s = usePodcastPlayerStore.getState();
  const track = s.playlist?.[index];
  if (!track) return;
  if (track.localPath) {
    stopNativePoll();
    el.pause();
    el.removeAttribute("src");
    usePodcastPlayerStore.setState({ track, playlistIndex: index, status: "loading", position: 0, duration: 0 });
    try {
      const loaded = await invoke<NativeAudioSnapshot>("native_audio_load", { path: track.localPath, autoplay: true });
      if (usePodcastPlayerStore.getState().track !== track) {
        // Superseded while the decoder was loading — but native_audio_load
        // ran with autoplay: true, so Rust has ALREADY started this track.
        // Stop it here or it keeps playing underneath the newer track.
        void invoke("native_audio_stop").catch(() => {});
        return;
      }
      await invoke("native_audio_set_speed", { speed: s.speed });
      usePodcastPlayerStore.setState({ status: "playing", duration: loaded.durationSec, position: 0 });
      startNativePoll(track);
    } catch (error) {
      console.error("[nativeAudio] load failed", error);
      usePodcastPlayerStore.setState({ status: "error" });
    }
    return;
  }
  void invoke("native_audio_stop").catch(() => {});
  stopNativePoll();
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
    if (!track.localPath) {
      stopNativePoll();
      void invoke("native_audio_stop").catch(() => {});
    }
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
    const { status, track } = get();
    if (track?.localPath) {
      const command = status === "playing" || status === "loading" ? "native_audio_pause" : "native_audio_play";
      invoke(command).catch((error) => { console.error("[nativeAudio] toggle failed", error); set({ status: "error" }); });
      return;
    }
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
    const { duration, track } = get();
    if (track?.localPath) {
      invoke("native_audio_seek", { seconds: Math.min(Math.max(0, seconds), duration || seconds) })
        .catch((error) => { console.error("[nativeAudio] seek failed", error); set({ status: "error" }); });
      return;
    }
    el.currentTime = Math.min(Math.max(0, seconds), duration || seconds);
    set({ position: el.currentTime });
  },

  seekBy: (delta) => get().seekTo((get().track?.localPath ? get().position : getAudio().currentTime) + delta),

  setSpeed: (v) => {
    if (get().track?.localPath) invoke("native_audio_set_speed", { speed: v }).catch(() => {});
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
    stopNativePoll();
    void invoke("native_audio_stop").catch(() => {});
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    releaseAudioChannel(pauseAudio);
    set({ status: "idle", track: null, playlist: null, playlistIndex: 0, position: 0, duration: 0 });
  },
}));
