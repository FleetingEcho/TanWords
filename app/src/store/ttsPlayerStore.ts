import { create } from "zustand";
import { Sentence, splitSentences } from "@/lib/sentences";
import { useSettingsStore } from "@/store/settingsStore";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface TtsPlayerState {
  status: PlayerStatus;
  sourceKey: string | null;
  sentences: Sentence[];
  currentIndex: number;
  speed: number;
  error: string | null;
  /** Bumped by every action that should (re)start playback of the current
   * sentence from scratch — the mechanical hook keys its main effect off
   * this instead of `currentIndex` alone so `retry()` (same index) also
   * triggers a fresh attempt. */
  loadToken: number;

  start: (sourceKey: string, text: string) => void;
  toggle: () => void;
  jumpTo: (i: number) => void;
  next: () => void;
  prev: () => void;
  retry: () => void;
  setSpeed: (v: number) => void;
  stop: () => void;
  setStatus: (status: PlayerStatus, error?: string | null) => void;
}

export const useTtsPlayerStore = create<TtsPlayerState>((set, get) => ({
  status: "idle",
  sourceKey: null,
  sentences: [],
  currentIndex: 0,
  speed: useSettingsStore.getState().ttsSpeed || 1,
  error: null,
  loadToken: 0,

  start: (sourceKey, text) => {
    const sentences = splitSentences(text);
    set((s) => ({
      sourceKey,
      sentences,
      currentIndex: 0,
      status: sentences.length ? "loading" : "idle",
      error: null,
      loadToken: s.loadToken + 1,
    }));
  },

  toggle: () => {
    const { status } = get();
    if (status === "playing") set({ status: "paused" });
    else if (status === "paused") set({ status: "playing" });
    else if (status === "error") get().retry();
  },

  jumpTo: (i) => {
    const { sentences } = get();
    if (i < 0 || i >= sentences.length) return;
    set((s) => ({ currentIndex: i, status: "loading", error: null, loadToken: s.loadToken + 1 }));
  },

  next: () => {
    const { currentIndex, sentences } = get();
    if (currentIndex + 1 >= sentences.length) {
      get().stop();
      return;
    }
    set((s) => ({ currentIndex: currentIndex + 1, status: "loading", error: null, loadToken: s.loadToken + 1 }));
  },

  prev: () => {
    const { currentIndex } = get();
    if (currentIndex <= 0) return;
    set((s) => ({ currentIndex: currentIndex - 1, status: "loading", error: null, loadToken: s.loadToken + 1 }));
  },

  retry: () => {
    set((s) => ({ status: "loading", error: null, loadToken: s.loadToken + 1 }));
  },

  setSpeed: (v) => {
    set({ speed: v });
    useSettingsStore.getState().setTtsSpeed(v);
  },

  stop: () => set({ status: "idle", sourceKey: null, sentences: [], currentIndex: 0, error: null }),

  setStatus: (status, error = null) => set({ status, error }),
}));
