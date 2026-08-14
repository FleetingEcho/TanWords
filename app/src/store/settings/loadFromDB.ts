import type { StoreApi } from "zustand";
import type { SettingsState } from "./state";
import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_LAYOUT_MODE, AUTO_LOCK_CHOICES, DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_TERMINAL_BACKGROUND_BLUR, DEFAULT_TERMINAL_BACKGROUND_OPACITY, DEFAULT_TERMINAL_TRANSPARENT,
  GLASS_LIGHT_BACKGROUND_OPACITY,
  DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_WEIGHT, normalizeTerminalFontWeight,
  DEFAULT_TERMINAL_TEXT_COLOR,
  DEFAULT_TERMINAL_COLOR_SCHEME,
  TERMINAL_COLOR_SCHEME_COLORS,
  TERMINAL_COLOR_SCHEME_EFFECTS,
  TERMINAL_COLOR_SCHEME_IDS,
  DEFAULT_TERMINAL_RENDERER,
  DOCUMENT_TEXT_COLOR_RE, normalizeHexColor, type Theme, type RssTabSelection,
  type LayoutMode, type TerminalRenderer, type TerminalColorScheme, type TerminalCustomAppearance,
} from "./types";
import {
  cacheUiLanguage, cacheSidebarTabs, cacheTopBarItems, cacheDefaultRssTab, cacheFeedsViewMode,
  cacheLayoutMode,
} from "./cache";
import { applyTheme, applyDocumentFontSize, applyDocumentLineHeight, applyDocumentParagraphSpacing, applyDocumentTextColor, applyHighlightColor, parseBannerPosition } from "./domEffects";
import { isDesktopHost } from "@/platform";

