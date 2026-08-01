/**
 * Podcast/audio player — mobile replacement for the desktop podcastPlayerStore
 * (app/src/store/podcastPlayerStore.ts), which drove a module-level <audio>
 * element. Same single-track semantics, backed by a module-level expo-audio
 * `AudioPlayer` singleton (createAudioPlayer, SDK 57).
 *
 * Setup, per https://docs.expo.dev/versions/v57.0.0/sdk/audio/#playing-audio-in-the-background:
 *  - audio session: playsInSilentMode + shouldPlayInBackground + doNotMix
 *    (doNotMix is required for lock-screen controls to be associated).
 *  - setActiveForLockScreen(true, metadata, {showSeekBackward/Forward})
 *    registers play/pause and ±15-seek controls; removed again on stop().
 * The store is app-global: the MiniPlayer reads it wherever it's mounted.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";
import { create } from "zustand";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface PlayerTrackMeta {
  /** Direct audio URL (podcast enclosure). */
  url: string;
  title: string;
  feedTitle: string;
}

interface PlayerState {
  status: PlayerStatus;
  track: PlayerTrackMeta | null;
  /** Seconds, mirrored from the AudioPlayer's playbackStatusUpdate events. */
  position: number;
  duration: number;
  error: string | null;
  play: (track: PlayerTrackMeta) => Promise<void>;
  toggle: () => void;
  /** Skip by ±seconds, clamped to [0, duration]. */
  seekBy: (delta: number) => void;
  stop: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  status: "idle",
  track: null,
  position: 0,
  duration: 0,
  error: null,
  play: async (track) => {
    void startPlayback(track).catch((e) => {
      console.error("[player] start failed:", e);
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    });
  },
  toggle: () => {
    void togglePlayback();
  },
  seekBy: (delta) => {
    const { position, duration, track } = get();
    if (!track || !player) return;
    const target = Math.max(0, Math.min(position + delta, duration > 0 ? duration : position + delta));
    void player.seekTo(target).catch(() => {});
    set({ position: target });
  },
  stop: () => {
    stopPlayback();
    set({ status: "idle", track: null, position: 0, duration: 0, error: null });
  },
}));

/* ---------- native singleton ---------- */

let player: AudioPlayer | null = null;
type Subscription = { remove(): void };
let statusSub: Subscription | null = null;
/** Mirrors the desktop's "don't let TTS/audio session leak across tracks" intent. */
let activeUrl: string | null = null;

let audioModePromise: Promise<void> | null = null;
function ensureAudioMode(): Promise<void> {
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    })
      .then(() => undefined)
      .catch((e) => {
        audioModePromise = null; // retry next play
        throw e;
      });
  }
  return audioModePromise;
}

function disposePlayer() {
  try {
    statusSub?.remove();
  } catch {}
  statusSub = null;
  if (player) {
    try {
      player.removeAllListeners("playbackStatusUpdate");
    } catch {}
    try {
      player.clearLockScreenControls();
    } catch {}
    try {
      player.release();
    } catch {}
  }
  player = null;
  activeUrl = null;
}

function attachStatusListener(meta: PlayerTrackMeta) {
  statusSub = player!.addListener("playbackStatusUpdate", (status: AudioStatus) => {
    // A status event can arrive after stop() disposed the player — ignore it;
    // the store has already been reset.
    if (!player || activeUrl !== meta.url) return;
    if (status.didJustFinish) {
      stopPlayback();
      usePlayerStore.setState({ status: "idle", track: null, position: 0, duration: 0, error: null });
      return;
    }
    const nextStatus: PlayerStatus = status.playing
      ? "playing"
      : status.isBuffering || !status.isLoaded
        ? "loading"
        : "paused";
    usePlayerStore.setState({
      status: nextStatus,
      position: status.currentTime,
      duration: status.duration > 0 ? status.duration : usePlayerStore.getState().duration,
    });
  });
}

async function startPlayback(track: PlayerTrackMeta): Promise<void> {
  // Same track already loaded → just resume.
  if (player && activeUrl === track.url) {
    player.play();
    usePlayerStore.setState({ status: "playing", error: null });
    return;
  }
  disposePlayer();

  usePlayerStore.setState({ status: "loading", track, position: 0, duration: 0, error: null });

  await ensureAudioMode();

  player = createAudioPlayer({ uri: track.url }, { updateInterval: 500 });
  activeUrl = track.url;
  attachStatusListener(track);
  try {
    player.setActiveForLockScreen(
      true,
      { title: track.title, artist: track.feedTitle || undefined, albumTitle: track.feedTitle || undefined },
      { showSeekBackward: true, showSeekForward: true }
    );
  } catch {
    // Lock-screen controls are a nicety; playback must not depend on them.
  }
  player.play();
}

async function togglePlayback(): Promise<void> {
  const s = usePlayerStore.getState();
  if (!player || !s.track) return;
  try {
    if (s.status === "playing") {
      player.pause();
      usePlayerStore.setState({ status: "paused" });
    } else if (s.status === "error") {
      await startPlayback(s.track); // retry from scratch
    } else {
      player.play();
      usePlayerStore.setState({ status: "playing", error: null });
    }
  } catch (e) {
    console.error("[player] toggle failed:", e);
    usePlayerStore.setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

function stopPlayback(): void {
  disposePlayer();
}
