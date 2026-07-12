const RELEASE_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";

export interface RecommendedTtsModel {
  /** Also the extracted directory name under the default models folder. */
  id: string;
  name: string;
  url: string;
  sizeMb: number;
  descriptionKey: string;
  group: "kokoro" | "piper";
}

/** Curated subset of sherpa-onnx's official TTS release assets — all
 * single-speaker (or Kokoro's built-in multi-voice) so the existing
 * speaker-id UI covers them without extra plumbing. Kokoro entries range
 * from the small int8 default up to the full-precision multi-lingual one;
 * Piper entries are small single-voice alternatives in a couple of accents. */
export const RECOMMENDED_TTS_MODELS: RecommendedTtsModel[] = [
  {
    id: "kokoro-int8-en-v0_19",
    name: "Kokoro (English)",
    url: `${RELEASE_BASE}kokoro-int8-en-v0_19.tar.bz2`,
    sizeMb: 100,
    descriptionKey: "tts.model.kokoroInt8",
    group: "kokoro",
  },
  {
    id: "kokoro-int8-multi-lang-v1_1",
    name: "Kokoro Multi-lang (English + Chinese)",
    url: `${RELEASE_BASE}kokoro-int8-multi-lang-v1_1.tar.bz2`,
    sizeMb: 147,
    descriptionKey: "tts.model.kokoroInt8MultiLang",
    group: "kokoro",
  },
  {
    id: "kokoro-en-v0_19",
    name: "Kokoro HQ (English)",
    url: `${RELEASE_BASE}kokoro-en-v0_19.tar.bz2`,
    sizeMb: 320,
    descriptionKey: "tts.model.kokoroFp32",
    group: "kokoro",
  },
  {
    id: "kokoro-multi-lang-v1_1",
    name: "Kokoro Multi-lang HQ (English + Chinese)",
    url: `${RELEASE_BASE}kokoro-multi-lang-v1_1.tar.bz2`,
    sizeMb: 365,
    descriptionKey: "tts.model.kokoroMultiLang",
    group: "kokoro",
  },
  {
    id: "vits-piper-en_US-lessac-medium-int8",
    name: "Piper · Lessac (US)",
    url: `${RELEASE_BASE}vits-piper-en_US-lessac-medium-int8.tar.bz2`,
    sizeMb: 21,
    descriptionKey: "tts.model.piperLessac",
    group: "piper",
  },
  {
    id: "vits-piper-en_US-ryan-high-int8",
    name: "Piper · Ryan HQ (US)",
    url: `${RELEASE_BASE}vits-piper-en_US-ryan-high-int8.tar.bz2`,
    sizeMb: 34,
    descriptionKey: "tts.model.piperRyan",
    group: "piper",
  },
  {
    id: "vits-piper-en_GB-alan-medium-int8",
    name: "Piper · Alan (UK)",
    url: `${RELEASE_BASE}vits-piper-en_GB-alan-medium-int8.tar.bz2`,
    sizeMb: 21,
    descriptionKey: "tts.model.piperAlan",
    group: "piper",
  },
  {
    id: "vits-piper-en_GB-southern_english_female-medium-int8",
    name: "Piper · Southern English Female (UK)",
    url: `${RELEASE_BASE}vits-piper-en_GB-southern_english_female-medium-int8.tar.bz2`,
    sizeMb: 23,
    descriptionKey: "tts.model.piperSouthernFemale",
    group: "piper",
  },
];
