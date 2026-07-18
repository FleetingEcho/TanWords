import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/store/settingsStore";

/** Thrown by `synthesizeBlob` when the caller should fall back to
 * `window.speechSynthesis` instead — either no embedded engine is available
 * (web mode) or a model couldn't be loaded even after the one-time
 * self-heal attempt. */
export class WebSpeechFallbackRequired extends Error {}

let warnedFallback = false;

/** Returns true the first time it's called after a fallback occurs, so
 * callers can show a one-time toast instead of one per sentence. */
export function consumeFallbackWarning(): boolean {
  if (warnedFallback) return false;
  warnedFallback = true;
  return true;
}

/** Synthesizes `text` through the embedded engine. If the model isn't
 * loaded yet, self-heals once using the persisted model choice before
 * giving up and asking the caller to fall back to webspeech. */
export async function synthesizeBlob(text: string): Promise<Blob> {
  const { ttsVoiceId } = useSettingsStore.getState();
  const speakerId = Number(ttsVoiceId) || 0;

  try {
    return await synthesizeOnce(text, speakerId);
  } catch (e) {
    if (!isModelNotLoaded(e)) {
      throw new WebSpeechFallbackRequired();
    }
  }

  const { ttsModelPath } = useSettingsStore.getState();
  if (!ttsModelPath) {
    throw new WebSpeechFallbackRequired();
  }
  try {
    await invoke("tts_load_model", { path: ttsModelPath });
  } catch {
    throw new WebSpeechFallbackRequired();
  }
  try {
    return await synthesizeOnce(text, speakerId);
  } catch {
    throw new WebSpeechFallbackRequired();
  }
}

async function synthesizeOnce(text: string, speakerId: number): Promise<Blob> {
  const wavBase64 = await invoke<string>("tts_synthesize", { text, speakerId, speed: 1.0 });
  const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "audio/wav" });
}

function isModelNotLoaded(e: unknown): boolean {
  if (e === "model-not-loaded") return true;
  if (e instanceof Error && e.message === "model-not-loaded") return true;
  return false;
}
