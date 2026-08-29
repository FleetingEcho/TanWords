import { create } from "zustand";
import { isDesktopHost } from "@/platform";
import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, DEFAULT_HIGHLIGHT_COLOR, DEFAULT_BANNER_POSITION, BANNER_ZOOM_MIN, BANNER_ZOOM_MAX,
  DEFAULT_LAYOUT_MODE, DEFAULT_STARTUP_DESTINATION, DEFAULT_AUTO_LOCK_MINUTES, DEFAULT_DSH_PORT, DEFAULT_DSH_BACKGROUND_OPACITY, DEFAULT_DSH_BACKGROUND_BLUR, DEFAULT_DSH_TOOLBAR_VISIBLE, DSH_IDLE_STOP_CHOICES, DEFAULT_DSH_IDLE_STOP_MINUTES, DEFAULT_DSH_GLOBAL_SHORTCUT,
  DEFAULT_TERMINAL_BACKGROUND_BLUR, DEFAULT_TERMINAL_BACKGROUND_OPACITY, DEFAULT_TERMINAL_TRANSPARENT,
  DEFAULT_TERMINAL_BACKGROUND_COLOR, DEFAULT_TERMINAL_TEXT_COLOR,
  DEFAULT_TERMINAL_COLOR_SCHEME, TERMINAL_COLOR_SCHEME_COLORS, TERMINAL_COLOR_SCHEME_EFFECTS,
  DEFAULT_TERMINAL_CUSTOM_APPEARANCE,
  DEFAULT_TERMINAL_RENDERER, DEFAULT_TERMINAL_ENGINE,
  DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_FONT_WEIGHT,
  DOCUMENT_TEXT_COLOR_RE, normalizeHexColor, normalizeTerminalFontWeight,
  type Theme, type SidebarTabId, type TopBarItemId, type RssTabSelection, type LayoutMode, type StartupDestination,
  type BannerPosition, type TerminalRenderer, type TerminalEngine, type TerminalColorScheme, type TerminalCustomAppearance,
} from "./settings/types";
import {
  cachedUiLanguage, cacheUiLanguage, cachedSidebarTabs, cacheSidebarTabs,
  cachedTopBarItems, cacheTopBarItems,
  cachedSidebarTabOrder, cacheSidebarTabOrder, cachedTopBarItemOrder, cacheTopBarItemOrder,
  cachedDefaultRssTab, cacheDefaultRssTab, cachedFeedsViewMode, cacheFeedsViewMode, saveSetting, saveSettings, saveSettingDebounced,
  cachedLayoutMode, cacheLayoutMode,
} from "./settings/cache";
import { applyTheme, applyDocumentFontSize, applyDocumentLineHeight, applyDocumentParagraphSpacing, applyDocumentTextColor, applyHighlightColor } from "./settings/domEffects";
import { loadSettingsFromDB } from "./settings/loadFromDB";
import type { SettingsState } from "./settings/state";
import { createTerminalSetters } from "./settingsStoreTerminal";

