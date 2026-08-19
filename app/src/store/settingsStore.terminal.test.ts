import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  return { invoke: vi.fn() };
});

vi.mock("@/ipc/backend", () => ({ invoke }));

import { useSettingsStore } from "./settingsStore";
import { includeDshTopBarItem, includeTopBarItems } from "./settings/loadFromDB";

describe("settingsStore database hydration", () => {
  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
    useSettingsStore.setState({
      appBackgroundVisible: true,
      appBackgroundDimming: 0,
      dshBackgroundOpacity: 100,
      dshBackgroundBlur: 0,
      terminalTransparent: false,
      terminalBackgroundBlur: 16,
      terminalBackgroundOpacity: 16,
      terminalRenderer: "auto",
      terminalEngine: "restty",
      terminalBackgroundColor: "#1a1b26",
      terminalTextColor: "#c0caf5",
      terminalColorScheme: "tokyo-night",
      terminalCustomAppearance: {
        backgroundColor: "#1a1b26",
        textColor: "#c0caf5",
        transparent: false,
        blur: 16,
        opacity: 16,
      },
      terminalFontFamily: "ui-monospace",
      terminalFontSize: 13,
      terminalFontWeight: 400,
      terminalShellPath: "",
      userAvatar: "",
      dashboardBanner: "",
      nickname: "",
      appBackgroundImage: "",
      appBackgroundImages: [],
      appBackgroundImageIndex: 0,
      appBackgroundImagePositions: [],
      appBackgroundImagePosition: { x: 50, y: 50 },
      isLoaded: false,
    });
  });

  afterEach(() => vi.useRealTimers());

  it("keeps a saved preset independent from custom terminal effects", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_background_blur") return "24";
      if (args?.key === "terminal_background_opacity") return "42";
      if (args?.key === "terminal_transparent") return "true";
      if (args?.key === "terminal_renderer") return '"dom"';
      if (args?.key === "terminal_color_scheme") return '"dracula"';
      if (args?.key === "terminal_background_color") return '"#282a36"';
      if (args?.key === "terminal_text_color") return '"#f8f8f2"';
      if (args?.key === "terminal_font_family") return '"JetBrains Mono"';
      if (args?.key === "terminal_font_size") return "17";
      if (args?.key === "terminal_font_weight") return "600";
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().terminalTransparent).toBe(false);
    expect(useSettingsStore.getState().terminalRenderer).toBe("dom");
    expect(useSettingsStore.getState().terminalColorScheme).toBe("dracula");
    expect(useSettingsStore.getState().terminalBackgroundColor).toBe("#282a36");
    expect(useSettingsStore.getState().terminalTextColor).toBe("#f8f8f2");
    expect(useSettingsStore.getState().terminalBackgroundBlur).toBe(16);
    expect(useSettingsStore.getState().terminalBackgroundOpacity).toBe(100);
    expect(useSettingsStore.getState().terminalFontFamily).toBe("JetBrains Mono");
    expect(useSettingsStore.getState().terminalFontSize).toBe(17);
    expect(useSettingsStore.getState().terminalFontWeight).toBe(600);
  });

  it("migrates a removed Glass Light preset to Tokyo Night", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_color_scheme") return '"light"';
      if (args?.key === "terminal_transparent") return "true";
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "tokyo-night",
      terminalBackgroundColor: "#1a1b26",
      terminalTextColor: "#c0caf5",
    });
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_color_scheme",
      value: '"tokyo-night"',
    });
  });

  it("migrates a removed terminal preset to Tokyo Night", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_color_scheme") return '"github-dark"';
      if (args?.key === "terminal_background_color") return '"#0d1117"';
      if (args?.key === "terminal_text_color") return '"#c9d1d9"';
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "tokyo-night",
      terminalBackgroundColor: "#1a1b26",
      terminalTextColor: "#c0caf5",
    });
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_color_scheme",
      value: '"tokyo-night"',
    });
  });

  it("clamps and persists terminal appearance slider values", async () => {
    vi.useFakeTimers();

    useSettingsStore.getState().setTerminalBackgroundBlur(99);
    useSettingsStore.getState().setTerminalBackgroundOpacity(-1);

    expect(useSettingsStore.getState().terminalBackgroundBlur).toBe(30);
    expect(useSettingsStore.getState().terminalBackgroundOpacity).toBe(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_background_blur",
      value: "30",
    });
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_background_opacity",
      value: "0",
    });
  });

  it("persists the transparent terminal toggle", async () => {
    useSettingsStore.getState().setTerminalTransparent(true);

    expect(useSettingsStore.getState().terminalTransparent).toBe(true);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("db_set_setting", {
        key: "terminal_transparent",
        value: "true",
      });
    });
  });

  it("persists and clamps DSH background opacity and blur", async () => {
    vi.useFakeTimers();
    useSettingsStore.getState().setDshBackgroundOpacity(36.7);
    useSettingsStore.getState().setDshBackgroundBlur(140);

    expect(useSettingsStore.getState()).toMatchObject({
      dshBackgroundOpacity: 37,
      dshBackgroundBlur: 100,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "dsh_background_opacity",
      value: "37",
    });
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "dsh_background_blur",
      value: "100",
    });
  });

  it("persists the terminal renderer", async () => {
    useSettingsStore.getState().setTerminalRenderer("webgl");

    expect(useSettingsStore.getState().terminalRenderer).toBe("webgl");
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("db_set_setting", {
        key: "terminal_renderer",
        value: '"webgl"',
      });
    });
  });

  it("defaults the terminal engine to restty and loads a persisted xterm choice", async () => {
    expect(useSettingsStore.getState().terminalEngine).toBe("restty");

    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_engine") return '"xterm"';
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().terminalEngine).toBe("xterm");
  });

  it("falls back to restty for an invalid stored terminal engine", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_engine") return '"ghostty"';
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().terminalEngine).toBe("restty");
  });

  it("persists the terminal engine", async () => {
    useSettingsStore.getState().setTerminalEngine("xterm");

    expect(useSettingsStore.getState().terminalEngine).toBe("xterm");
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("db_set_setting", {
        key: "terminal_engine",
        value: '"xterm"',
      });
    });
  });

  it("seeds xterm for an upgrader with prior terminal customizations and no engine row", async () => {
    // A pre-restty install (<=1.18.11, when xterm was the only engine) has
    // terminal customizations but no `terminal_engine` row. The one-time
    // migration preserves its xterm experience instead of flipping it onto
    // the experimental restty default, and persists the seed so it survives
    // reloads and syncs to other devices.
    localStorage.removeItem("tanwords_terminal_engine_migrated");
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_font_size") return "17";
      if (args?.key === "terminal_color_scheme") return '"dracula"';
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().terminalEngine).toBe("xterm");
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_engine",
      value: '"xterm"',
    });
    expect(localStorage.getItem("tanwords_terminal_engine_migrated")).toBe("1");
  });

  it("keeps restty for a fresh install with no terminal customizations", async () => {
    localStorage.removeItem("tanwords_terminal_engine_migrated");
    invoke.mockImplementation(async () => null);

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().terminalEngine).toBe("restty");
    expect(invoke).not.toHaveBeenCalledWith(
      "db_set_setting",
      expect.objectContaining({ key: "terminal_engine" }),
    );
    expect(localStorage.getItem("tanwords_terminal_engine_migrated")).toBe("1");
  });

  it("does not re-seed once the one-time engine migration has run", async () => {
    // After the migration ran (flag set), a later load with terminal
    // customizations but no engine row falls back to the restty default
    // rather than re-seeding xterm — so clearing the engine row keeps the
    // fresh default instead of perpetually flipping back to xterm.
    localStorage.setItem("tanwords_terminal_engine_migrated", "1");
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_font_size") return "17";
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().terminalEngine).toBe("restty");
    expect(invoke).not.toHaveBeenCalledWith(
      "db_set_setting",
      expect.objectContaining({ key: "terminal_engine" }),
    );
  });

  it("applies and persists complete terminal color schemes", async () => {
    useSettingsStore.getState().setTerminalColorScheme("tokyo-night");

    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "tokyo-night",
      terminalBackgroundColor: "#1a1b26",
      terminalTextColor: "#c0caf5",
    });
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("db_set_setting", {
        key: "terminal_color_scheme",
        value: '"tokyo-night"',
      });
    });
  });

  it("supports the retained high-contrast preset", () => {
    useSettingsStore.getState().setTerminalColorScheme("high-contrast");
    expect(useSettingsStore.getState()).toMatchObject({
      terminalBackgroundColor: "#000000",
      terminalTextColor: "#ffffff",
    });
  });

  it("switches to custom when a terminal color is edited", () => {
    useSettingsStore.getState().setTerminalTextColor("#abc");

    expect(useSettingsStore.getState().terminalTextColor).toBe("#aabbcc");
    expect(useSettingsStore.getState().terminalColorScheme).toBe("custom");
  });

  it("restores the saved custom appearance after switching through a preset", async () => {
    vi.useFakeTimers();

    useSettingsStore.getState().setTerminalBackgroundColor("#123456");
    useSettingsStore.getState().setTerminalTextColor("#fedcba");
    useSettingsStore.getState().setTerminalTransparent(true);
    useSettingsStore.getState().setTerminalBackgroundBlur(7);
    useSettingsStore.getState().setTerminalBackgroundOpacity(23);

    useSettingsStore.getState().setTerminalColorScheme("dracula");
    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "dracula",
      terminalBackgroundColor: "#282a36",
      terminalTextColor: "#f8f8f2",
      terminalTransparent: false,
      terminalBackgroundBlur: 16,
      terminalBackgroundOpacity: 100,
    });

    useSettingsStore.getState().setTerminalColorScheme("custom");
    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "custom",
      terminalBackgroundColor: "#123456",
      terminalTextColor: "#fedcba",
      terminalTransparent: true,
      terminalBackgroundBlur: 7,
      terminalBackgroundOpacity: 23,
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_custom_appearance",
      value: JSON.stringify({
        backgroundColor: "#123456",
        textColor: "#fedcba",
        transparent: true,
        blur: 7,
        opacity: 23,
      }),
    });
  });

  it("sanitizes, clamps, and persists terminal typography", async () => {
    vi.useFakeTimers();

    useSettingsStore.getState().setTerminalFontFamily("  Fira Code  ");
    useSettingsStore.getState().setTerminalFontSize(99);
    useSettingsStore.getState().setTerminalFontWeight(999);

    expect(useSettingsStore.getState().terminalFontFamily).toBe("Fira Code");
    expect(useSettingsStore.getState().terminalFontSize).toBe(32);
    expect(useSettingsStore.getState().terminalFontWeight).toBe(900);
    await vi.advanceTimersByTimeAsync(300);
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_font_family",
      value: '"Fira Code"',
    });
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_font_size",
      value: "32",
    });
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_font_weight",
      value: "900",
    });
  });

  it("stores the terminal shell path per device", async () => {
    useSettingsStore.getState().setTerminalShellPath("  /opt/homebrew/bin/fish  ");

    expect(useSettingsStore.getState().terminalShellPath).toBe("/opt/homebrew/bin/fish");
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("db_set_device_path", {
        key: "terminal_shell_path",
        value: "/opt/homebrew/bin/fish",
      });
    });
  });

  it("applies and resets the document text color CSS variable", () => {
    useSettingsStore.getState().setDocumentTextColor("#ddd");
    expect(document.documentElement.style.getPropertyValue("--document-text-color")).toBe("#ddd");

    useSettingsStore.getState().setDocumentTextColor("#a1b2c3");
    expect(document.documentElement.style.getPropertyValue("--document-text-color")).toBe("#a1b2c3");

    useSettingsStore.getState().setDocumentTextColor("");
    expect(document.documentElement.style.getPropertyValue("--document-text-color")).toBe("");
  });

  it("clamps and applies the document line height CSS variable", () => {
    useSettingsStore.getState().setDocumentLineHeight(2);
    expect(useSettingsStore.getState().documentLineHeight).toBe(2);
    expect(document.documentElement.style.getPropertyValue("--document-line-height")).toBe("2");

    useSettingsStore.getState().setDocumentLineHeight(3);
    expect(useSettingsStore.getState().documentLineHeight).toBe(2.2);
    expect(document.documentElement.style.getPropertyValue("--document-line-height")).toBe("2.2");
  });

  it("clamps and applies the document paragraph spacing CSS variable", () => {
    useSettingsStore.getState().setDocumentParagraphSpacing(1);
    expect(useSettingsStore.getState().documentParagraphSpacing).toBe(1);
    expect(document.documentElement.style.getPropertyValue("--document-paragraph-spacing")).toBe("1em");

    // Above the max (2) clamps to 2.0; below the min (0.2) clamps to 0.2.
    useSettingsStore.getState().setDocumentParagraphSpacing(5);
    expect(useSettingsStore.getState().documentParagraphSpacing).toBe(2);
    expect(document.documentElement.style.getPropertyValue("--document-paragraph-spacing")).toBe("2em");
  });
});
