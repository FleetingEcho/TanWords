import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

interface SettingsState {
  theme: Theme;
  defaultAiProvider: string;
  uiLanguage: string;
  vocabBilingual: boolean;
  /** CEFR levels the AI calibrates to — multi-select, e.g. ["C1","C2"]. */
  targetLevels: string[];
  /** User override for the word-enrichment system prompt. Empty string = use the built-in default. */
  customEnrichPrompt: string;
  ttsModelPath: string;
  ttsVoiceId: string;
  ttsExtraDirs: string[];
  ttsSpeed: number;
  /** Show the floating quick-doc-edit ball in the bottom-right corner. */
  showQuickDoc: boolean;
  isLoaded: boolean;

  setTheme: (theme: Theme) => void;
  setDefaultAiProvider: (provider: string) => void;
  setUiLanguage: (lang: string) => void;
  setVocabBilingual: (v: boolean) => void;
  setTargetLevels: (levels: string[]) => void;
  setCustomEnrichPrompt: (prompt: string) => void;
  setTtsModelPath: (path: string) => void;
  setTtsVoiceId: (id: string) => void;
  setTtsExtraDirs: (dirs: string[]) => void;
  setTtsSpeed: (speed: number) => void;
  setShowQuickDoc: (v: boolean) => void;
  loadFromDB: () => Promise<void>;
}

/** Cached synchronously so the first render uses the right language instead
 * of flashing "zh" before the async DB round-trip in loadFromDB() resolves. */
function cachedUiLanguage(): string {
  try {
    return localStorage.getItem("tanwords_language_cache") || "zh";
  } catch {
    return "zh";
  }
}

function cacheUiLanguage(lang: string) {
  try {
    localStorage.setItem("tanwords_language_cache", lang);
  } catch {
    // localStorage unavailable — the DB-driven value still applies, just without the fast-path cache
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "system",
  defaultAiProvider: "openai",
  uiLanguage: cachedUiLanguage(),
  vocabBilingual: false,
  targetLevels: ["C1"],
  customEnrichPrompt: "",
  ttsModelPath: "",
  ttsVoiceId: "0",
  ttsExtraDirs: [],
  ttsSpeed: 1,
  showQuickDoc: true,
  isLoaded: false,

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    saveSetting("theme", JSON.stringify(theme));
  },

  setDefaultAiProvider: (provider) => {
    set({ defaultAiProvider: provider });
    saveSetting("default_ai_provider", JSON.stringify(provider));
  },

  setUiLanguage: (lang) => {
    set({ uiLanguage: lang });
    saveSetting("ui_language", JSON.stringify(lang));
    cacheUiLanguage(lang);
  },

  setVocabBilingual: (v) => {
    set({ vocabBilingual: v });
    saveSetting("vocab_bilingual", JSON.stringify(v));
  },

  setShowQuickDoc: (v) => {
    set({ showQuickDoc: v });
    saveSetting("quick_doc_ball", JSON.stringify(v));
  },

  setTargetLevels: (levels) => {
    if (levels.length === 0) return; // always keep at least one level
    set({ targetLevels: levels });
    saveSetting("target_level", JSON.stringify(levels));
  },

  setCustomEnrichPrompt: (prompt) => {
    set({ customEnrichPrompt: prompt });
    saveSetting("custom_enrich_prompt", JSON.stringify(prompt));
  },

  setTtsModelPath: (path) => {
    set({ ttsModelPath: path });
    saveSetting("tts_model_path", JSON.stringify(path));
  },

  setTtsVoiceId: (id) => {
    set({ ttsVoiceId: id });
    saveSetting("tts_voice_id", JSON.stringify(id));
  },

  setTtsExtraDirs: (dirs) => {
    set({ ttsExtraDirs: dirs });
    saveSetting("tts_extra_dirs", JSON.stringify(dirs));
  },

  setTtsSpeed: (speed) => {
    set({ ttsSpeed: speed });
    saveSetting("tts_speed", JSON.stringify(speed));
  },

  loadFromDB: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const keys = [
        "theme",
        "default_ai_provider",
        "ui_language",
        "vocab_bilingual",
        "target_level",
        "custom_enrich_prompt",
        "tts_model_path",
        "tts_voice_id",
        "tts_extra_dirs",
        "tts_speed",
        "quick_doc_ball",
      ];

      const values: Record<string, string> = {};
      for (const key of keys) {
        const val = await invoke<string | null>("db_get_setting", { key });
        if (val) {
          values[key] = JSON.parse(val);
        }
      }

      const resolvedUiLanguage = values.ui_language || "zh";
      cacheUiLanguage(resolvedUiLanguage);

      set({
        theme: (values.theme as Theme) || "system",
        defaultAiProvider: values.default_ai_provider || "openai",
        uiLanguage: resolvedUiLanguage,
        vocabBilingual: values.vocab_bilingual === "true",
        // Legacy installs stored a single string ("C1"); newer ones an array.
        targetLevels: Array.isArray(values.target_level)
          ? (values.target_level as unknown as string[])
          : values.target_level
          ? [values.target_level]
          : ["C1"],
        customEnrichPrompt: values.custom_enrich_prompt || "",
        ttsModelPath: values.tts_model_path || "",
        ttsVoiceId: values.tts_voice_id || "0",
        ttsExtraDirs: Array.isArray(values.tts_extra_dirs) ? values.tts_extra_dirs : [],
        ttsSpeed: Number(values.tts_speed) || 1,
        // JSON.parse turns the stored string into a real boolean; default on.
        showQuickDoc: (values.quick_doc_ball as unknown) !== false && values.quick_doc_ball !== "false",
        isLoaded: true,
      });

      applyTheme(get().theme);
    } catch (e) {
      console.warn("Settings not loaded from DB (may be web mode):", e);
      applyTheme(get().theme);
      set({ isLoaded: true });
    }
  },
}));

async function saveSetting(key: string, value: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("db_set_setting", { key, value });
  } catch {
    // Web mode fallback
    localStorage.setItem(`tanwords_${key}`, value);
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
  // Cached so index.html's pre-paint script can apply it synchronously on
  // the next launch, before the async DB round-trip resolves.
  try {
    localStorage.setItem("tanwords_theme_cache", theme);
  } catch {
    // localStorage unavailable — the DB-driven applyTheme() call still runs, just later
  }
}

// Listen for system theme changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const { theme } = useSettingsStore.getState();
  if (theme === "system") {
    applyTheme("system");
  }
});