function parseTerminalCustomAppearance(
  raw: unknown,
  fallback: TerminalCustomAppearance,
): TerminalCustomAppearance {
  const value = raw && typeof raw === "object" ? raw as Partial<TerminalCustomAppearance> : {};
  const blur = Number(value.blur);
  const opacity = Number(value.opacity);
  return {
    backgroundColor: normalizeHexColor(value.backgroundColor || "", fallback.backgroundColor),
    textColor: normalizeHexColor(value.textColor || "", fallback.textColor),
    transparent: typeof value.transparent === "boolean" ? value.transparent : fallback.transparent,
    blur: Number.isFinite(blur) ? Math.min(30, Math.max(0, Math.round(blur))) : fallback.blur,
    opacity: Number.isFinite(opacity) ? Math.min(100, Math.max(0, Math.round(opacity))) : fallback.opacity,
  };
}

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
      "app_background_images",
      "app_background_image_index",
      "app_background_image_positions",
      "lock_screen_image",
      "lock_screen_blur",
      "lock_screen_visible",
      "auto_lock_minutes",
      "app_background_blur",
      "app_background_dimming",
      "app_background_visible",
      "browser_adblock_enabled",
      "terminal_transparent",
      "terminal_background_blur",
      "terminal_background_opacity",
      "terminal_background_color",
      "terminal_text_color",
      "terminal_color_scheme",
      "terminal_custom_appearance",
      "terminal_renderer",
      "terminal_font_family",
      "terminal_font_size",
      "terminal_font_weight",
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
    // Terminal used to be a card inside Tools. Give existing desktop installs
    // its new standalone navigation entry once, while still respecting a user
    // who hides it later in Settings.
    if (isDesktopHost && !localStorage.getItem("tanwords_terminal_tab_migrated")) {
      if (!resolvedSidebarTabs.includes("terminal")) {
        const toolsIndex = resolvedSidebarTabs.indexOf("tools");
        resolvedSidebarTabs = [...resolvedSidebarTabs];
        resolvedSidebarTabs.splice(toolsIndex < 0 ? resolvedSidebarTabs.length : toolsIndex, 0, "terminal");
      }
      localStorage.setItem("tanwords_terminal_tab_migrated", "1");
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

    const hasSavedBackgroundGallery = Array.isArray(values.app_background_images);
    const savedBackgroundImages = hasSavedBackgroundGallery
      ? (values.app_background_images as unknown as unknown[])
        .filter((image): image is string => typeof image === "string" && image.length > 0)
        .slice(0, 5)
      : [];
    const legacyBackgroundImage = typeof values.app_background_image === "string"
      ? values.app_background_image
      : "";
    const resolvedBackgroundImages = hasSavedBackgroundGallery
      ? savedBackgroundImages
      : legacyBackgroundImage ? [legacyBackgroundImage] : [];
    const savedBackgroundIndex = Number(values.app_background_image_index);
    const resolvedBackgroundIndex = resolvedBackgroundImages.length === 0
      ? 0
      : Math.min(
        resolvedBackgroundImages.length - 1,
        Math.max(0, Number.isFinite(savedBackgroundIndex) ? Math.round(savedBackgroundIndex) : 0),
      );
    const resolvedBackgroundImage = resolvedBackgroundImages[resolvedBackgroundIndex] || "";
    const savedBackgroundPositions = Array.isArray(values.app_background_image_positions)
      ? values.app_background_image_positions as unknown as unknown[]
      : [];
    const resolvedBackgroundPositions = resolvedBackgroundImages.map((_, index) =>
      parseBannerPosition(savedBackgroundPositions[index]));
    const resolvedBackgroundPosition = resolvedBackgroundPositions[resolvedBackgroundIndex]
      || parseBannerPosition(undefined);
    if (!hasSavedBackgroundGallery && legacyBackgroundImage) {
      await invoke("db_set_setting", {
        key: "app_background_images",
        value: JSON.stringify(resolvedBackgroundImages),
      });
      await invoke("db_set_setting", { key: "app_background_image_index", value: "0" });
      await invoke("db_set_setting", {
        key: "app_background_image_positions",
        value: JSON.stringify(resolvedBackgroundPositions),
      });
    }

    const savedTerminalColorScheme = values.terminal_color_scheme as TerminalColorScheme | undefined;
    const savedTerminalSchemeIsSupported = Boolean(savedTerminalColorScheme
      && (TERMINAL_COLOR_SCHEME_IDS as readonly string[]).includes(savedTerminalColorScheme));
    const resolvedTerminalColorScheme = savedTerminalSchemeIsSupported
      ? savedTerminalColorScheme!
      : (!savedTerminalColorScheme && (values.terminal_background_color || values.terminal_text_color)
        ? "custom"
        : DEFAULT_TERMINAL_COLOR_SCHEME);
    const presetTerminalColors = resolvedTerminalColorScheme === "custom"
      ? null
      : TERMINAL_COLOR_SCHEME_COLORS[resolvedTerminalColorScheme];
    if (savedTerminalColorScheme && !savedTerminalSchemeIsSupported && presetTerminalColors) {
      await invoke("db_set_setting", {
        key: "terminal_color_scheme",
        value: JSON.stringify(resolvedTerminalColorScheme),
      });
      await invoke("db_set_setting", {
        key: "terminal_background_color",
        value: JSON.stringify(presetTerminalColors.background),
      });
      await invoke("db_set_setting", {
        key: "terminal_text_color",
        value: JSON.stringify(presetTerminalColors.foreground),
      });
    }
    const savedTerminalOpacity = Number(values.terminal_background_opacity);
    // Glass Light originally shipped with an 8% tint, which remained dark over
    // the app's dark canvas. Upgrade that exact preset value while preserving
    // any opacity the user chose themselves.
    const resolvedTerminalOpacity = resolvedTerminalColorScheme === "light"
      && savedTerminalOpacity === 8
      ? GLASS_LIGHT_BACKGROUND_OPACITY
      : Number.isFinite(savedTerminalOpacity)
        ? Math.min(100, Math.max(0, Math.round(savedTerminalOpacity)))
        : DEFAULT_TERMINAL_BACKGROUND_OPACITY;
    if (resolvedTerminalColorScheme === "light" && savedTerminalOpacity === 8) {
      await invoke("db_set_setting", {
        key: "terminal_background_opacity",
        value: JSON.stringify(GLASS_LIGHT_BACKGROUND_OPACITY),
      });
    }
    const resolvedTerminalTransparent = values.terminal_transparent === "true"
      || (values.terminal_transparent as unknown) === true
      || DEFAULT_TERMINAL_TRANSPARENT;
    const resolvedTerminalBlur = Number.isFinite(Number(values.terminal_background_blur))
      ? Math.min(30, Math.max(0, Math.round(Number(values.terminal_background_blur))))
      : DEFAULT_TERMINAL_BACKGROUND_BLUR;
    const storedTerminalAppearance: TerminalCustomAppearance = {
      backgroundColor: normalizeHexColor(values.terminal_background_color || ""),
      textColor: normalizeHexColor(values.terminal_text_color || "", DEFAULT_TERMINAL_TEXT_COLOR),
      transparent: resolvedTerminalTransparent,
      blur: resolvedTerminalBlur,
      opacity: resolvedTerminalOpacity,
    };
    const resolvedTerminalCustomAppearance = parseTerminalCustomAppearance(
      values.terminal_custom_appearance as unknown,
      storedTerminalAppearance,
    );
    const activeTerminalAppearance: TerminalCustomAppearance = resolvedTerminalColorScheme === "custom"
      ? resolvedTerminalCustomAppearance
      : {
          backgroundColor: presetTerminalColors!.background,
          textColor: presetTerminalColors!.foreground,
          ...TERMINAL_COLOR_SCHEME_EFFECTS[resolvedTerminalColorScheme],
        };
    if (resolvedTerminalColorScheme === "custom" && values.terminal_custom_appearance === undefined) {
      await invoke("db_set_setting", {
        key: "terminal_custom_appearance",
        value: JSON.stringify(resolvedTerminalCustomAppearance),
      });
    }

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
      appBackgroundImage: resolvedBackgroundImage,
      appBackgroundImages: resolvedBackgroundImages,
      appBackgroundImageIndex: resolvedBackgroundIndex,
      appBackgroundImagePositions: resolvedBackgroundPositions,
      appBackgroundImagePosition: resolvedBackgroundPosition,
      lockScreenImage: values.lock_screen_image || "",
      lockScreenBlur: Number(values.lock_screen_blur ?? 0),
      lockScreenVisible: (values.lock_screen_visible as unknown) !== false && values.lock_screen_visible !== "false",
      // Anything not on the offered list (a hand-edited DB, a value from a
      // future build) falls back to off rather than to a surprise interval.
      autoLockMinutes: (AUTO_LOCK_CHOICES as readonly number[]).includes(Number(values.auto_lock_minutes))
        ? Number(values.auto_lock_minutes)
        : DEFAULT_AUTO_LOCK_MINUTES,
      appBackgroundBlur: values.app_background_blur !== undefined ? Number(values.app_background_blur) : 20,
      appBackgroundDimming: Number.isFinite(Number(values.app_background_dimming))
        ? Math.min(80, Math.max(0, Math.round(Number(values.app_background_dimming))))
        : 0,
      appBackgroundVisible: (values.app_background_visible as unknown) !== false && values.app_background_visible !== "false",
      browserAdBlockEnabled: (values.browser_adblock_enabled as unknown) !== false && values.browser_adblock_enabled !== "false",
      terminalTransparent: activeTerminalAppearance.transparent,
      terminalBackgroundBlur: activeTerminalAppearance.blur,
      terminalBackgroundOpacity: activeTerminalAppearance.opacity,
      terminalBackgroundColor: activeTerminalAppearance.backgroundColor,
      terminalTextColor: activeTerminalAppearance.textColor,
      terminalColorScheme: resolvedTerminalColorScheme,
      terminalCustomAppearance: resolvedTerminalCustomAppearance,
      terminalRenderer: (["auto", "webgl", "dom"] as TerminalRenderer[])
        .includes(values.terminal_renderer as TerminalRenderer)
        ? values.terminal_renderer as TerminalRenderer
        : DEFAULT_TERMINAL_RENDERER,
      terminalFontFamily: typeof values.terminal_font_family === "string" && values.terminal_font_family.trim()
        ? values.terminal_font_family.trim().slice(0, 120)
        : DEFAULT_TERMINAL_FONT_FAMILY,
      terminalFontSize: Number.isFinite(Number(values.terminal_font_size))
        ? Math.min(32, Math.max(8, Math.round(Number(values.terminal_font_size))))
        : DEFAULT_TERMINAL_FONT_SIZE,
      terminalFontWeight: values.terminal_font_weight === undefined
        ? DEFAULT_TERMINAL_FONT_WEIGHT
        : normalizeTerminalFontWeight(values.terminal_font_weight),
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
