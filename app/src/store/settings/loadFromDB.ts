import type { StoreApi } from "zustand";
import type { SettingsState } from "./state";
import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, DEFAULT_VISIBLE_TOPBAR_ITEMS, DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_LAYOUT_MODE, AUTO_LOCK_CHOICES, DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_DSH_BACKGROUND_OPACITY, DEFAULT_DSH_BACKGROUND_BLUR,
  DSH_IDLE_STOP_CHOICES, DEFAULT_DSH_IDLE_STOP_MINUTES, DEFAULT_DSH_GLOBAL_SHORTCUT,
  DEFAULT_TERMINAL_BACKGROUND_BLUR, DEFAULT_TERMINAL_BACKGROUND_OPACITY, DEFAULT_TERMINAL_TRANSPARENT,
  DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_WEIGHT, normalizeTerminalFontWeight,
  DEFAULT_TERMINAL_TEXT_COLOR,
  DEFAULT_TERMINAL_COLOR_SCHEME,
  TERMINAL_COLOR_SCHEME_COLORS,
  TERMINAL_COLOR_SCHEME_EFFECTS,
  TERMINAL_COLOR_SCHEME_IDS,
  DEFAULT_TERMINAL_RENDERER, DEFAULT_TERMINAL_ENGINE,
  DOCUMENT_TEXT_COLOR_RE, normalizeHexColor, type Theme, type RssTabSelection,
  type LayoutMode, type TerminalRenderer, type TerminalEngine, type TerminalColorScheme, type TerminalCustomAppearance,
  type TopBarItemId, type SidebarTabId,
} from "./types";
import {
  cacheUiLanguage, cacheSidebarTabs, cacheTopBarItems, cacheDefaultRssTab, cacheFeedsViewMode,
  cacheLayoutMode, cacheSidebarTabOrder, cacheTopBarItemOrder,
} from "./cache";
import { normalizeOrder } from "./reorder";
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

/** Add the DSH shortcut in canonical top-bar order without re-enabling any
 * other control the user previously hid. */
export function includeDshTopBarItem(items: TopBarItemId[]): TopBarItemId[] {
  return DEFAULT_TOPBAR_ITEMS.filter((id) => id === "dsh" || items.includes(id));
}

/** Add newly-toggleable top-bar controls (in canonical order) without
 * re-enabling any other control the user previously hid — same one-time
 * seeding pattern as {@link includeDshTopBarItem}, generalized for ids that
 * used to render unconditionally and only later gained a visibility toggle. */
export function includeTopBarItems(items: TopBarItemId[], ids: TopBarItemId[]): TopBarItemId[] {
  return DEFAULT_TOPBAR_ITEMS.filter((id) => ids.includes(id) || items.includes(id));
}

/** DB keys (other than `terminal_engine`) whose presence proves the user
 *  customized the Terminal before this load — i.e. on a version where xterm
 *  was the only engine (<=1.18.11). Used by the one-time engine migration in
 *  `loadSettingsFromDB` to keep such an upgrader on xterm instead of silently
 *  flipping them onto the experimental restty default. */
