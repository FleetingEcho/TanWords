import { create } from "zustand";
import type { NavPage } from "@/store/navStore";

export type Theme = "light" | "dark" | "system";
export type SidebarTabId = Exclude<NavPage, "settings">;

export const DEFAULT_SIDEBAR_TABS: SidebarTabId[] = [
  "dashboard", "feeds", "reading", "scene-lab", "vocabulary", "documents", "music", "chat",
];

interface SettingsState {
  theme: Theme;
  defaultAiProvider: string;
  uiLanguage: string;
  /** CEFR levels the AI calibrates to — multi-select, e.g. ["C1","C2"]. */
  targetLevels: string[];
  /** User override for the word-enrichment system prompt. Empty string = use the built-in default. */
  customEnrichPrompt: string;
  /** Root folder of the local music library. Empty string = not configured. */
  musicFolderPath: string;
  ttsModelPath: string;
  ttsVoiceId: string;
  ttsExtraDirs: string[];
  ttsSpeed: number;
  /** Show the floating quick-doc-edit ball in the bottom-right corner. */
  showQuickDoc: boolean;
  /** Show the project GitHub link in the sidebar footer. */
  showGithubLink: boolean;
  /** Main navigation tabs visible in the sidebar. Settings is always visible. */
  visibleSidebarTabs: SidebarTabId[];
  isLoaded: boolean;

  setTheme: (theme: Theme) => void;
  setDefaultAiProvider: (provider: string) => void;
  setUiLanguage: (lang: string) => void;
  setTargetLevels: (levels: string[]) => void;
  setCustomEnrichPrompt: (prompt: string) => void;
  setMusicFolderPath: (path: string) => void;
  setTtsModelPath: (path: string) => void;
  setTtsVoiceId: (id: string) => void;
  setTtsExtraDirs: (dirs: string[]) => void;
  setTtsSpeed: (speed: number) => void;
  setShowQuickDoc: (v: boolean) => void;
  setShowGithubLink: (v: boolean) => void;
  setSidebarTabVisible: (tab: SidebarTabId, visible: boolean) => void;
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

const SIDEBAR_TABS_CACHE_KEY = "tanwords_visible_sidebar_tabs_cache";

function cachedSidebarTabs(): SidebarTabId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIDEBAR_TABS_CACHE_KEY) || "null");
    if (!Array.isArray(parsed)) return [];
    return DEFAULT_SIDEBAR_TABS.filter((id) => parsed.includes(id));
  } catch {
    return [];
  }
}

function cacheSidebarTabs(tabs: SidebarTabId[]) {
  try {
    localStorage.setItem(SIDEBAR_TABS_CACHE_KEY, JSON.stringify(tabs));
  } catch {
    // The DB remains authoritative when localStorage is unavailable.
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "system",
  defaultAiProvider: "openai",
  uiLanguage: cachedUiLanguage(),
  targetLevels: ["C1"],
  customEnrichPrompt: "",
  musicFolderPath: "",
  ttsModelPath: "",
  ttsVoiceId: "0",
  ttsExtraDirs: [],
  ttsSpeed: 1,
  showQuickDoc: true,
  showGithubLink: true,
  visibleSidebarTabs: cachedSidebarTabs(),
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


  setShowQuickDoc: (v) => {
    set({ showQuickDoc: v });
    saveSetting("quick_doc_ball", JSON.stringify(v));
  },

  setShowGithubLink: (v) => {
    set({ showGithubLink: v });
    saveSetting("show_github_link", JSON.stringify(v));
  },

  setSidebarTabVisible: (tab, visible) => {
    const current = get().visibleSidebarTabs;
    const next = visible
      ? DEFAULT_SIDEBAR_TABS.filter((id) => id === tab || current.includes(id))
      : current.filter((id) => id !== tab);
    set({ visibleSidebarTabs: next });
    cacheSidebarTabs(next);
    saveSetting("visible_sidebar_tabs", JSON.stringify(next));
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

  setMusicFolderPath: (path) => {
    set({ musicFolderPath: path });
    saveSetting("music_folder_path", JSON.stringify(path));
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
        "target_level",
        "custom_enrich_prompt",
        "music_folder_path",
        "tts_model_path",
        "tts_voice_id",
        "tts_extra_dirs",
        "tts_speed",
        "quick_doc_ball",
        "show_github_link",
        "visible_sidebar_tabs",
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

      const resolvedSidebarTabs = Array.isArray(values.visible_sidebar_tabs)
        ? DEFAULT_SIDEBAR_TABS.filter((id) => (values.visible_sidebar_tabs as unknown as string[]).includes(id))
        : DEFAULT_SIDEBAR_TABS;
      cacheSidebarTabs(resolvedSidebarTabs);

      set({
        theme: (values.theme as Theme) || "system",
        defaultAiProvider: values.default_ai_provider || "openai",
        uiLanguage: resolvedUiLanguage,
        // Legacy installs stored a single string ("C1"); newer ones an array.
        targetLevels: Array.isArray(values.target_level)
          ? (values.target_level as unknown as string[])
          : values.target_level
          ? [values.target_level]
          : ["C1"],
        customEnrichPrompt: values.custom_enrich_prompt || "",
        musicFolderPath: values.music_folder_path || "",
        ttsModelPath: values.tts_model_path || "",
        ttsVoiceId: values.tts_voice_id || "0",
        ttsExtraDirs: Array.isArray(values.tts_extra_dirs) ? values.tts_extra_dirs : [],
        ttsSpeed: Number(values.tts_speed) || 1,
        // JSON.parse turns the stored string into a real boolean; default on.
        showQuickDoc: (values.quick_doc_ball as unknown) !== false && values.quick_doc_ball !== "false",
        showGithubLink: (values.show_github_link as unknown) !== false && values.show_github_link !== "false",
        visibleSidebarTabs: resolvedSidebarTabs,
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

function applyTheme(theme: Theme) {
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
