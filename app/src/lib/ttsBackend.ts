import { invoke } from "@/ipc/backend";
import { useSettingsStore } from "@/store/settingsStore";

/** Thrown by `synthesizeBlob` when the caller should fall back to
 * `window.speechSynthesis` instead — either no embedded engine is available
 * (web mode) or a model couldn't be loaded even after the one-time
 * self-heal attempt. */
export class WebSpeechFallbackRequired extends Error {}

let warnedFallback = false;
const TTS_IDLE_UNLOAD_MS = 5 * 60_000;
let ttsUnloadTimer: ReturnType<typeof setTimeout> | null = null;

/** Arms the sidecar's TTS model to be released after it has sat unused. The
 *  loaded sherpa-onnx session is the app's biggest optional resident cost
 *  (60-120MB), and the frontend already self-heals on the next request, so an
 *  idle timeout is a low-risk way to return that memory to the OS. */
export function markTtsActivity() {
  if (ttsUnloadTimer) clearTimeout(ttsUnloadTimer);
  ttsUnloadTimer = setTimeout(() => {
    ttsUnloadTimer = null;
    void invoke("tts_unload_model").catch(() => {});
  }, TTS_IDLE_UNLOAD_MS);
}

/** Returns true the first time it's called after a fallback occurs, so
 * callers can show a one-time toast instead of one per sentence. */
export function consumeFallbackWarning(): boolean {
  if (warnedFallback) return false;
  warnedFallback = true;
  return true;
}

/** Synthesizes `text` through the embedded engine. If the model isn't
 * loaded yet, self-heals once using the persisted model choice before
 * giving up and asking the caller to fall back to webspeech. `signal` lets a
 * caller actually cancel the in-flight synthesis request (not just discard
 * its result) — VoiceOverlay passes the same controller it uses to abort the
 * LLM stream, so closing it mid-reply cancels every not-yet-spoken sentence
 * still being synthesized, not only the ones already queued. */
export async function synthesizeBlob(text: string, signal?: AbortSignal): Promise<Blob> {
  // The remote engine takes precedence when selected. Unlike the local path
  // it has nothing to self-heal (no model files, nothing to preload — the
  // endpoint is dialed per request) and its failures propagate as hard
  // errors instead of a webspeech fallback: the user picked a specific
  // remote voice, and silently substituting the browser's would read as
  // "the voice changed" rather than as degraded output.
  const { ttsRemoteProviderId } = useSettingsStore.getState();
  if (ttsRemoteProviderId) return synthesizeRemoteBlob(text, signal);

  const { ttsVoiceId } = useSettingsStore.getState();
  const speakerId = Number(ttsVoiceId) || 0;

  try {
    return await synthesizeOnce(text, speakerId, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    if (!isModelNotLoaded(e)) {
      throw new WebSpeechFallbackRequired();
    }
  }

  const { ttsModelPath } = useSettingsStore.getState();
  if (!ttsModelPath) {
    throw new WebSpeechFallbackRequired();
  }
  try {
    await invoke("tts_load_model", { path: ttsModelPath }, signal);
    markTtsActivity();
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new WebSpeechFallbackRequired();
  }
  try {
    return await synthesizeOnce(text, speakerId, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new WebSpeechFallbackRequired();
  }
}

/** Synthesizes through the configured OpenAI-compatible endpoint
 *  (`tts_remote_synthesize`). Remote errors deliberately do NOT trigger the
 *  webspeech fallback — see `synthesizeBlob`. */
async function synthesizeRemoteBlob(text: string, signal?: AbortSignal): Promise<Blob> {
  const wavBase64 = await invoke<string>("tts_remote_synthesize", { text, speed: 1.0 }, signal);
  const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "audio/wav" });
}

async function synthesizeOnce(text: string, speakerId: number, signal?: AbortSignal): Promise<Blob> {
  const wavBase64 = await invoke<string>("tts_synthesize", { text, speakerId, speed: 1.0 }, signal);
  markTtsActivity();
  const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "audio/wav" });
}

/** Proactively loads the persisted TTS model, if any — same reasoning as
 *  `asrBackend.ensureAsrLoaded`, called when VoiceOverlay opens so the first
 *  reply doesn't pay for a cold load. Returns false without throwing if
 *  nothing is configured or loading failed. */
export async function ensureTtsLoaded(): Promise<boolean> {
  // Remote needs no preload; report "configured" so VoiceOverlay's ready
  // check doesn't mark TTS unavailable.
  if (useSettingsStore.getState().ttsRemoteProviderId) return true;

  const { ttsModelPath } = useSettingsStore.getState();
  if (!ttsModelPath) return false;

  try {
    const status = await invoke<{ path: string } | null>("tts_engine_status");
    if (status?.path === ttsModelPath) return true;
    await invoke("tts_load_model", { path: ttsModelPath });
    markTtsActivity();
    return true;
  } catch (e) {
    console.warn("TTS model preload failed", e);
    return false;
  }
}

function isModelNotLoaded(e: unknown): boolean {
  if (e === "model-not-loaded") return true;
  if (e instanceof Error && e.message === "model-not-loaded") return true;
  return false;
}
