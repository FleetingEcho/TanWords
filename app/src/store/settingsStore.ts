import { create } from "zustand";
import { isDesktopHost } from "@/platform";
import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, DEFAULT_HIGHLIGHT_COLOR, DEFAULT_BANNER_POSITION,
  DEFAULT_LAYOUT_MODE, DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_TERMINAL_BACKGROUND_BLUR, DEFAULT_TERMINAL_BACKGROUND_OPACITY, DEFAULT_TERMINAL_TRANSPARENT,
  DEFAULT_TERMINAL_BACKGROUND_COLOR,
  DEFAULT_TERMINAL_RENDERER,
  DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE,
  DOCUMENT_TEXT_COLOR_RE, normalizeHexColor,
  type Theme, type SidebarTabId, type TopBarItemId, type RssTabSelection, type LayoutMode,
  type BannerPosition, type TerminalRenderer,
} from "./settings/types";
import {
  cachedUiLanguage, cacheUiLanguage, cachedSidebarTabs, cacheSidebarTabs,
  cachedTopBarItems, cacheTopBarItems,
  cachedDefaultRssTab, cacheDefaultRssTab, cachedFeedsViewMode, cacheFeedsViewMode, saveSetting, saveSettingDebounced,
  cachedLayoutMode, cacheLayoutMode,
} from "./settings/cache";
import { applyTheme, applyDocumentFontSize, applyDocumentLineHeight, applyDocumentParagraphSpacing, applyDocumentTextColor, applyHighlightColor } from "./settings/domEffects";
import { loadSettingsFromDB } from "./settings/loadFromDB";
import type { SettingsState } from "./settings/state";

export type {
  Theme, SidebarTabId, TopBarItemId, RssTabSelection, BannerPosition, TerminalRenderer,
} from "./settings/types";
export {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS,
  DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_PRESETS, DEFAULT_BANNER_POSITION, DEFAULT_LAYOUT_MODE,
  AUTO_LOCK_CHOICES, DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_TERMINAL_BACKGROUND_BLUR, DEFAULT_TERMINAL_BACKGROUND_OPACITY, DEFAULT_TERMINAL_TRANSPARENT,
  DEFAULT_TERMINAL_BACKGROUND_COLOR,
  DEFAULT_TERMINAL_RENDERER,
  DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE,
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
  browserAdBlockEnabled: true,
  terminalTransparent: DEFAULT_TERMINAL_TRANSPARENT,
  terminalBackgroundBlur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
  terminalBackgroundOpacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  terminalBackgroundColor: DEFAULT_TERMINAL_BACKGROUND_COLOR,
  terminalRenderer: DEFAULT_TERMINAL_RENDERER,
  terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  terminalShellPath: "",
  documentFontSize: 16,
  documentLineHeight: 1.9,
  documentParagraphSpacing: 0.8,
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

  setBrowserAdBlockEnabled: (enabled) => {
    set({ browserAdBlockEnabled: enabled });
    saveSetting("browser_adblock_enabled", JSON.stringify(enabled));
    // The actual blocker lives in the Electron main process (it hooks the
    // panel session's webRequest). Keep it in sync; on web this invoke is a
    // no-op (the Browser page renders iframes there, which can't be blocked).
    if (isDesktopHost) {
      void import("@/ipc/backend").then(({ invoke }) =>
        invoke("browser_set_adblock_enabled", { enabled }));
    }
  },

  setTerminalTransparent: (enabled) => {
    set({ terminalTransparent: enabled });
    saveSetting("terminal_transparent", JSON.stringify(enabled));
  },

  setTerminalBackgroundBlur: (px) => {
    const value = Math.min(30, Math.max(0, Math.round(px)));
    set({ terminalBackgroundBlur: value });
    saveSettingDebounced("terminal_background_blur", JSON.stringify(value));
  },

  setTerminalBackgroundOpacity: (percent) => {
    const value = Math.min(100, Math.max(0, Math.round(percent)));
    set({ terminalBackgroundOpacity: value });
    saveSettingDebounced("terminal_background_opacity", JSON.stringify(value));
  },

  setTerminalBackgroundColor: (hex) => {
    const value = normalizeHexColor(hex);
    set({ terminalBackgroundColor: value });
    saveSettingDebounced("terminal_background_color", JSON.stringify(value));
  },

  setTerminalRenderer: (renderer) => {
    set({ terminalRenderer: renderer });
    saveSetting("terminal_renderer", JSON.stringify(renderer));
  },

  setTerminalFontFamily: (family) => {
    const value = family.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120)
      || DEFAULT_TERMINAL_FONT_FAMILY;
    set({ terminalFontFamily: value });
    saveSettingDebounced("terminal_font_family", JSON.stringify(value));
  },

  setTerminalFontSize: (px) => {
    const value = Math.min(32, Math.max(8, Math.round(px)));
    set({ terminalFontSize: value });
    saveSettingDebounced("terminal_font_size", JSON.stringify(value));
  },

  setTerminalShellPath: (path) => {
    const value = path.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 2048);
    set({ terminalShellPath: value });
    // Shell executables are machine-specific and must not sync across devices.
    void import("@/ipc/backend").then(({ invoke }) =>
      invoke("db_set_device_path", { key: "terminal_shell_path", value }));
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

  setDocumentParagraphSpacing: (value) => {
    const spacing = Math.min(2, Math.max(0.2, Math.round(value * 10) / 10));
    set({ documentParagraphSpacing: spacing });
    applyDocumentParagraphSpacing(spacing);
    // Slider-bound (DocumentsSection): persist trailing-edge, not per drag tick.
    saveSettingDebounced("document_paragraph_spacing", JSON.stringify(spacing));
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
    // Device-scoped, not synced: three machines signed into one Turso account
    // each have their own music library, and a shared row means whichever one
    // saved last points the other two at a folder that isn't there.
    void import("@/ipc/backend").then(({ invoke }) =>
      invoke("db_set_device_path", { key: "music_folder_path", value: path }));
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
