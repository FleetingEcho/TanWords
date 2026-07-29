import { create } from "zustand";
import type { NavPage } from "@/store/navStore";

export type Theme = "light" | "dark" | "system";
export type SidebarTabId = Exclude<NavPage, "settings">;
export type TopBarItemId = "search" | "context" | "scratch" | "db" | "mcp" | "ai" | "language" | "theme" | "updates" | "github";

/** Feeds page tab selector: a specific RSS feed, "all" of them, or the native Hacker News browser. */
export type RssTabSelection = number | "all" | "hackernews";

export const DEFAULT_SIDEBAR_TABS: SidebarTabId[] = [
  "dashboard", "feeds", "reading", "documents", "vocabulary", "chat", "music",
];
export const DEFAULT_TOPBAR_ITEMS: TopBarItemId[] = [
  "search", "context", "scratch", "db", "mcp", "ai", "language", "theme", "updates", "github",
];

/** The draggable cards on the Dashboard's "Recents" grid. */
export type DashboardWidgetId = "quickActions" | "feedUpdates" | "latestWords" | "recentlyRead" | "recentDocuments";
export interface DashboardWidgetLayout {
  left: DashboardWidgetId[];
  right: DashboardWidgetId[];
}
export const DEFAULT_DASHBOARD_WIDGET_LAYOUT: DashboardWidgetLayout = {
  left: ["quickActions", "feedUpdates", "latestWords"],
  right: ["recentlyRead", "recentDocuments"],
};
const ALL_DASHBOARD_WIDGETS: DashboardWidgetId[] = [
  ...DEFAULT_DASHBOARD_WIDGET_LAYOUT.left,
  ...DEFAULT_DASHBOARD_WIDGET_LAYOUT.right,
];

/** Amber, matching the emphasis colour word notes used before highlights had
 *  their own `==` syntax. Kept in sync with the fallback in index.css. */
export const DEFAULT_HIGHLIGHT_COLOR = "#d97706";

/** Mid-tone hues that stay legible as a translucent wash in both themes. */
export const HIGHLIGHT_PRESETS = ["#d97706", "#eab308", "#22c55e", "#0ea5e9", "#8b5cf6", "#ec4899"] as const;

/** Which part of the dashboard banner survives the crop into its letterbox frame,
 *  as CSS `object-position` percentages. The image itself is stored whole, so this
 *  is the user's answer to "the banner is wider than my photo — show me *this* band". */
export interface BannerPosition {
  x: number;
  y: number;
}

/** What a plain `object-fit: cover` does on its own: dead centre. */
export const DEFAULT_BANNER_POSITION: BannerPosition = { x: 50, y: 50 };

/** Guards against a stored layout that's drifted from `ALL_DASHBOARD_WIDGETS` —
 *  an older install missing a widget added since, or (in principle) corrupt
 *  JSON — by dropping unknown ids and appending any missing ones to "left"
 *  rather than ever silently losing or duplicating a card. */
