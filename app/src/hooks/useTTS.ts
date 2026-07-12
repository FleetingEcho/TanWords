/**
 * Thin wrapper over the shared TTS backend for callers that just want a
 * fire-and-forget `speak(text)` — prefer `SpeakButton` for anything with its
 * own visible play/loading state.
 */
import { useCallback } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { claimAudioChannel } from "@/lib/audioChannel";
import { synthesizeBlob, WebSpeechFallbackRequired } from "@/lib/ttsBackend";

export function useTTS() {
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);

  const speak = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      try {
        const blob = await synthesizeBlob(trimmed);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = ttsSpeed;
        audio.onended = () => URL.revokeObjectURL(url);
        claimAudioChannel(() => audio.pause());
        await audio.play();
      } catch (e) {
        if (!(e instanceof WebSpeechFallbackRequired)) return;
        const utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.rate = ttsSpeed;
        claimAudioChannel(() => window.speechSynthesis.cancel());
        window.speechSynthesis.speak(utterance);
      }
    },
    [ttsSpeed]
  );

  return { speak };
}
