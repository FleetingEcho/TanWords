import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { claimAudioChannel } from "@/lib/audioChannel";
import { consumeFallbackWarning, synthesizeBlob, WebSpeechFallbackRequired } from "@/lib/ttsBackend";

const PREFETCH_WINDOW = 2;

let sharedAudio: HTMLAudioElement | null = null;
function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) sharedAudio = new Audio();
  return sharedAudio;
}

/** Drives the actual playback mechanics (synthesis queue, prefetching, the
 * shared `<audio>` element, webspeech fallback) for whichever article the
 * `ttsPlayerStore` currently points at. Mount exactly once (PlayerBar does
 * this) — the store only holds declarative state; this hook is where the
 * side effects live. */
export function useArticlePlayer() {
  const t = useT();
  const status = useTtsPlayerStore((s) => s.status);
  const sourceKey = useTtsPlayerStore((s) => s.sourceKey);
  const sentences = useTtsPlayerStore((s) => s.sentences);
  const currentIndex = useTtsPlayerStore((s) => s.currentIndex);
  const speed = useTtsPlayerStore((s) => s.speed);
  const loadToken = useTtsPlayerStore((s) => s.loadToken);
  const next = useTtsPlayerStore((s) => s.next);
  const setStatus = useTtsPlayerStore((s) => s.setStatus);

  const modeRef = useRef<"blob" | "webspeech">("blob");
  const epochRef = useRef(0);
  const blobCacheRef = useRef<Map<number, string>>(new Map());
  const pendingRef = useRef<Set<number>>(new Set());
  const audioRef = useRef<HTMLAudioElement>(getSharedAudio());
  const speedRef = useRef(speed);
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;

  useEffect(() => {
    speedRef.current = speed;
    audioRef.current.playbackRate = speed;
  }, [speed]);

  // Tears down everything belonging to the *previous* sourceKey (or, on
  // unmount, whatever the last one was) and resets state for the new one.
  useEffect(() => {
    epochRef.current += 1;
    modeRef.current = "blob";
    pendingRef.current.clear();

    return () => {
      for (const url of blobCacheRef.current.values()) URL.revokeObjectURL(url);
      blobCacheRef.current.clear();
      window.speechSynthesis?.cancel();
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
    };
  }, [sourceKey]);

  const synthesizeIndex = useCallback(
    async (index: number) => {
      if (modeRef.current === "webspeech") return;
      const list = sentencesRef.current;
      if (index < 0 || index >= list.length) return;
      if (blobCacheRef.current.has(index) || pendingRef.current.has(index)) return;

      pendingRef.current.add(index);
      const myEpoch = epochRef.current;
      try {
        const blob = await synthesizeBlob(list[index].text);
        if (epochRef.current !== myEpoch) return;
        blobCacheRef.current.set(index, URL.createObjectURL(blob));
      } catch (e) {
        if (epochRef.current !== myEpoch) return;
        if (e instanceof WebSpeechFallbackRequired) {
          modeRef.current = "webspeech";
          if (consumeFallbackWarning()) toast(t("tts.fallbackToSystemVoice"));
        }
      } finally {
        pendingRef.current.delete(index);
      }
    },
    [t]
  );

  const playWebSpeech = useCallback(
    (index: number, myEpoch: number) => {
      const list = sentencesRef.current;
      const utterance = new SpeechSynthesisUtterance(list[index].text);
      utterance.rate = speedRef.current;
      utterance.onend = () => {
        if (epochRef.current === myEpoch) next();
      };
      utterance.onerror = () => {
        if (epochRef.current === myEpoch) setStatus("error", "playback failed");
      };
      window.speechSynthesis.cancel();
      claimAudioChannel(() => window.speechSynthesis.cancel());
      window.speechSynthesis.speak(utterance);
      setStatus("playing");
    },
    [next, setStatus]
  );

  // Prefetch the next couple of sentences so playback doesn't stall waiting
  // on synthesis. The current sentence itself is handled by the main effect
  // below, which awaits it directly.
  useEffect(() => {
    if (modeRef.current === "webspeech" || !sourceKey) return;
    for (let k = currentIndex + 1; k <= currentIndex + PREFETCH_WINDOW && k < sentences.length; k++) {
      synthesizeIndex(k);
    }
  }, [currentIndex, sourceKey, sentences, synthesizeIndex]);

  // (Re)starts playback of the current sentence from scratch. Keyed on
  // loadToken (bumped by start/jumpTo/next/prev/retry) rather than status,
  // so retrying the same index still triggers a fresh attempt.
  useEffect(() => {
    if (!sourceKey || sentencesRef.current.length === 0) return;
    const index = currentIndex;
    if (index < 0 || index >= sentencesRef.current.length) return;

    let cancelled = false;
    const myEpoch = epochRef.current;

    (async () => {
      if (modeRef.current === "webspeech") {
        playWebSpeech(index, myEpoch);
        return;
      }

      await synthesizeIndex(index);
      if (cancelled || epochRef.current !== myEpoch) return;

      const modeAfterSynth = modeRef.current as unknown as "blob" | "webspeech";
      if (modeAfterSynth === "webspeech") {
        playWebSpeech(index, myEpoch);
        return;
      }

      const url = blobCacheRef.current.get(index);
      if (!url) {
        setStatus("error", "synthesis failed");
        return;
      }

      const audio = audioRef.current;
      audio.pause();
      audio.src = url;
      audio.currentTime = 0;
      audio.playbackRate = speedRef.current;
      audio.onended = () => {
        if (epochRef.current === myEpoch) next();
      };
      audio.onerror = () => {
        if (epochRef.current === myEpoch) setStatus("error", "playback failed");
      };
      claimAudioChannel(() => audio.pause());
      try {
        await audio.play();
        if (!cancelled && epochRef.current === myEpoch) setStatus("playing");
      } catch {
        if (!cancelled && epochRef.current === myEpoch) setStatus("error", "playback failed");
      }
    })();

    return () => {
      cancelled = true;
      // Immediately stop any in-flight playback so the old sentence
      // doesn't overlap with the new one when the user skips ahead.
      window.speechSynthesis?.cancel();
      const audio = audioRef.current;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, loadToken]);

  // Pause/resume the already-loaded current sentence in place — does not
  // re-synthesize or restart playback from the beginning.
  useEffect(() => {
    if (status === "paused") {
      if (modeRef.current === "webspeech") window.speechSynthesis.pause();
      else audioRef.current.pause();
    } else if (status === "playing") {
      if (modeRef.current === "webspeech") {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } else if (audioRef.current.paused && audioRef.current.src) {
        audioRef.current.play().catch(() => {});
      }
    }
  }, [status]);
}
