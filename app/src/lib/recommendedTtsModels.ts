const RELEASE_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";

export interface RecommendedTtsModel {
  /** Also the extracted directory name under the default models folder. */
  id: string;
  name: string;
  url: string;
  sizeMb: number;
  descriptionKey: string;
  group: "pocket" | "kokoro" | "piper";
}

/** Curated subset of sherpa-onnx's official TTS release assets, most capable
 * first.
 *
 * Pocket leads: it is the newest architecture here and the best-sounding on
 * CPU, but it is English-only, so the Kokoro multi-lang entries remain the
 * answer for anyone reading Chinese. Kokoro entries range from the small int8
 * build up to the full-precision multi-lingual one; Piper entries are small
 * single-voice alternatives in a couple of accents. */
export const RECOMMENDED_TTS_MODELS: RecommendedTtsModel[] = [
  {
    id: "sherpa-onnx-pocket-tts-int8-2026-01-26",
    name: "Pocket TTS (English)",
    url: `${RELEASE_BASE}sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2`,
    sizeMb: 98,
    descriptionKey: "tts.model.pocket",
    group: "pocket",
  },
  {
    // Not simply "the better one": Pocket samples autoregressively, so
    // quantization changes which tokens get drawn rather than just adding
    // noise. The two bundles read a sentence differently — pacing and phrasing
    // included — which is a preference, not a ranking. It is also 2.5x the disk
    // and ~40% slower per sentence, so int8 stays the one listed first.
    id: "sherpa-onnx-pocket-tts-2026-01-26",
    name: "Pocket TTS HQ (English)",
    url: `${RELEASE_BASE}sherpa-onnx-pocket-tts-2026-01-26.tar.bz2`,
    sizeMb: 168,
    descriptionKey: "tts.model.pocketHq",
    group: "pocket",
  },
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
