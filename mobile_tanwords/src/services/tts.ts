/**
 * Text-to-speech — the mobile replacement for the desktop sherpa-onnx engine
 * (app/core/src/tts) and its playback orchestration (app/src/store/ttsPlayerStore.ts
 * + app/src/hooks/useArticlePlayer.ts). Uses OS voices via expo-speech instead of
 * an on-device model, so PLAN.md §6 substitutes the engine; the PUBLIC behavior
 * mirrors the desktop: sentence-by-sentence article playback with a current-sentence
 * callback, pause/resume, skip forward/back, seek, speed from settings.
 *
 * Implementation notes / platform choices:
 * - Playback = one `Speech.speak()` per sentence, chaining via `onDone`. A module-level
 *   generation counter is bumped by every stop/restart/speakWord so a late `onDone`
 *   from an interrupted chain can never resurrect a dead playback session.
 * - Pause/resume: `Speech.pause()`/`Speech.resume()` exist only on iOS + web (SDK 57
 *   docs — "not available on Android"). On Android we stop the utterance and re-speak
 *   the current sentence from its beginning on resume. That is the exact
 *   pause/resume fallback the task allows, and matches desktop UX closely enough
 *   because chunks are sentence-sized. `resume()` returns whether it resumed in place.
 * - `speakWord` shares the same queue as article playback and STOPS any article
 *   playback (documented desktop behavior is that the vocabulary speak button is a
 *   one-shot interruption; sharing the queue means a word never overlaps the article).
 */
import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { create } from "zustand";
import { splitSentences, type Sentence } from "@/lib/sentences";
import { useSettingsStore } from "@/store/settingsStore";

export type TtsPlayerStatus = "idle" | "playing" | "paused";

export interface SpeakTextOptions {
  rate?: number;
  language?: string;
  onDone?: () => void;
}

export interface StartPlaybackOptions {
  onSentence?: (s: Sentence, i: number) => void;
  onFinish?: () => void;
  onError?: (e: unknown) => void;
}

interface TtsPlayerState {
  status: TtsPlayerStatus;
  currentIndex: number;
  total: number;
  start: (articleText: string, opts?: StartPlaybackOptions) => void;
  pause: () => void;
  /** Resumes playback; resolves true when resuming in place (iOS/web), false when
   *  the current sentence was restarted from its beginning (Android fallback). */
  resume: () => Promise<boolean>;
  stop: () => void;
  next: () => void;
  previous: () => void;
  seekToSentence: (i: number) => void;
}

const DEFAULT_LANGUAGE = "en-US";

/* ---------- shared playback state (module level, one queue) ---------- */

/** Bumped by stop()/speakWord()/start() — makes every callback captured by the
 *  old speech chain a no-op so a dead chain can't resume by itself. */
let generation = 0;

let sentences: Sentence[] = [];
let currentIndex = 0;
let callbacks: StartPlaybackOptions | undefined;
let speechRate = 1;
let speechLanguage = DEFAULT_LANGUAGE;
/** Read by Speech callbacks (module-level ref pattern, same as desktop's speedRef). */
let playerStatus: TtsPlayerStatus = "idle";
/** Android only: resume() re-speaks the current sentence instead of un-pausing. */
let resumeAfterPauseFallback = false;

const CAN_PAUSE_IN_PLACE = Platform.OS !== "android";

function rateFromSettings(): number {
  const v = useSettingsStore.getState().ttsSpeed;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1;
}

function speakSentence(gen: number, index: number): void {
  const s = sentences[index];
  if (!s || playerStatus !== "playing" || gen !== generation) return;
  Speech.speak(s.text, {
    rate: speechRate,
    language: speechLanguage,
    onDone: () => {
      if (gen !== generation) return;
      if (playerStatus !== "playing") return; // paused on Android — resume() restarts it
      void finishSentence(gen, index);
    },
    onStopped: () => {
      // stop()/skip fired — the initiating action owns what happens next.
    },
    onError: (error) => {
      if (gen !== generation) return;
      const cb = callbacks;
      useTtsPlayer.getState().stop();
      cb?.onError?.(error);
    },
  });
}

async function finishSentence(gen: number, index: number): Promise<void> {
  if (gen !== generation) return;
  if (index + 1 < sentences.length) {
    currentIndex = index + 1;
    const s = sentences[currentIndex];
    useTtsPlayer.setState({ currentIndex });
    callbacks?.onSentence?.(s, currentIndex);
    speakSentence(gen, currentIndex);
  } else {
    // Natural end of the article.
    const cb = callbacks;
    useTtsPlayer.getState().stop();
    cb?.onFinish?.();
  }
}

/** Kill whatever is speaking/queued without letting its callbacks fire into a new generation. */
function interruptSpeech(): void {
  generation += 1;
  void Speech.stop();
}

/* ---------- store ---------- */

