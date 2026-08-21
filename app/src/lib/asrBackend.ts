import { invoke } from "@/ipc/backend";

const ASR_IDLE_UNLOAD_MS = 5 * 60_000;
let asrUnloadTimer: ReturnType<typeof setTimeout> | null = null;

/** Arms the sidecar's ASR model to be released after it has sat unused —
 *  same idea as `tts::markTtsActivity`, since the loaded sherpa-onnx session
 *  is a comparable resident-memory cost. The next recording self-heals by
 *  reloading the persisted model. */
export function markAsrActivity() {
  if (asrUnloadTimer) clearTimeout(asrUnloadTimer);
  asrUnloadTimer = setTimeout(() => {
    asrUnloadTimer = null;
    void invoke("asr_unload_model").catch(() => {});
  }, ASR_IDLE_UNLOAD_MS);
}

/** Transcribes one recorded clip, self-healing (loading the persisted model)
 *  if it isn't currently loaded — mirrors `ttsBackend.synthesizeBlob`. Throws
 *  if no model is configured or loading fails. Returns "" (same as no speech
 *  detected) for a known ASR hallucination artifact — see
 *  `stripNonSpeechArtifact` — rather than the raw tag text. */
export async function transcribeWav(wavBase64: string): Promise<string> {
  try {
    const text = await invoke<string>("asr_transcribe", { audioB64: wavBase64 });
    markAsrActivity();
    return stripNonSpeechArtifact(text);
  } catch (e) {
    if (!isModelNotLoaded(e)) throw e;
  }

  const { useSettingsStore } = await import("@/store/settingsStore");
  const { asrModelPath } = useSettingsStore.getState();
  if (!asrModelPath) throw new Error("no ASR model configured");

  await invoke("asr_load_model", { path: asrModelPath });
  const text = await invoke<string>("asr_transcribe", { audioB64: wavBase64 });
  markAsrActivity();
  return stripNonSpeechArtifact(text);
}

/** Proactively loads the persisted ASR model, if any, so the first real
 *  recording doesn't pay for a cold load — called when VoiceOverlay opens.
 *  Returns false (without throwing) if nothing is configured yet or loading
 *  failed, so the caller can show a "no model" hint instead of a runtime
 *  error the user did nothing to cause. */
export async function ensureAsrLoaded(): Promise<boolean> {
  const { useSettingsStore } = await import("@/store/settingsStore");
  const { asrModelPath } = useSettingsStore.getState();
  if (!asrModelPath) return false;

  try {
    const status = await invoke<{ path: string } | null>("asr_engine_status");
    if (status?.path === asrModelPath) return true;
    await invoke("asr_load_model", { path: asrModelPath });
    markAsrActivity();
    return true;
  } catch (e) {
    console.warn("ASR model preload failed", e);
    return false;
  }
}

function isModelNotLoaded(e: unknown): boolean {
  if (e === "model-not-loaded") return true;
  if (e instanceof Error && e.message === "model-not-loaded") return true;
  return false;
}

// Whisper (and similar models trained on caption data) hallucinate
// caption-style tags — "[Music]", "*music*", "(Applause)", "（音乐）" — on
// clips with little or no actual speech, rather than returning empty text.
// With no VAD trimming the recording, a click-to-record clip very often has
// some silence/room-tone padding at its edges, which is exactly what
// triggers this. Matches only when the ENTIRE transcript is nothing but one
// or more such bracket/paren/asterisk-wrapped tags — real speech that
// happens to mention "music" mid-sentence is left alone.
const NON_SPEECH_ARTIFACT_RE = /^(?:[[(*【（][^\])*】）]{1,30}[\])*】）]\s*)+$/;

function stripNonSpeechArtifact(text: string): string {
  const trimmed = text.trim();
  return NON_SPEECH_ARTIFACT_RE.test(trimmed) ? "" : text;
}
