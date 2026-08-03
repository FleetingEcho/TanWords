import { create } from "zustand";
import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, DEFAULT_HIGHLIGHT_COLOR, DEFAULT_BANNER_POSITION,
  DEFAULT_LAYOUT_MODE, DEFAULT_AUTO_LOCK_MINUTES,
  DOCUMENT_TEXT_COLOR_RE,
  type Theme, type SidebarTabId, type TopBarItemId, type RssTabSelection, type LayoutMode,
  type BannerPosition,
} from "./settings/types";
import {
  cachedUiLanguage, cacheUiLanguage, cachedSidebarTabs, cacheSidebarTabs,
  cachedTopBarItems, cacheTopBarItems,
  cachedDefaultRssTab, cacheDefaultRssTab, cachedFeedsViewMode, cacheFeedsViewMode, saveSetting, saveSettingDebounced,
  cachedLayoutMode, cacheLayoutMode,
} from "./settings/cache";
import { applyTheme, applyDocumentFontSize, applyDocumentLineHeight, applyDocumentTextColor, applyHighlightColor } from "./settings/domEffects";
import { loadSettingsFromDB } from "./settings/loadFromDB";
import type { SettingsState } from "./settings/state";

export type {
  Theme, SidebarTabId, TopBarItemId, RssTabSelection, BannerPosition,
} from "./settings/types";
export {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS,
  DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_PRESETS, DEFAULT_BANNER_POSITION, DEFAULT_LAYOUT_MODE,
  AUTO_LOCK_CHOICES, DEFAULT_AUTO_LOCK_MINUTES,
} from "./settings/types";
export type { SettingsState } from "./settings/state";

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "system",
  defaultAiProvider: "openai",
  uiLanguage: cachedUiLanguage(),
  targetLevels: ["C1"],
  showLevelBadges: true,
  customEnrichPrompt: "",
  musicFolderPath: "",
  ttsModelPath: "",
  ttsVoiceId: "0",
  ttsExtraDirs: [],
  ttsSpeed: 1,
  showGithubLink: true,
  selectionActions: true,
  visibleSidebarTabs: cachedSidebarTabs(),
  visibleTopBarItems: cachedTopBarItems(),
  layoutMode: cachedLayoutMode(),
  defaultRssTab: cachedDefaultRssTab(),
  feedsViewMode: cachedFeedsViewMode(),
  userAvatar: "",
  dashboardBanner: "",
  dashboardBannerPosition: DEFAULT_BANNER_POSITION,
  nickname: "",
  appBackgroundImage: "",
  lockScreenImage: "",
  lockScreenBlur: 0,
  lockScreenVisible: true,
  autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
  appBackgroundBlur: 20,
  appBackgroundVisible: true,
  documentFontSize: 16,
  documentLineHeight: 1.9,
  documentTextColor: "",
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

  setTopBarItemVisible: (item, visible) => {
    const current = get().visibleTopBarItems;
    const next = visible
      ? DEFAULT_TOPBAR_ITEMS.filter((id) => id === item || current.includes(id))
      : current.filter((id) => id !== item);
    set({ visibleTopBarItems: next });
    cacheTopBarItems(next);
    saveSetting("visible_topbar_items", JSON.stringify(next));
  },

  setLayoutMode: (mode) => {
    set({ layoutMode: mode });
    cacheLayoutMode(mode);
    saveSetting("layout_mode", JSON.stringify(mode));
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

  setLockScreenImage: (dataUrl) => {
    set({ lockScreenImage: dataUrl });
    saveSetting("lock_screen_image", JSON.stringify(dataUrl));
  },

  setLockScreenBlur: (value) => {
    set({ lockScreenBlur: value });
    saveSettingDebounced("lock_screen_blur", JSON.stringify(value));
  },

  setLockScreenVisible: (value) => {
    set({ lockScreenVisible: value });
    saveSetting("lock_screen_visible", JSON.stringify(value));
  },

  setAutoLockMinutes: (minutes) => {
    set({ autoLockMinutes: minutes });
    saveSetting("auto_lock_minutes", JSON.stringify(minutes));
  },

  setAppBackgroundBlur: (px) => {
    set({ appBackgroundBlur: px });
    // Slider-bound (GeneralSection): persist trailing-edge, not per drag tick.
    saveSettingDebounced("app_background_blur", JSON.stringify(px));
  },

  setAppBackgroundVisible: (visible) => {
    set({ appBackgroundVisible: visible });
    saveSetting("app_background_visible", JSON.stringify(visible));
  },

  setDocumentFontSize: (px) => {
    const size = Math.min(24, Math.max(12, Math.round(px)));
    set({ documentFontSize: size });
    applyDocumentFontSize(size);
    // Slider-bound (DocumentsSection): persist trailing-edge, not per drag tick.
    saveSettingDebounced("document_font_size", JSON.stringify(size));
  },

  setDocumentLineHeight: (value) => {
    const lineHeight = Math.min(2.2, Math.max(1.4, Math.round(value * 10) / 10));
    set({ documentLineHeight: lineHeight });
    applyDocumentLineHeight(lineHeight);
    // Slider-bound (DocumentsSection): persist trailing-edge, not per drag tick.
    saveSettingDebounced("document_line_height", JSON.stringify(lineHeight));
  },

  setDocumentTextColor: (hex) => {
    const color = DOCUMENT_TEXT_COLOR_RE.test(hex) ? hex : "";
    set({ documentTextColor: color });
    applyDocumentTextColor(color);
    saveSetting("document_text_color", JSON.stringify(color));
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

  setShowLevelBadges: (visible) => {
    set({ showLevelBadges: visible });
    saveSetting("show_level_badges", JSON.stringify(visible));
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

  loadFromDB: () => loadSettingsFromDB(set, get),
}));

// Listen for system theme changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const { theme } = useSettingsStore.getState();
  if (theme === "system") {
    applyTheme("system");
  }
});
