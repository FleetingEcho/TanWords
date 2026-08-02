import type { StoreApi } from "zustand";
import type { SettingsState } from "./state";
import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_LAYOUT_MODE,
  DOCUMENT_TEXT_COLOR_RE, type Theme, type RssTabSelection,
  type LayoutMode,
} from "./types";
import {
  cacheUiLanguage, cacheSidebarTabs, cacheTopBarItems, cacheDefaultRssTab, cacheFeedsViewMode,
  cacheLayoutMode,
} from "./cache";
import { applyTheme, applyDocumentFontSize, applyDocumentLineHeight, applyDocumentTextColor, applyHighlightColor, parseBannerPosition } from "./domEffects";

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
      "music_folder_path",
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
      "app_background_blur",
      "app_background_visible",
      "document_font_size",
      "document_line_height",
      "document_text_color",
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
      musicFolderPath: values.music_folder_path || "",
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
      appBackgroundBlur: values.app_background_blur !== undefined ? Number(values.app_background_blur) : 20,
      appBackgroundVisible: (values.app_background_visible as unknown) !== false && values.app_background_visible !== "false",
      documentFontSize: Math.min(24, Math.max(12, Number(values.document_font_size) || 16)),
      documentLineHeight: Math.min(2.2, Math.max(1.4, Number(values.document_line_height) || 1.9)),
      documentTextColor: DOCUMENT_TEXT_COLOR_RE.test(values.document_text_color || "")
        ? values.document_text_color
        : "",
      highlightColor: values.highlight_color || DEFAULT_HIGHLIGHT_COLOR,
      isLoaded: true,
    });

    applyTheme(get().theme);
    applyDocumentFontSize(get().documentFontSize);
    applyDocumentLineHeight(get().documentLineHeight);
    applyDocumentTextColor(get().documentTextColor);
    applyHighlightColor(get().highlightColor);
  } catch (e) {
    console.warn("Settings not loaded from DB (may be web mode):", e);
    applyTheme(get().theme);
    set({ isLoaded: true });
  }
}
