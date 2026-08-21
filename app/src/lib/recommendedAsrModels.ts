const RELEASE_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";

export interface RecommendedAsrModel {
  /** Also the extracted directory name under the default models folder. */
  id: string;
  name: string;
  url: string;
  sizeMb: number;
  descriptionKey: string;
}

/** Curated subset of sherpa-onnx's official ASR release assets.
 *
 * SenseVoice (FunASR/Alibaba, 2024) leads: it's natively multilingual
 * (zh/en/yue/ja/ko), trained specifically on mixed Chinese/English speech,
 * and non-autoregressive — one forward pass instead of Whisper's token-by-
 * token decoding, so it's both faster and more accurate on this app's exact
 * use case. Whisper stays listed as the fallback multilingual option (more
 * widely known, still solid). Moonshine and Parakeet-TDT are English-only,
 * kept as faster alternatives for anyone who only speaks English to the
 * assistant. */
export const RECOMMENDED_ASR_MODELS: RecommendedAsrModel[] = [
  {
    id: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2025-09-09",
    name: "SenseVoice (multilingual, fast + accurate)",
    url: `${RELEASE_BASE}sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2025-09-09.tar.bz2`,
    sizeMb: 845,
    descriptionKey: "voice.model.sensevoice",
  },
  {
    id: "sherpa-onnx-whisper-small",
    name: "Whisper Small (multilingual)",
    url: `${RELEASE_BASE}sherpa-onnx-whisper-small.tar.bz2`,
    sizeMb: 500,
    descriptionKey: "voice.model.whisperSmall",
  },
  {
    id: "sherpa-onnx-whisper-turbo",
    name: "Whisper Turbo (multilingual, most accurate)",
    url: `${RELEASE_BASE}sherpa-onnx-whisper-turbo.tar.bz2`,
    sizeMb: 1600,
    descriptionKey: "voice.model.whisperTurbo",
  },
  {
    id: "sherpa-onnx-moonshine-tiny-en-int8",
    name: "Moonshine Tiny (English only, fastest)",
    url: `${RELEASE_BASE}sherpa-onnx-moonshine-tiny-en-int8.tar.bz2`,
    sizeMb: 60,
    descriptionKey: "voice.model.moonshineTiny",
  },
  {
    id: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    name: "Parakeet-TDT 0.6B (English only, most accurate)",
    url: `${RELEASE_BASE}sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2`,
    sizeMb: 600,
    descriptionKey: "voice.model.parakeet",
  },
];
