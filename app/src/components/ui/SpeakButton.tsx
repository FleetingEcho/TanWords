import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { SpeakerIcon } from "@/components/ui/icons";
import { claimAudioChannel, releaseAudioChannel } from "@/lib/audioChannel";
import { consumeFallbackWarning, synthesizeBlob, WebSpeechFallbackRequired } from "@/lib/ttsBackend";
import { Button } from "@/components/ui/button";

const CACHE_CAPACITY = 50;
// Insertion order doubles as LRU recency — re-inserting a key on access
// (delete + set) moves it to the "most recent" end.
const blobCache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  const url = blobCache.get(key);
  if (url === undefined) return undefined;
  blobCache.delete(key);
  blobCache.set(key, url);
  return url;
}

function cacheSet(key: string, url: string) {
  blobCache.set(key, url);
  if (blobCache.size > CACHE_CAPACITY) {
    const oldestKey = blobCache.keys().next().value as string;
    const oldestUrl = blobCache.get(oldestKey);
    blobCache.delete(oldestKey);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
  }
}

type Status = "idle" | "loading" | "playing";

/** Small inline speaker button for a single word/sentence — used anywhere a
 * piece of English text is shown (word lists, examples, idioms, patterns).
 * Shares the LRU blob cache across every instance, and the audio channel
 * with the article PlayerBar so only one thing plays at a time. */
export function SpeakButton({ text, className }: { text: string; className?: string }) {
  const t = useT();
  const ttsVoiceId = useSettingsStore((s) => s.ttsVoiceId);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const [status, setStatus] = useState<Status>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    setStatus("idle");
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (status !== "idle") {
      stop();
      releaseAudioChannel(stop);
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    setStatus("loading");
    const cacheKey = `${trimmed}::${ttsVoiceId}`;
    try {
      let url = cacheGet(cacheKey);
      if (!url) {
        const blob = await synthesizeBlob(trimmed);
        url = URL.createObjectURL(blob);
        cacheSet(cacheKey, url);
      }
      const audio = new Audio(url);
      audio.playbackRate = ttsSpeed;
      audioRef.current = audio;
      audio.onended = () => {
        releaseAudioChannel(stop);
        setStatus("idle");
      };
      audio.onerror = () => {
        releaseAudioChannel(stop);
        setStatus("idle");
      };
      claimAudioChannel(stop);
      await audio.play();
      setStatus("playing");
    } catch (err) {
      if (err instanceof WebSpeechFallbackRequired) {
        if (consumeFallbackWarning()) toast(t("tts.fallbackToSystemVoice"));
        const utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.rate = ttsSpeed;
        utterance.onend = () => {
          releaseAudioChannel(stop);
          setStatus("idle");
        };
        utterance.onerror = () => {
          releaseAudioChannel(stop);
          setStatus("idle");
        };
        claimAudioChannel(stop);
        window.speechSynthesis.speak(utterance);
        setStatus("playing");
      } else {
        setStatus("idle");
      }
    }
  };

  return (
    <Button
      variant="ghost"
      onClick={handleClick}
      disabled={status === "loading"}
      title={t("tts.preview")}
      className={`h-auto w-auto p-0 inline-flex items-center justify-center shrink-0 transition-colors hover:bg-transparent disabled:opacity-40 ${
        status === "playing" ? "text-primary" : "text-muted-foreground hover:text-primary"
      } ${className ?? ""}`}
    >
      <SpeakerIcon className="w-full h-full" />
    </Button>
  );
}