export const useTtsPlayer = create<TtsPlayerState>((set, get) => ({
  status: "idle",
  currentIndex: 0,
  total: 0,

  start: (articleText, opts) => {
    const list = splitSentences(articleText);
    interruptSpeech();
    speechRate = rateFromSettings();
    speechLanguage = DEFAULT_LANGUAGE;
    resumeAfterPauseFallback = false;
    if (list.length === 0) {
      sentences = [];
      currentIndex = 0;
      callbacks = undefined;
      playerStatus = "idle";
      set({ status: "idle", currentIndex: 0, total: 0 });
      return;
    }
    sentences = list;
    currentIndex = 0;
    callbacks = opts;
    playerStatus = "playing";
    set({ status: "playing", currentIndex: 0, total: list.length });
    const gen = generation;
    opts?.onSentence?.(list[0], 0);
    speakSentence(gen, 0);
  },

  pause: () => {
    if (get().status !== "playing") return;
    if (CAN_PAUSE_IN_PLACE) {
      void Speech.pause();
    } else {
      // Android: no pause API — stop the utterance; resume() restarts the sentence.
      resumeAfterPauseFallback = true;
      void Speech.stop();
    }
    playerStatus = "paused";
    set({ status: "paused" });
  },

  resume: async () => {
    if (get().status !== "paused") return false;
    playerStatus = "playing";
    set({ status: "playing" });
    if (resumeAfterPauseFallback) {
      resumeAfterPauseFallback = false;
      const gen = generation;
      speakSentence(gen, currentIndex);
      return false;
    }
    try {
      await Speech.resume();
    } catch {
      // Platform lied about resume support — re-speak from the sentence start.
      const gen = generation;
      speakSentence(gen, currentIndex);
      return false;
    }
    // Guard against the pause-in-the-gap-between-sentences race: the utterance
    // already finished, so resume() is a documented no-op and nothing is
    // playing — re-speak the current sentence to un-stall the chain.
    const speaking = await Speech.isSpeakingAsync().catch(() => true);
    if (!speaking && playerStatus === "playing") {
      const gen = generation;
      speakSentence(gen, currentIndex);
    }
    return true;
  },

  stop: () => {
    interruptSpeech();
    sentences = [];
    currentIndex = 0;
    callbacks = undefined;
    resumeAfterPauseFallback = false;
    playerStatus = "idle";
    set({ status: "idle", currentIndex: 0, total: 0 });
  },

  next: () => {
    const { status, total } = get();
    if (status === "idle") return;
    if (currentIndex + 1 >= total) {
      get().stop();
      return;
    }
    interruptSpeech();
    currentIndex += 1;
    set({ currentIndex });
    if (status === "paused") return; // stay paused at the new sentence
    const gen = generation;
    const s = sentences[currentIndex];
    callbacks?.onSentence?.(s, currentIndex);
    speakSentence(gen, currentIndex);
  },

  previous: () => {
    const { status } = get();
    if (status === "idle" || currentIndex <= 0) return;
    interruptSpeech();
    currentIndex -= 1;
    set({ currentIndex });
    if (status === "paused") return;
    const gen = generation;
    const s = sentences[currentIndex];
    callbacks?.onSentence?.(s, currentIndex);
    speakSentence(gen, currentIndex);
  },

  seekToSentence: (i) => {
    const { status, total } = get();
    if (status === "idle" || i < 0 || i >= total || i === currentIndex) return;
    interruptSpeech();
    currentIndex = i;
    set({ currentIndex: i });
    if (status === "paused") return;
    const gen = generation;
    const s = sentences[i];
    callbacks?.onSentence?.(s, i);
    speakSentence(gen, i);
  },
}));

/**
 * One-shot speech outside the article player. Bumping the generation first
 * detaches any article chain already queued, so this never overlaps it.
 */
export async function speakText(text: string, opts?: SpeakTextOptions): Promise<void> {
  interruptSpeech();
  useTtsPlayer.getState().stop();
  if (!text.trim()) {
    opts?.onDone?.();
    return;
  }
  const gen = generation;
  Speech.speak(text, {
    rate: opts?.rate ?? rateFromSettings(),
    language: opts?.language ?? DEFAULT_LANGUAGE,
    onDone: () => {
      if (gen === generation) opts?.onDone?.();
    },
    // Speech.stop() also confirms via onDone on some platforms — guard above.
    onStopped: () => {},
    onError: () => {
      // One-shot speak failures are silent (same as desktop web-speech fallback path).
    },
  });
}

/**
 * Vocabulary speak-button pronunciation. Shares the article player's queue on
 * purpose: it bumps the generation counter and calls stop(), so pressing a word
 * while an article plays ends article playback (the user then restarts it from
 * the beginning — simpler and never overlapping, matching the desktop's shared
 * web-speech queue behavior).
 */
export function speakWord(word: string): void {
  void speakText(word);
}
