import type { StoreApi } from "zustand";
import {
  DEFAULT_TERMINAL_TEXT_COLOR, DEFAULT_TERMINAL_FONT_FAMILY,
  TERMINAL_COLOR_SCHEME_COLORS, TERMINAL_COLOR_SCHEME_EFFECTS,
  normalizeHexColor, normalizeTerminalFontWeight,
  type TerminalColorScheme, type TerminalRenderer, type TerminalEngine, type TerminalCustomAppearance,
} from "./settings/types";
import { saveSetting, saveSettingDebounced, saveSettings } from "./settings/cache";
import type { SettingsState } from "./settings/state";

function captureTerminalAppearance(
  state: SettingsState,
  overrides: Partial<TerminalCustomAppearance> = {},
): TerminalCustomAppearance {
  return {
    backgroundColor: state.terminalBackgroundColor,
    textColor: state.terminalTextColor,
    transparent: state.terminalTransparent,
    blur: state.terminalBackgroundBlur,
    opacity: state.terminalBackgroundOpacity,
    ...overrides,
  };
}

export function createTerminalSetters(
  set: StoreApi<SettingsState>["setState"],
  get: StoreApi<SettingsState>["getState"],
): Pick<
  SettingsState,
  | "setTerminalTransparent"
  | "setTerminalBackgroundBlur"
  | "setTerminalBackgroundOpacity"
  | "setTerminalBackgroundColor"
  | "setTerminalTextColor"
  | "setTerminalColorScheme"
  | "setTerminalRenderer"
  | "setTerminalEngine"
  | "setTerminalFontFamily"
  | "setTerminalFontSize"
  | "setTerminalFontWeight"
  | "setTerminalShellPath"
> {
  return {
  setTerminalTransparent: (enabled) => {
    const custom = captureTerminalAppearance(get(), { transparent: enabled });
    set({ terminalTransparent: enabled, terminalColorScheme: "custom", terminalCustomAppearance: custom });
    void saveSettings([
      ["terminal_transparent", JSON.stringify(enabled)],
      ["terminal_color_scheme", JSON.stringify("custom")],
      ["terminal_custom_appearance", JSON.stringify(custom)],
    ]);
  },

  setTerminalBackgroundBlur: (px) => {
    const value = Math.min(30, Math.max(0, Math.round(px)));
    const custom = captureTerminalAppearance(get(), { blur: value });
    set({ terminalBackgroundBlur: value, terminalColorScheme: "custom", terminalCustomAppearance: custom });
    saveSettingDebounced("terminal_background_blur", JSON.stringify(value));
    saveSettingDebounced("terminal_custom_appearance", JSON.stringify(custom));
    saveSetting("terminal_color_scheme", JSON.stringify("custom"));
  },

  setTerminalBackgroundOpacity: (percent) => {
    const value = Math.min(100, Math.max(0, Math.round(percent)));
    const custom = captureTerminalAppearance(get(), { opacity: value });
    set({ terminalBackgroundOpacity: value, terminalColorScheme: "custom", terminalCustomAppearance: custom });
    saveSettingDebounced("terminal_background_opacity", JSON.stringify(value));
    saveSettingDebounced("terminal_custom_appearance", JSON.stringify(custom));
    saveSetting("terminal_color_scheme", JSON.stringify("custom"));
  },

  setTerminalBackgroundColor: (hex) => {
    const value = normalizeHexColor(hex);
    const custom = captureTerminalAppearance(get(), { backgroundColor: value });
    set({ terminalBackgroundColor: value, terminalColorScheme: "custom", terminalCustomAppearance: custom });
    saveSettingDebounced("terminal_background_color", JSON.stringify(value));
    saveSettingDebounced("terminal_custom_appearance", JSON.stringify(custom));
    saveSetting("terminal_color_scheme", JSON.stringify("custom"));
  },

  setTerminalTextColor: (hex) => {
    const value = normalizeHexColor(hex, DEFAULT_TERMINAL_TEXT_COLOR);
    const custom = captureTerminalAppearance(get(), { textColor: value });
    set({ terminalTextColor: value, terminalColorScheme: "custom", terminalCustomAppearance: custom });
    saveSettingDebounced("terminal_text_color", JSON.stringify(value));
    saveSettingDebounced("terminal_custom_appearance", JSON.stringify(custom));
    saveSetting("terminal_color_scheme", JSON.stringify("custom"));
  },

  setTerminalColorScheme: (scheme) => {
    if (scheme === "custom") {
      const custom = get().terminalCustomAppearance;
      set({
        terminalColorScheme: scheme,
        terminalBackgroundColor: custom.backgroundColor,
        terminalTextColor: custom.textColor,
        terminalTransparent: custom.transparent,
        terminalBackgroundBlur: custom.blur,
        terminalBackgroundOpacity: custom.opacity,
      });
      void saveSettings([
        ["terminal_color_scheme", JSON.stringify(scheme)],
        ["terminal_background_color", JSON.stringify(custom.backgroundColor)],
        ["terminal_text_color", JSON.stringify(custom.textColor)],
        ["terminal_transparent", JSON.stringify(custom.transparent)],
        ["terminal_background_blur", JSON.stringify(custom.blur)],
        ["terminal_background_opacity", JSON.stringify(custom.opacity)],
      ]);
      return;
    }
    const colors = TERMINAL_COLOR_SCHEME_COLORS[scheme];
    const effects = TERMINAL_COLOR_SCHEME_EFFECTS[scheme];
    set({
      terminalColorScheme: scheme,
      terminalBackgroundColor: colors.background,
      terminalTextColor: colors.foreground,
      terminalTransparent: effects.transparent,
      terminalBackgroundBlur: effects.blur,
      terminalBackgroundOpacity: effects.opacity,
    });
    void saveSettings([
      ["terminal_color_scheme", JSON.stringify(scheme)],
      ["terminal_background_color", JSON.stringify(colors.background)],
      ["terminal_text_color", JSON.stringify(colors.foreground)],
      ["terminal_transparent", JSON.stringify(effects.transparent)],
      ["terminal_background_blur", JSON.stringify(effects.blur)],
      ["terminal_background_opacity", JSON.stringify(effects.opacity)],
    ]);
  },

  setTerminalRenderer: (renderer) => {
    set({ terminalRenderer: renderer });
    saveSetting("terminal_renderer", JSON.stringify(renderer));
  },

  setTerminalEngine: (engine) => {
    set({ terminalEngine: engine });
    saveSetting("terminal_engine", JSON.stringify(engine));
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

  setTerminalFontWeight: (weight) => {
    const value = normalizeTerminalFontWeight(weight);
    set({ terminalFontWeight: value });
    saveSettingDebounced("terminal_font_weight", JSON.stringify(value));
  },

  setTerminalShellPath: (path) => {
    const value = path.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 2048);
    set({ terminalShellPath: value });
    // Shell executables are machine-specific and must not sync across devices.
    void import("@/ipc/backend").then(({ invoke }) =>
      invoke("db_set_device_path", { key: "terminal_shell_path", value }));
  },
  };
}