const TERMINAL_CUSTOMIZATION_WITNESS_KEYS = [
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
] as const;

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
      "asr_model_path",
      "asr_extra_dirs",
      "show_github_link",
      "visible_sidebar_tabs",
      "visible_topbar_items",
      "sidebar_tab_order",
      "topbar_item_order",
      "layout_mode",
      "default_rss_tab",
      "feeds_view_mode",
      "user_avatar",
      "user_avatar_position",
      "dashboard_banner",
      "dashboard_banner_position",
      "dashboard_banner_visible",
      "nickname",
      "app_background_image",
      "app_background_image_0",
      "app_background_image_1",
      "app_background_image_2",
      "app_background_image_3",
      "app_background_image_4",
      "app_background_images",
      "app_background_image_index",
      "app_background_image_positions",
      "lock_screen_image",
      "lock_screen_image_position",
      "lock_screen_blur",
      "lock_screen_dimming",
      "lock_screen_visible",
      "auto_lock_minutes",
      "app_background_blur",
      "app_background_dimming",
      "app_background_visible",
      "browser_adblock_enabled",
      "dsh_port",
      "dsh_background_opacity",
      "dsh_background_blur",
      "dsh_background_transparent",
      "dsh_toolbar_visible",
      "dsh_idle_stop_minutes",
      "dsh_global_shortcut",
      "terminal_transparent",
      "terminal_background_blur",
      "terminal_background_opacity",
      "terminal_background_color",
      "terminal_text_color",
      "terminal_color_scheme",
      "terminal_custom_appearance",
      "terminal_renderer",
      "terminal_engine",
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
    // One-time upgrade: the Calendar page is new, so an existing install's
    // persisted visible-tab list cannot contain it yet. Seed it right after
    // Dashboard (its canonical position in DEFAULT_SIDEBAR_TABS) exactly once,
    // while still respecting a user who later hides it in Settings — same
    // pattern as the tools/terminal migrations above.
    if (!localStorage.getItem("tanwords_calendar_tab_migrated")) {
      if (!resolvedSidebarTabs.includes("calendar")) {
        const dashboardIndex = resolvedSidebarTabs.indexOf("dashboard");
        resolvedSidebarTabs = [...resolvedSidebarTabs];
        resolvedSidebarTabs.splice(dashboardIndex < 0 ? 0 : dashboardIndex + 1, 0, "calendar");
      }
      localStorage.setItem("tanwords_calendar_tab_migrated", "1");
      await invoke("db_set_setting", { key: "visible_sidebar_tabs", value: JSON.stringify(resolvedSidebarTabs) });
    }
    cacheSidebarTabs(resolvedSidebarTabs);

    const hadSavedTopBar = Array.isArray(values.visible_topbar_items);
    let resolvedTopBarItems = hadSavedTopBar
      ? DEFAULT_TOPBAR_ITEMS.filter((id) => (values.visible_topbar_items as unknown as string[]).includes(id))
      : DEFAULT_VISIBLE_TOPBAR_ITEMS;
    // Seed the DSH top-bar icon (desktop only) when there's no saved top-bar
    // list yet — same one-time-seeding pattern the "tools"/"browser" backfill
    // below used to also apply to, back when a *fresh* install defaulted to
    // every item visible. Now that a fresh default is deliberately small
    // (`DEFAULT_VISIBLE_TOPBAR_ITEMS`), only `dsh` still needs seeding this
    // way — it isn't in that default, but every existing install already had
    // it visible (it used to render unconditionally) and should keep seeing
    // it, so this only reaches for ids that predate the toggle, not the
    // fresh-install default.
    if (!hadSavedTopBar) {
      if (isDesktopHost) {
        resolvedTopBarItems = includeDshTopBarItem(resolvedTopBarItems);
      }
      await invoke("db_set_setting", { key: "visible_topbar_items", value: JSON.stringify(resolvedTopBarItems) });
    }
    // One-time backfill for existing installs, same shape as the calendar
    // sidebar-tab migration below: an *existing* saved top-bar list was
    // already filtered down to only ids that predate "voice", so it never
    // picks the new one up on its own the way a fresh install's
    // `DEFAULT_VISIBLE_TOPBAR_ITEMS` does. Runs once regardless of
    // `hadSavedTopBar` (a fresh install already has it via that default, so
    // this is a harmless no-op there) and still respects a user who later
    // hides it in Settings.
    if (!localStorage.getItem("tanwords_voice_topbar_migrated")) {
      if (!resolvedTopBarItems.includes("voice")) resolvedTopBarItems = [...resolvedTopBarItems, "voice"];
      localStorage.setItem("tanwords_voice_topbar_migrated", "1");
      await invoke("db_set_setting", { key: "visible_topbar_items", value: JSON.stringify(resolvedTopBarItems) });
    }
    cacheTopBarItems(resolvedTopBarItems);

    const resolvedSidebarTabOrder: SidebarTabId[] = Array.isArray(values.sidebar_tab_order)
      ? normalizeOrder(values.sidebar_tab_order as unknown as unknown[], DEFAULT_SIDEBAR_TABS)
      : DEFAULT_SIDEBAR_TABS;
    cacheSidebarTabOrder(resolvedSidebarTabOrder);
    const resolvedTopBarItemOrder: TopBarItemId[] = Array.isArray(values.topbar_item_order)
      ? normalizeOrder(values.topbar_item_order as unknown as unknown[], DEFAULT_TOPBAR_ITEMS)
      : DEFAULT_TOPBAR_ITEMS;
    cacheTopBarItemOrder(resolvedTopBarItemOrder);

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

    // Per-slot wallpaper rows: one settings row per image
    // (`app_background_image_0` .. `_4`) so a last-writer-wins sync (Postgres)
    // clobbers only the changed slot instead of the whole gallery. Slot 0
    // being present — even as an empty string — marks the new format; older
    // installs fall back to the legacy single-array row, then the single-image
    // row. Migration to the slot format happens lazily on the next save.
    const backgroundSlots: number[] = [];
    for (let i = 0; i < 5; i++) {
      const slotValue = values[`app_background_image_${i}`];
      if (typeof slotValue === "string" && slotValue.length > 0) backgroundSlots.push(i);
    }
    const hasSlotRows = "app_background_image_0" in values;
    const hasSavedBackgroundGallery = Array.isArray(values.app_background_images);
    const savedBackgroundImages = hasSavedBackgroundGallery
      ? (values.app_background_images as unknown as unknown[])
        .filter((image): image is string => typeof image === "string" && image.length > 0)
        .slice(0, 5)
      : [];
    const legacyBackgroundImage = typeof values.app_background_image === "string"
      ? values.app_background_image
      : "";
    const resolvedBackgroundImages = hasSlotRows
      ? backgroundSlots.map((slot) => values[`app_background_image_${slot}`] as string)
      : hasSavedBackgroundGallery
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
    // Slot rows store positions slot-aligned (fixed length 5); the legacy
    // array is compact-index-aligned. Map each way so a partial sync that
    // leaves a gap still pairs every image with its own position.
    const resolvedBackgroundPositions = hasSlotRows
      ? backgroundSlots.map((slot) => parseBannerPosition(savedBackgroundPositions[slot]))
      : resolvedBackgroundImages.map((_, index) => parseBannerPosition(savedBackgroundPositions[index]));
    const resolvedBackgroundPosition = resolvedBackgroundPositions[resolvedBackgroundIndex]
      || parseBannerPosition(undefined);

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
    const resolvedTerminalOpacity = Number.isFinite(savedTerminalOpacity)
      ? Math.min(100, Math.max(0, Math.round(savedTerminalOpacity)))
      : DEFAULT_TERMINAL_BACKGROUND_OPACITY;
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

    // One-time upgrade: installs that predate the terminal-engine setting
    // (<=1.18.11, when xterm was the only engine) have no `terminal_engine`
    // row. restty is the fresh-install default, but silently flipping a
    // long-time user onto the experimental restty engine — reduced feature
    // set: no in-terminal search, inline images, shell-title tabs, or
    // background blur — would feel like a regression they never asked for.
    // On the first load that knows about engines, seed `xterm` for any
    // install that already customized the terminal (proof it was used before
    // restty existed); a fresh install with no terminal rows keeps restty.
    // Like the sidebar-tab migrations above, a localStorage flag runs this
    // exactly once per device. Persisting the seed to the DB (not just the
    // in-memory state) makes it survive reloads and sync to other devices,
    // the same way an explicit engine pick does.
    const savedTerminalEngine = values.terminal_engine;
    let resolvedTerminalEngine: TerminalEngine;
    if (savedTerminalEngine === "xterm" || savedTerminalEngine === "restty") {
      resolvedTerminalEngine = savedTerminalEngine;
    } else if (savedTerminalEngine === undefined && !localStorage.getItem("tanwords_terminal_engine_migrated")) {
      const hadPriorTerminalCustomization = TERMINAL_CUSTOMIZATION_WITNESS_KEYS.some((key) => values[key] !== undefined);
      resolvedTerminalEngine = hadPriorTerminalCustomization ? "xterm" : DEFAULT_TERMINAL_ENGINE;
      localStorage.setItem("tanwords_terminal_engine_migrated", "1");
      if (hadPriorTerminalCustomization) {
        await invoke("db_set_setting", { key: "terminal_engine", value: JSON.stringify("xterm") });
      }
    } else {
      resolvedTerminalEngine = DEFAULT_TERMINAL_ENGINE;
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
      asrModelPath: values.asr_model_path || "",
      asrExtraDirs: Array.isArray(values.asr_extra_dirs) ? values.asr_extra_dirs : [],
      // JSON.parse turns the stored string into a real boolean; default on.
      showGithubLink: (values.show_github_link as unknown) !== false && values.show_github_link !== "false",
      selectionActions: (values.selection_actions as unknown) !== false && values.selection_actions !== "false",
      visibleSidebarTabs: resolvedSidebarTabs,
      visibleTopBarItems: resolvedTopBarItems,
      sidebarTabOrder: resolvedSidebarTabOrder,
      topBarItemOrder: resolvedTopBarItemOrder,
      layoutMode: resolvedLayoutMode,
      defaultRssTab: resolvedDefaultRssTab,
      feedsViewMode: resolvedFeedsViewMode,
      userAvatar: values.user_avatar || "",
      userAvatarPosition: parseBannerPosition(values.user_avatar_position),
      dashboardBanner: values.dashboard_banner || "",
      dashboardBannerPosition: parseBannerPosition(values.dashboard_banner_position),
      dashboardBannerVisible: (values.dashboard_banner_visible as unknown) !== false && values.dashboard_banner_visible !== "false",
      nickname: values.nickname || "",
      appBackgroundImage: resolvedBackgroundImage,
      appBackgroundImages: resolvedBackgroundImages,
      appBackgroundImageIndex: resolvedBackgroundIndex,
      appBackgroundImagePositions: resolvedBackgroundPositions,
      appBackgroundImagePosition: resolvedBackgroundPosition,
      lockScreenImage: values.lock_screen_image || "",
      lockScreenImagePosition: parseBannerPosition(values.lock_screen_image_position),
      lockScreenBlur: Number(values.lock_screen_blur ?? 0),
      lockScreenDimming: Number.isFinite(Number(values.lock_screen_dimming))
        ? Math.min(80, Math.max(0, Math.round(Number(values.lock_screen_dimming))))
        : 0,
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
      // 0 (or missing/invalid) = standard 3080; non-zero pins a custom port.
      dshPort: Number(values.dsh_port) > 0 ? Math.min(65535, Math.floor(Number(values.dsh_port))) : 0,
      // The former boolean setting maps true→0% and false→100%, preserving
      // existing users' appearance while moving to continuous controls.
      dshBackgroundOpacity: Number.isFinite(Number(values.dsh_background_opacity))
        ? Math.min(100, Math.max(0, Math.round(Number(values.dsh_background_opacity))))
        : values.dsh_background_transparent === "true" || (values.dsh_background_transparent as unknown) === true
          ? 0
          : DEFAULT_DSH_BACKGROUND_OPACITY,
      dshBackgroundBlur: Number.isFinite(Number(values.dsh_background_blur))
        ? Math.min(100, Math.max(0, Math.round(Number(values.dsh_background_blur))))
        : DEFAULT_DSH_BACKGROUND_BLUR,
      // Missing/false = hidden (the default); only an explicit stored `"true"`
      // restores the DSH page toolbar. Stored as JSON, so the value is the
      // string "true" or "false".
      dshToolbarVisible: values.dsh_toolbar_visible === "true",
      // Anything not on the offered list (a hand-edited DB, a future build's
      // removed choice) falls back to off rather than a value under the
      // 10-minute floor the picker enforces.
      dshIdleStopMinutes: (DSH_IDLE_STOP_CHOICES as readonly number[]).includes(Number(values.dsh_idle_stop_minutes))
        ? Number(values.dsh_idle_stop_minutes)
        : DEFAULT_DSH_IDLE_STOP_MINUTES,
      dshGlobalShortcut: typeof values.dsh_global_shortcut === "string"
        ? values.dsh_global_shortcut
        : DEFAULT_DSH_GLOBAL_SHORTCUT,
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
      terminalEngine: resolvedTerminalEngine,
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
