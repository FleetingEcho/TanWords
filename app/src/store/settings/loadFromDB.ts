import type { StoreApi } from "zustand";
import type { SettingsState } from "./state";
import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_LAYOUT_MODE, AUTO_LOCK_CHOICES, DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_TERMINAL_BACKGROUND_BLUR, DEFAULT_TERMINAL_BACKGROUND_OPACITY, DEFAULT_TERMINAL_TRANSPARENT,
  DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE,
  DOCUMENT_TEXT_COLOR_RE, type Theme, type RssTabSelection,
  type LayoutMode,
} from "./types";
import {
  cacheUiLanguage, cacheSidebarTabs, cacheTopBarItems, cacheDefaultRssTab, cacheFeedsViewMode,
  cacheLayoutMode,
} from "./cache";
import { applyTheme, applyDocumentFontSize, applyDocumentLineHeight, applyDocumentParagraphSpacing, applyDocumentTextColor, applyHighlightColor, parseBannerPosition } from "./domEffects";

/** Loads every persisted setting from the DB in one pass, resolving each with
 * its default/legacy-format fallback, then applies the DOM-visible ones
 * (theme, document typography, highlight colour). Split out of the store
 * definition purely because it's one long, mostly-linear async function. */
export async function loadSettingsFromDB(set: StoreApi<SettingsState>["setState"], get: StoreApi<SettingsState>["getState"]) {
  try {
    const { invoke } = await import("@/ipc/backend");
    const keys = [
      "theme",
      "default_ai_provider",
      "ui_language",
      "target_level",
      "show_level_badges",
      "custom_enrich_prompt",
      "tts_model_path",
      "tts_voice_id",
      "tts_extra_dirs",
      "tts_speed",
      "show_github_link",
      "visible_sidebar_tabs",
      "visible_topbar_items",
      "layout_mode",
      "default_rss_tab",
      "feeds_view_mode",
      "user_avatar",
      "dashboard_banner",
      "dashboard_banner_position",
      "nickname",
      "app_background_image",
      "lock_screen_image",
      "lock_screen_blur",
      "lock_screen_visible",
      "auto_lock_minutes",
      "app_background_blur",
      "app_background_visible",
      "browser_adblock_enabled",
      "terminal_transparent",
      "terminal_background_blur",
      "terminal_background_opacity",
      "terminal_font_family",
      "terminal_font_size",
      "document_font_size",
      "document_line_height",
      "document_paragraph_spacing",
      "document_text_color",
      "highlight_color",
    ];

    const values: Record<string, string> = {};
    const readDevicePath = async (key: string) => {
      try {
        return (await invoke<string | null>("db_get_device_path", { key })) || "";
      } catch (error) {
        // A device-only preference must never prevent synced preferences from
        // hydrating. This also keeps newer frontends compatible with an older
        // sidecar that does not know a newly introduced device-path key yet.
        console.warn(`Device setting ${key} could not be loaded:`, error);
        return "";
      }
    };
    // Read on its own, unencoded, because it is stored per device — see
    // db/device_paths.rs.
    const musicFolderPath = await readDevicePath("music_folder_path");
    const terminalShellPath = await readDevicePath("terminal_shell_path");
    for (const key of keys) {
      try {
        const val = await invoke<string | null>("db_get_setting", { key });
        if (val) {
          values[key] = JSON.parse(val);
        }
      } catch (error) {
        // Settings are independent rows. A legacy or damaged value should
        // fall back on its own default instead of hiding every valid setting.
        console.warn(`Setting ${key} could not be loaded:`, error);
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
    // One-time upgrade: add the Tools tab for existing installs whose
    // persisted visible-tab list predates it. Like the writing-tab upgrade
    // above, the localStorage flag makes this run exactly once — a user who
    // later hides Tools from Settings stays hidden.
    if (!localStorage.getItem("tanwords_tools_tab_migrated")) {
      if (!resolvedSidebarTabs.includes("tools")) {
        resolvedSidebarTabs = [...resolvedSidebarTabs, "tools"];
      }
      localStorage.setItem("tanwords_tools_tab_migrated", "1");
      await invoke("db_set_setting", { key: "visible_sidebar_tabs", value: JSON.stringify(resolvedSidebarTabs) });
    }
    cacheSidebarTabs(resolvedSidebarTabs);

    const resolvedTopBarItems = Array.isArray(values.visible_topbar_items)
      ? DEFAULT_TOPBAR_ITEMS.filter((id) => (values.visible_topbar_items as unknown as string[]).includes(id))
      : DEFAULT_TOPBAR_ITEMS;
    cacheTopBarItems(resolvedTopBarItems);
    const resolvedLayoutMode: LayoutMode = values.layout_mode === "fixed" ? "fixed" : DEFAULT_LAYOUT_MODE;
    cacheLayoutMode(resolvedLayoutMode);

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
      showLevelBadges: (values.show_level_badges as unknown) !== false && values.show_level_badges !== "false",
      customEnrichPrompt: values.custom_enrich_prompt || "",
      musicFolderPath,
      ttsModelPath: values.tts_model_path || "",
      ttsVoiceId: values.tts_voice_id || "0",
      ttsExtraDirs: Array.isArray(values.tts_extra_dirs) ? values.tts_extra_dirs : [],
      ttsSpeed: Number(values.tts_speed) || 1,
      // JSON.parse turns the stored string into a real boolean; default on.
      showGithubLink: (values.show_github_link as unknown) !== false && values.show_github_link !== "false",
      selectionActions: (values.selection_actions as unknown) !== false && values.selection_actions !== "false",
      visibleSidebarTabs: resolvedSidebarTabs,
      visibleTopBarItems: resolvedTopBarItems,
      layoutMode: resolvedLayoutMode,
      defaultRssTab: resolvedDefaultRssTab,
      feedsViewMode: resolvedFeedsViewMode,
      userAvatar: values.user_avatar || "",
      dashboardBanner: values.dashboard_banner || "",
      dashboardBannerPosition: parseBannerPosition(values.dashboard_banner_position),
      nickname: values.nickname || "",
      appBackgroundImage: values.app_background_image || "",
      lockScreenImage: values.lock_screen_image || "",
      lockScreenBlur: Number(values.lock_screen_blur ?? 0),
      lockScreenVisible: (values.lock_screen_visible as unknown) !== false && values.lock_screen_visible !== "false",
      // Anything not on the offered list (a hand-edited DB, a value from a
      // future build) falls back to off rather than to a surprise interval.
      autoLockMinutes: (AUTO_LOCK_CHOICES as readonly number[]).includes(Number(values.auto_lock_minutes))
        ? Number(values.auto_lock_minutes)
        : DEFAULT_AUTO_LOCK_MINUTES,
      appBackgroundBlur: values.app_background_blur !== undefined ? Number(values.app_background_blur) : 20,
      appBackgroundVisible: (values.app_background_visible as unknown) !== false && values.app_background_visible !== "false",
      browserAdBlockEnabled: (values.browser_adblock_enabled as unknown) !== false && values.browser_adblock_enabled !== "false",
      terminalTransparent: values.terminal_transparent === "true"
        || (values.terminal_transparent as unknown) === true
        || DEFAULT_TERMINAL_TRANSPARENT,
      terminalBackgroundBlur: Number.isFinite(Number(values.terminal_background_blur))
        ? Math.min(30, Math.max(0, Math.round(Number(values.terminal_background_blur))))
        : DEFAULT_TERMINAL_BACKGROUND_BLUR,
      terminalBackgroundOpacity: Number.isFinite(Number(values.terminal_background_opacity))
        ? Math.min(100, Math.max(0, Math.round(Number(values.terminal_background_opacity))))
        : DEFAULT_TERMINAL_BACKGROUND_OPACITY,
      terminalFontFamily: typeof values.terminal_font_family === "string" && values.terminal_font_family.trim()
        ? values.terminal_font_family.trim().slice(0, 120)
        : DEFAULT_TERMINAL_FONT_FAMILY,
      terminalFontSize: Number.isFinite(Number(values.terminal_font_size))
        ? Math.min(32, Math.max(8, Math.round(Number(values.terminal_font_size))))
        : DEFAULT_TERMINAL_FONT_SIZE,
      terminalShellPath,
      documentFontSize: Math.min(24, Math.max(12, Number(values.document_font_size) || 16)),
      documentLineHeight: Math.min(2.2, Math.max(1.4, Number(values.document_line_height) || 1.9)),
      documentParagraphSpacing: Math.min(2, Math.max(0.2, Number(values.document_paragraph_spacing) || 0.8)),
      documentTextColor: DOCUMENT_TEXT_COLOR_RE.test(values.document_text_color || "")
        ? values.document_text_color
        : "",
      highlightColor: values.highlight_color || DEFAULT_HIGHLIGHT_COLOR,
      isLoaded: true,
    });

    applyTheme(get().theme);
    applyDocumentFontSize(get().documentFontSize);
    applyDocumentLineHeight(get().documentLineHeight);
    applyDocumentParagraphSpacing(get().documentParagraphSpacing);
    applyDocumentTextColor(get().documentTextColor);
    applyHighlightColor(get().highlightColor);
  } catch (e) {
    console.warn("Settings not loaded from DB (may be web mode):", e);
    applyTheme(get().theme);
    set({ isLoaded: true });
  }
}
