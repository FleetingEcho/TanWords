import { create } from "zustand";
import type { NavPage } from "@/store/navStore";

export type Theme = "light" | "dark" | "system";
export type SidebarTabId = Exclude<NavPage, "settings">;
export type TopBarItemId = "search" | "context" | "mcp" | "ai" | "language" | "theme" | "updates" | "github";

/** Feeds page tab selector: a specific RSS feed, "all" of them, or the native Hacker News browser. */
export type RssTabSelection = number | "all" | "hackernews";

export const DEFAULT_SIDEBAR_TABS: SidebarTabId[] = [
  "dashboard", "feeds", "scene-lab", "vocabulary", "documents", "music", "chat",
];
export const DEFAULT_TOPBAR_ITEMS: TopBarItemId[] = [
  "search", "context", "mcp", "ai", "language", "theme", "updates", "github",
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
  /** User-selected controls visible in the global command bar. */
  visibleTopBarItems: TopBarItemId[];
  /** RSS feed tab selected by default when opening Feeds — "all" or a specific feed's id.
   *  Lets a user who mainly reads one source (e.g. Hacker News) skip loading every channel. */
  defaultRssTab: RssTabSelection;
  /** Card = magazine layout with cover art; list = dense one-line-per-entry, for feeds with many items. */
  feedsViewMode: "card" | "list";
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
  setTopBarItemVisible: (item: TopBarItemId, visible: boolean) => void;
  setDefaultRssTab: (tab: RssTabSelection) => void;
  setFeedsViewMode: (mode: "card" | "list") => void;
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
const TOPBAR_ITEMS_CACHE_KEY = "tanwords_visible_topbar_items_cache";

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

function cachedTopBarItems(): TopBarItemId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOPBAR_ITEMS_CACHE_KEY) || "null");
    if (!Array.isArray(parsed)) return DEFAULT_TOPBAR_ITEMS;
    return DEFAULT_TOPBAR_ITEMS.filter((id) => parsed.includes(id));
  } catch {
    return DEFAULT_TOPBAR_ITEMS;
  }
}

function cacheTopBarItems(items: TopBarItemId[]) {
  try { localStorage.setItem(TOPBAR_ITEMS_CACHE_KEY, JSON.stringify(items)); } catch {}
}

const DEFAULT_RSS_TAB_CACHE_KEY = "tanwords_default_rss_tab_cache";

/** FeedsPage reads this synchronously on mount, before loadFromDB()'s async
 * round-trip resolves, so it doesn't flash "All" then jump to the real default. */
function cachedDefaultRssTab(): RssTabSelection {
  try {
    const raw = localStorage.getItem(DEFAULT_RSS_TAB_CACHE_KEY);
    if (raw === null) return "hackernews";
    const parsed = JSON.parse(raw);
    return parsed === "all" || parsed === "hackernews" || typeof parsed === "number" ? parsed : "hackernews";
  } catch {
    return "hackernews";
  }
}

function cacheDefaultRssTab(tab: RssTabSelection) {
  try { localStorage.setItem(DEFAULT_RSS_TAB_CACHE_KEY, JSON.stringify(tab)); } catch {}
}

const FEEDS_VIEW_MODE_CACHE_KEY = "tanwords_feeds_view_mode_cache";

function cachedFeedsViewMode(): "card" | "list" {
  try {
    return localStorage.getItem(FEEDS_VIEW_MODE_CACHE_KEY) === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

function cacheFeedsViewMode(mode: "card" | "list") {
  try { localStorage.setItem(FEEDS_VIEW_MODE_CACHE_KEY, mode); } catch {}
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
  visibleTopBarItems: cachedTopBarItems(),
  defaultRssTab: cachedDefaultRssTab(),
  feedsViewMode: cachedFeedsViewMode(),
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

  setTopBarItemVisible: (item, visible) => {
    const current = get().visibleTopBarItems;
    const next = visible
      ? DEFAULT_TOPBAR_ITEMS.filter((id) => id === item || current.includes(id))
      : current.filter((id) => id !== item);
    set({ visibleTopBarItems: next });
    cacheTopBarItems(next);
    saveSetting("visible_topbar_items", JSON.stringify(next));
  },

  setDefaultRssTab: (tab) => {
    set({ defaultRssTab: tab });
    cacheDefaultRssTab(tab);
    saveSetting("default_rss_tab", JSON.stringify(tab));
  },

  setFeedsViewMode: (mode) => {
    set({ feedsViewMode: mode });
    cacheFeedsViewMode(mode);
    saveSetting("feeds_view_mode", JSON.stringify(mode));
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
        "visible_topbar_items",
        "default_rss_tab",
        "feeds_view_mode",
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

      let resolvedSidebarTabs = Array.isArray(values.visible_sidebar_tabs)
        ? DEFAULT_SIDEBAR_TABS.filter((id) => (values.visible_sidebar_tabs as unknown as string[]).includes(id))
        : DEFAULT_SIDEBAR_TABS;
      // One-time upgrade: existing installs predate Writing Studio, so their
      // persisted visible-tab list cannot contain it yet.
      if (!localStorage.getItem("tanwords_writing_tab_migrated")) {
        resolvedSidebarTabs = DEFAULT_SIDEBAR_TABS.filter((id) => resolvedSidebarTabs.includes(id));
        localStorage.setItem("tanwords_writing_tab_migrated", "1");
        await invoke("db_set_setting", { key: "visible_sidebar_tabs", value: JSON.stringify(resolvedSidebarTabs) });
      }
      cacheSidebarTabs(resolvedSidebarTabs);
      const resolvedTopBarItems = Array.isArray(values.visible_topbar_items)
        ? DEFAULT_TOPBAR_ITEMS.filter((id) => (values.visible_topbar_items as unknown as string[]).includes(id))
        : DEFAULT_TOPBAR_ITEMS;
      cacheTopBarItems(resolvedTopBarItems);

      const rawDefaultRssTab = values.default_rss_tab as unknown;
      const resolvedDefaultRssTab: RssTabSelection =
        rawDefaultRssTab === "all" || rawDefaultRssTab === "hackernews" || typeof rawDefaultRssTab === "number"
          ? (rawDefaultRssTab as RssTabSelection)
          : "hackernews";
      cacheDefaultRssTab(resolvedDefaultRssTab);

      const resolvedFeedsViewMode: "card" | "list" = values.feeds_view_mode === "list" ? "list" : "card";
      cacheFeedsViewMode(resolvedFeedsViewMode);

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
        visibleTopBarItems: resolvedTopBarItems,
        defaultRssTab: resolvedDefaultRssTab,
        feedsViewMode: resolvedFeedsViewMode,
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