function sanitizeDashboardLayout(raw: unknown): DashboardWidgetLayout {
  const rawLeft = Array.isArray((raw as Partial<DashboardWidgetLayout>)?.left) ? (raw as DashboardWidgetLayout).left : [];
  const rawRight = Array.isArray((raw as Partial<DashboardWidgetLayout>)?.right) ? (raw as DashboardWidgetLayout).right : [];
  const seen = new Set<DashboardWidgetId>();
  const left = rawLeft.filter((id) => {
    if (!ALL_DASHBOARD_WIDGETS.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const right = rawRight.filter((id) => {
    if (!ALL_DASHBOARD_WIDGETS.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const missing = ALL_DASHBOARD_WIDGETS.filter((id) => !seen.has(id));
  return { left: [...left, ...missing], right };
}

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
  /** Show the project GitHub link in the sidebar footer. */
  showGithubLink: boolean;
  /** Pop the lookup/translate/save toolbar over selected English text. Off
   *  means selecting text does nothing special, anywhere in the app. */
  selectionActions: boolean;
  /** Main navigation tabs visible in the sidebar. Settings is always visible. */
  visibleSidebarTabs: SidebarTabId[];
  /** Order of the Dashboard's draggable widget cards across its two columns. */
  dashboardWidgetLayout: DashboardWidgetLayout;
  /** User-selected controls visible in the global command bar. */
  visibleTopBarItems: TopBarItemId[];
  /** RSS feed tab selected by default when opening Feeds — "all" or a specific feed's id.
   *  Lets a user who mainly reads one source (e.g. Hacker News) skip loading every channel. */
  defaultRssTab: RssTabSelection;
  /** Card = magazine layout with cover art; list = dense one-line-per-entry, for feeds with many items. */
  feedsViewMode: "card" | "list";
  /** User's custom avatar as a data URL, shown in place of the default icon in chat bubbles etc. Empty = default icon. */
  userAvatar: string;
  /** Custom banner image (data URL) shown at the top of the Dashboard page. Empty = no banner.
   *  Stored whole rather than pre-cropped, so its framing stays adjustable and stays
   *  correct however wide the window makes the banner. */
  dashboardBanner: string;
  /** Which band of `dashboardBanner` the user dragged into view. */
  dashboardBannerPosition: BannerPosition;
  /** Shown in the Dashboard greeting ("Good evening, {nickname}"). Empty = just "Good evening". */
  nickname: string;
  /** Custom full-app background image (data URL). Empty = none — just the theme's flat background. */
  appBackgroundImage: string;
  /** Blur radius in px applied to appBackgroundImage. */
  appBackgroundBlur: number;
  /** Whether appBackgroundImage is currently shown. False hides it without
   *  discarding the stored image, so it can be turned back on unchanged. */
  appBackgroundVisible: boolean;
  /** Hex colour (`#rrggbb`) for `==highlighted==` spans in AI-written markdown.
   *  Applied as a CSS custom property, so nothing that renders a highlight has
   *  to know this setting exists. */
  highlightColor: string;
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
  setShowGithubLink: (v: boolean) => void;
  setSelectionActions: (v: boolean) => void;
  setSidebarTabVisible: (tab: SidebarTabId, visible: boolean) => void;
  setDashboardWidgetLayout: (layout: DashboardWidgetLayout) => void;
  setTopBarItemVisible: (item: TopBarItemId, visible: boolean) => void;
  setDefaultRssTab: (tab: RssTabSelection) => void;
  setFeedsViewMode: (mode: "card" | "list") => void;
  setUserAvatar: (dataUrl: string) => void;
  /** Omitting `position` re-centres — a new image arrives without a framing, and
   *  clearing the banner should not leave a stale one behind. */
  setDashboardBanner: (dataUrl: string, position?: BannerPosition) => void;
  setNickname: (name: string) => void;
  setAppBackgroundImage: (dataUrl: string) => void;
  setAppBackgroundBlur: (px: number) => void;
  setAppBackgroundVisible: (visible: boolean) => void;
  setHighlightColor: (hex: string) => void;
  loadFromDB: () => Promise<void>;
}

/** Cached synchronously so the first render uses the right language instead
 * of flashing the wrong one before the async DB round-trip in loadFromDB()
 * resolves. Defaults to English for anyone without a saved preference yet. */
function cachedUiLanguage(): string {
  try {
    return localStorage.getItem("tanwords_language_cache") || "en";
  } catch {
    return "en";
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

const DASHBOARD_LAYOUT_CACHE_KEY = "tanwords_dashboard_widget_layout_cache";

function cachedDashboardLayout(): DashboardWidgetLayout {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_CACHE_KEY);
    return raw ? sanitizeDashboardLayout(JSON.parse(raw)) : DEFAULT_DASHBOARD_WIDGET_LAYOUT;
  } catch {
    return DEFAULT_DASHBOARD_WIDGET_LAYOUT;
  }
}

function cacheDashboardLayout(layout: DashboardWidgetLayout) {
  try {
    localStorage.setItem(DASHBOARD_LAYOUT_CACHE_KEY, JSON.stringify(layout));
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
  showGithubLink: true,
  selectionActions: true,
  visibleSidebarTabs: cachedSidebarTabs(),
  dashboardWidgetLayout: cachedDashboardLayout(),
  visibleTopBarItems: cachedTopBarItems(),
  defaultRssTab: cachedDefaultRssTab(),
  feedsViewMode: cachedFeedsViewMode(),
  userAvatar: "",
  dashboardBanner: "",
  dashboardBannerPosition: DEFAULT_BANNER_POSITION,
  nickname: "",
  appBackgroundImage: "",
  appBackgroundBlur: 20,
  appBackgroundVisible: true,
  highlightColor: DEFAULT_HIGHLIGHT_COLOR,
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


  setSelectionActions: (v) => {
    set({ selectionActions: v });
    saveSetting("selection_actions", JSON.stringify(v));
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

  setDashboardWidgetLayout: (layout) => {
    set({ dashboardWidgetLayout: layout });
    cacheDashboardLayout(layout);
    saveSetting("dashboard_widget_layout", JSON.stringify(layout));
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

  setUserAvatar: (dataUrl) => {
    set({ userAvatar: dataUrl });
    saveSetting("user_avatar", JSON.stringify(dataUrl));
  },

  setDashboardBanner: (dataUrl, position) => {
    const pos = position ?? DEFAULT_BANNER_POSITION;
    set({ dashboardBanner: dataUrl, dashboardBannerPosition: pos });
    saveSetting("dashboard_banner", JSON.stringify(dataUrl));
    saveSetting("dashboard_banner_position", JSON.stringify(pos));
  },

  setNickname: (name) => {
    set({ nickname: name });
    saveSetting("nickname", JSON.stringify(name));
  },

  setAppBackgroundImage: (dataUrl) => {
    set({ appBackgroundImage: dataUrl });
    saveSetting("app_background_image", JSON.stringify(dataUrl));
  },

  setAppBackgroundBlur: (px) => {
    set({ appBackgroundBlur: px });
    saveSetting("app_background_blur", JSON.stringify(px));
  },

  setAppBackgroundVisible: (visible) => {
    set({ appBackgroundVisible: visible });
    saveSetting("app_background_visible", JSON.stringify(visible));
  },

  setHighlightColor: (hex) => {
    set({ highlightColor: hex });
    applyHighlightColor(hex);
    saveSetting("highlight_color", JSON.stringify(hex));
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
        "show_github_link",
        "visible_sidebar_tabs",
        "visible_topbar_items",
        "dashboard_widget_layout",
        "default_rss_tab",
        "feeds_view_mode",
        "user_avatar",
        "dashboard_banner",
        "dashboard_banner_position",
        "nickname",
        "app_background_image",
        "app_background_blur",
        "highlight_color",
      ];

      const values: Record<string, string> = {};
      for (const key of keys) {
        const val = await invoke<string | null>("db_get_setting", { key });
        if (val) {
          values[key] = JSON.parse(val);
        }
      }

      const resolvedUiLanguage = values.ui_language || "en";
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

      const resolvedDashboardLayout = values.dashboard_widget_layout
        ? sanitizeDashboardLayout(values.dashboard_widget_layout)
        : DEFAULT_DASHBOARD_WIDGET_LAYOUT;
      cacheDashboardLayout(resolvedDashboardLayout);

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
        showGithubLink: (values.show_github_link as unknown) !== false && values.show_github_link !== "false",
        selectionActions: (values.selection_actions as unknown) !== false && values.selection_actions !== "false",
        visibleSidebarTabs: resolvedSidebarTabs,
        dashboardWidgetLayout: resolvedDashboardLayout,
        visibleTopBarItems: resolvedTopBarItems,
        defaultRssTab: resolvedDefaultRssTab,
        feedsViewMode: resolvedFeedsViewMode,
        userAvatar: values.user_avatar || "",
        dashboardBanner: values.dashboard_banner || "",
        dashboardBannerPosition: parseBannerPosition(values.dashboard_banner_position),
        nickname: values.nickname || "",
        appBackgroundImage: values.app_background_image || "",
        appBackgroundBlur: values.app_background_blur !== undefined ? Number(values.app_background_blur) : 20,
        appBackgroundVisible: (values.app_background_visible as unknown) !== false && values.app_background_visible !== "false",
        highlightColor: values.highlight_color || DEFAULT_HIGHLIGHT_COLOR,
        isLoaded: true,
      });

      applyTheme(get().theme);
      applyHighlightColor(get().highlightColor);
    } catch (e) {
      console.warn("Settings not loaded from DB (may be web mode):", e);
      applyTheme(get().theme);
      set({ isLoaded: true });
    }
  },
}));

/** Installs that predate the drag-to-position banner have no stored framing — and
 *  their banners were baked as centre crops, so centre is also the honest fallback. */
function parseBannerPosition(raw: unknown): BannerPosition {
  const pos = raw as Partial<BannerPosition> | undefined;
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return DEFAULT_BANNER_POSITION;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return { x: clamp(pos.x), y: clamp(pos.y) };
}

async function saveSetting(key: string, value: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("db_set_setting", { key, value });
  } catch {
    // Web mode fallback
    localStorage.setItem(`tanwords_${key}`, value);
  }
}

/** Pushes the chosen colour into the two custom properties <mark> reads (see
 *  index.css). The background is the same colour at 20% alpha via an 8-digit
 *  hex rather than color-mix()/hsl-slash, so it works on every WebView version
 *  Tauri ships against. A malformed stored value falls back to the default
 *  instead of writing an invalid property that would silently disable
 *  highlights. */
function applyHighlightColor(hex: string) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_HIGHLIGHT_COLOR;
  const root = document.documentElement;
  root.style.setProperty("--highlight", safe);
  root.style.setProperty("--highlight-bg", `${safe}33`);
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
