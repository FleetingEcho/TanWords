import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

interface SettingsState {
  theme: Theme;
  defaultAiProvider: string;
  uiLanguage: string;
  vocabBilingual: boolean;
  targetLevel: string;
  dailyGoal: number;
  ttsModelPath: string;
  ttsVoiceId: string;
  ttsExtraDirs: string[];
  ttsSpeed: number;
  isLoaded: boolean;

  setTheme: (theme: Theme) => void;
  setDefaultAiProvider: (provider: string) => void;
  setUiLanguage: (lang: string) => void;
  setVocabBilingual: (v: boolean) => void;
  setTargetLevel: (level: string) => void;
  setDailyGoal: (n: number) => void;
  setTtsModelPath: (path: string) => void;
  setTtsVoiceId: (id: string) => void;
  setTtsExtraDirs: (dirs: string[]) => void;
  setTtsSpeed: (speed: number) => void;
  loadFromDB: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "system",
  defaultAiProvider: "openai",
  uiLanguage: "zh",
  vocabBilingual: false,
  targetLevel: "C1",
  dailyGoal: 10,
  ttsModelPath: "",
  ttsVoiceId: "0",
  ttsExtraDirs: [],
  ttsSpeed: 1,
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
  },

  setVocabBilingual: (v) => {
    set({ vocabBilingual: v });
    saveSetting("vocab_bilingual", JSON.stringify(v));
  },

  setTargetLevel: (level) => {
    set({ targetLevel: level });
    saveSetting("target_level", JSON.stringify(level));
  },

  setDailyGoal: (n) => {
    set({ dailyGoal: n });
    saveSetting("daily_goal", JSON.stringify(n));
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
        "daily_goal",
        "tts_model_path",
        "tts_voice_id",
        "tts_extra_dirs",
        "tts_speed",
      ];

      const values: Record<string, string> = {};
      for (const key of keys) {
        const val = await invoke<string | null>("db_get_setting", { key });
        if (val) {
          values[key] = JSON.parse(val);
        }
      }

      set({
        theme: (values.theme as Theme) || "system",
        defaultAiProvider: values.default_ai_provider || "openai",
        uiLanguage: values.ui_language || "zh",
        vocabBilingual: values.vocab_bilingual === "true",
        targetLevel: values.target_level || "C1",
        dailyGoal: Number(values.daily_goal) || 10,
        ttsModelPath: values.tts_model_path || "",
        ttsVoiceId: values.tts_voice_id || "0",
        ttsExtraDirs: Array.isArray(values.tts_extra_dirs) ? values.tts_extra_dirs : [],
        ttsSpeed: Number(values.tts_speed) || 1,
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
}

// Listen for system theme changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const { theme } = useSettingsStore.getState();
  if (theme === "system") {
    applyTheme("system");
  }
});