export type {
  Theme, SidebarTabId, TopBarItemId, RssTabSelection, BannerPosition, StartupDestination, TerminalRenderer, TerminalEngine, TerminalColorScheme, TerminalCustomAppearance,
} from "./settings/types";
export {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS,
  DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_PRESETS, DEFAULT_BANNER_POSITION, BANNER_ZOOM_MIN, BANNER_ZOOM_MAX, DEFAULT_LAYOUT_MODE, DEFAULT_STARTUP_DESTINATION,
  AUTO_LOCK_CHOICES, DEFAULT_AUTO_LOCK_MINUTES, DEFAULT_DSH_PORT, DEFAULT_DSH_BACKGROUND_OPACITY, DEFAULT_DSH_BACKGROUND_BLUR, DEFAULT_DSH_TOOLBAR_VISIBLE, DSH_IDLE_STOP_CHOICES, DEFAULT_DSH_IDLE_STOP_MINUTES, DEFAULT_DSH_GLOBAL_SHORTCUT,
  DEFAULT_TERMINAL_BACKGROUND_BLUR, DEFAULT_TERMINAL_BACKGROUND_OPACITY, DEFAULT_TERMINAL_TRANSPARENT,
  DEFAULT_TERMINAL_BACKGROUND_COLOR, DEFAULT_TERMINAL_TEXT_COLOR,
  DEFAULT_TERMINAL_COLOR_SCHEME, TERMINAL_COLOR_SCHEME_COLORS, TERMINAL_COLOR_SCHEME_EFFECTS,
  DEFAULT_TERMINAL_CUSTOM_APPEARANCE,
  DEFAULT_TERMINAL_RENDERER,
  DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_FONT_WEIGHT,
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
  ttsRemoteProviderId: "",
  ttsRemoteVoice: "",
  asrModelPath: "",
  asrExtraDirs: [],
  showGithubLink: true,
  selectionActions: true,
  visibleSidebarTabs: cachedSidebarTabs(),
  visibleTopBarItems: cachedTopBarItems(),
  sidebarTabOrder: cachedSidebarTabOrder(),
  topBarItemOrder: cachedTopBarItemOrder(),
  layoutMode: cachedLayoutMode(),
  startupDestination: DEFAULT_STARTUP_DESTINATION,
  defaultRssTab: cachedDefaultRssTab(),
  feedsViewMode: cachedFeedsViewMode(),
  userAvatar: "",
  userAvatarPosition: DEFAULT_BANNER_POSITION,
  dashboardBanner: "",
  dashboardBannerPosition: DEFAULT_BANNER_POSITION,
  dashboardBannerVisible: true,
  nickname: "",
  appBackgroundImage: "",
  appBackgroundImages: [],
  appBackgroundImageIndex: 0,
  appBackgroundImagePositions: [],
  appBackgroundImagePosition: DEFAULT_BANNER_POSITION,
  lockScreenImage: "",
  lockScreenImagePosition: DEFAULT_BANNER_POSITION,
  lockScreenBlur: 0,
  lockScreenDimming: 0,
  lockScreenVisible: true,
  autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
  appBackgroundBlur: 20,
  appBackgroundDimming: 0,
  appBackgroundVisible: true,
  browserAdBlockEnabled: true,
  dshPort: DEFAULT_DSH_PORT,
  dshBackgroundOpacity: DEFAULT_DSH_BACKGROUND_OPACITY,
  dshBackgroundBlur: DEFAULT_DSH_BACKGROUND_BLUR,
  dshToolbarVisible: DEFAULT_DSH_TOOLBAR_VISIBLE,
  dshIdleStopMinutes: DEFAULT_DSH_IDLE_STOP_MINUTES,
  dshGlobalShortcut: DEFAULT_DSH_GLOBAL_SHORTCUT,
  terminalTransparent: DEFAULT_TERMINAL_TRANSPARENT,
  terminalBackgroundBlur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
  terminalBackgroundOpacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  terminalBackgroundColor: DEFAULT_TERMINAL_BACKGROUND_COLOR,
  terminalTextColor: DEFAULT_TERMINAL_TEXT_COLOR,
  terminalColorScheme: DEFAULT_TERMINAL_COLOR_SCHEME,
  terminalCustomAppearance: DEFAULT_TERMINAL_CUSTOM_APPEARANCE,
  terminalRenderer: DEFAULT_TERMINAL_RENDERER,
  terminalEngine: DEFAULT_TERMINAL_ENGINE,
  terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  terminalFontWeight: DEFAULT_TERMINAL_FONT_WEIGHT,
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

  setSidebarTabOrder: (order) => {
    set({ sidebarTabOrder: order });
    cacheSidebarTabOrder(order);
    saveSetting("sidebar_tab_order", JSON.stringify(order));
  },

  setTopBarItemOrder: (order) => {
    set({ topBarItemOrder: order });
    cacheTopBarItemOrder(order);
    saveSetting("topbar_item_order", JSON.stringify(order));
  },

  setLayoutMode: (mode) => {
    set({ layoutMode: mode });
    cacheLayoutMode(mode);
    saveSetting("layout_mode", JSON.stringify(mode));
  },

  setStartupDestination: (destination) => {
    set({ startupDestination: destination });
    saveSetting("startup_destination", JSON.stringify(destination));
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

  setUserAvatar: (dataUrl, position) => {
    const pos = position ?? DEFAULT_BANNER_POSITION;
    set({ userAvatar: dataUrl, userAvatarPosition: pos });
    saveSetting("user_avatar", JSON.stringify(dataUrl));
    saveSetting("user_avatar_position", JSON.stringify(pos));
  },

  setDashboardBanner: (dataUrl, position) => {
    const pos = position ?? DEFAULT_BANNER_POSITION;
    set({ dashboardBanner: dataUrl, dashboardBannerPosition: pos });
    saveSetting("dashboard_banner", JSON.stringify(dataUrl));
    saveSetting("dashboard_banner_position", JSON.stringify(pos));
  },

  setDashboardBannerVisible: (visible) => {
    set({ dashboardBannerVisible: visible });
    saveSetting("dashboard_banner_visible", JSON.stringify(visible));
  },

  setNickname: (name) => {
    set({ nickname: name });
    saveSetting("nickname", JSON.stringify(name));
  },

  setAppBackgroundImage: (dataUrl) => {
    const images = dataUrl ? [dataUrl] : [];
    const positions = dataUrl ? [DEFAULT_BANNER_POSITION] : [];
    // Capture the previous gallery before set() so unchanged slots are skipped.
    const prev = get().appBackgroundImages;
    set({
      appBackgroundImage: dataUrl,
      appBackgroundImages: images,
      appBackgroundImageIndex: 0,
      appBackgroundImagePositions: positions,
      appBackgroundImagePosition: DEFAULT_BANNER_POSITION,
    });
    // One image per settings row so a last-writer-wins sync (Postgres) clobbers
    // only the changed slot instead of the whole gallery — see loadFromDB.
    const fixedPositions = Array.from({ length: 5 }, () => DEFAULT_BANNER_POSITION);
    const entries: Array<[string, string]> = [
      ["app_background_image", JSON.stringify(dataUrl)],
      ["app_background_images", JSON.stringify(images)],
      ["app_background_image_index", "0"],
      ["app_background_image_positions", JSON.stringify(fixedPositions)],
    ];
    for (let i = 0; i < 5; i++) {
      const newVal = i < images.length ? images[i] : "";
      const oldVal = i < prev.length ? prev[i] : "";
      if (newVal !== oldVal) entries.push([`app_background_image_${i}`, JSON.stringify(newVal)]);
    }
    void saveSettings(entries);
  },

  setAppBackgroundImages: (images, activeIndex, positions = []) => {
    const nextImages = images.filter((image) => typeof image === "string" && image.length > 0).slice(0, 5);
    const nextPositions = nextImages.map((_, index) => {
      const position = positions[index];
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return DEFAULT_BANNER_POSITION;
      return {
        x: Math.min(100, Math.max(0, position.x)),
        y: Math.min(100, Math.max(0, position.y)),
        // Absent/invalid = pre-zoom stored position or a fresh default — both
        // mean "no extra zoom".
        scale: Number.isFinite(position.scale)
          ? Math.min(BANNER_ZOOM_MAX, Math.max(BANNER_ZOOM_MIN, position.scale as number))
          : BANNER_ZOOM_MIN,
      };
    });
    const nextIndex = nextImages.length === 0
      ? 0
      : Math.min(nextImages.length - 1, Math.max(0, Math.round(activeIndex)));
    const activeImage = nextImages[nextIndex] || "";
    const activePosition = nextPositions[nextIndex] || DEFAULT_BANNER_POSITION;
    // Capture the previous gallery before set() so unchanged slots are skipped.
    const prev = get().appBackgroundImages;
    set({
      appBackgroundImage: activeImage,
      appBackgroundImages: nextImages,
      appBackgroundImageIndex: nextIndex,
      appBackgroundImagePositions: nextPositions,
      appBackgroundImagePosition: activePosition,
    });
    // Persist each wallpaper in its own settings row keyed by slot. Adding or
    // replacing one image writes only that slot, so a concurrent last-writer
    // sync (Postgres) can no longer overwrite the other images — the bug where a
    // one-image device clobbered a five-image device's whole gallery. Empty
    // slots are stored as "" so a shrink clears the trailing rows. Positions
    // are kept slot-aligned in a fixed-length row so load can re-map them even
    // after a partial sync leaves a gap. The legacy single-array and active
    // rows are still written for back-compat with older builds.
    const fixedPositions = Array.from({ length: 5 }, (_, i) =>
      i < nextPositions.length ? nextPositions[i] : DEFAULT_BANNER_POSITION);
    const entries: Array<[string, string]> = [
      ["app_background_image", JSON.stringify(activeImage)],
      ["app_background_images", JSON.stringify(nextImages)],
      ["app_background_image_index", JSON.stringify(nextIndex)],
      ["app_background_image_positions", JSON.stringify(fixedPositions)],
    ];
    for (let i = 0; i < 5; i++) {
      const newVal = i < nextImages.length ? nextImages[i] : "";
      const oldVal = i < prev.length ? prev[i] : "";
      if (newVal !== oldVal) entries.push([`app_background_image_${i}`, JSON.stringify(newVal)]);
    }
    void saveSettings(entries);
  },

  setLockScreenImage: (dataUrl, position) => {
    const pos = position ?? DEFAULT_BANNER_POSITION;
    set({ lockScreenImage: dataUrl, lockScreenImagePosition: pos });
    saveSetting("lock_screen_image", JSON.stringify(dataUrl));
    saveSetting("lock_screen_image_position", JSON.stringify(pos));
  },

  setLockScreenBlur: (value) => {
    set({ lockScreenBlur: value });
    saveSettingDebounced("lock_screen_blur", JSON.stringify(value));
  },

  setLockScreenDimming: (percent) => {
    const value = Math.min(80, Math.max(0, Math.round(percent)));
    set({ lockScreenDimming: value });
    saveSettingDebounced("lock_screen_dimming", JSON.stringify(value));
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

  setAppBackgroundDimming: (percent) => {
    const value = Math.min(80, Math.max(0, Math.round(percent)));
    set({ appBackgroundDimming: value });
    saveSettingDebounced("app_background_dimming", JSON.stringify(value));
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

  setDshPort: (port) => {
    // 0 is the standard-port sentinel (3080), so it stays valid; any
    // other value is clamped to a real TCP port. A bad stored value can never
    // reach `dsh --port` this way.
    const p = Number.isFinite(port) && port > 0
      ? Math.min(65535, Math.floor(port))
      : 0;
    set({ dshPort: p });
    saveSetting("dsh_port", JSON.stringify(p));
  },

  setDshBackgroundOpacity: (percent) => {
    const value = Math.min(100, Math.max(0, Math.round(percent)));
    set({ dshBackgroundOpacity: value });
    saveSettingDebounced("dsh_background_opacity", JSON.stringify(value));
  },

  setDshBackgroundBlur: (strength) => {
    const value = Math.min(100, Math.max(0, Math.round(strength)));
    set({ dshBackgroundBlur: value });
    saveSettingDebounced("dsh_background_blur", JSON.stringify(value));
  },

  setDshToolbarVisible: (visible) => {
    set({ dshToolbarVisible: visible });
    saveSetting("dsh_toolbar_visible", JSON.stringify(visible));
  },

  setDshIdleStopMinutes: (minutes) => {
    // Anything not on the offered list (a hand-edited DB, a future build's
    // removed choice) falls back to off rather than a value under the
    // 10-minute floor the picker enforces.
    const value = (DSH_IDLE_STOP_CHOICES as readonly number[]).includes(minutes)
      ? minutes
      : DEFAULT_DSH_IDLE_STOP_MINUTES;
    set({ dshIdleStopMinutes: value });
    saveSetting("dsh_idle_stop_minutes", JSON.stringify(value));
    // Pushed to main by useTraySync, which reacts to this same field (both
    // on mount and on every change) — no IPC call needed here.
  },

  setDshGlobalShortcut: (accelerator) => {
    set({ dshGlobalShortcut: accelerator });
    saveSetting("dsh_global_shortcut", JSON.stringify(accelerator));
    // Registration itself (and re-registering on every app boot) happens in
    // useTraySync — it reacts to this same field, so this setter doesn't
    // need its own IPC round-trip.
  },
  ...createTerminalSetters(set, get),

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
    // Device-scoped, not synced: three machines signed into one Postgres account
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

  setTtsRemoteProviderId: (id) => {
    set({ ttsRemoteProviderId: id });
    saveSetting("tts_remote_provider_id", JSON.stringify(id));
  },

  setTtsRemoteVoice: (voice) => {
    set({ ttsRemoteVoice: voice });
    saveSetting("tts_remote_voice", JSON.stringify(voice));
  },

  setTtsExtraDirs: (dirs) => {
    set({ ttsExtraDirs: dirs });
    saveSetting("tts_extra_dirs", JSON.stringify(dirs));
  },

  setTtsSpeed: (speed) => {
    set({ ttsSpeed: speed });
    saveSetting("tts_speed", JSON.stringify(speed));
  },

  setAsrModelPath: (path) => {
    set({ asrModelPath: path });
    saveSetting("asr_model_path", JSON.stringify(path));
  },

  setAsrExtraDirs: (dirs) => {
    set({ asrExtraDirs: dirs });
    saveSetting("asr_extra_dirs", JSON.stringify(dirs));
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
