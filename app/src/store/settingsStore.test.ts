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

describe("settingsStore database hydration", () => {
  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
    useSettingsStore.setState({
      appBackgroundVisible: true,
      appBackgroundDimming: 0,
      terminalTransparent: false,
      terminalBackgroundBlur: 16,
      terminalBackgroundOpacity: 16,
      terminalRenderer: "auto",
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

  it("uses 16px as the fresh terminal font-size default", () => {
    expect(useSettingsStore.getInitialState().terminalFontSize).toBe(16);
  });

  it("restores the saved app background visibility", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command === "db_get_setting" && args?.key === "app_background_visible") {
        return "false";
      }
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(invoke).toHaveBeenCalledWith("db_get_setting", { key: "app_background_visible" });
    expect(useSettingsStore.getState().appBackgroundVisible).toBe(false);
  });

  it("restores and clamps the saved background dimming", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command === "db_get_setting" && args?.key === "app_background_dimming") return "95";
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().appBackgroundDimming).toBe(80);
  });

  it("persists background dimming without writing every slider tick", async () => {
    vi.useFakeTimers();

    useSettingsStore.getState().setAppBackgroundDimming(34.6);
    expect(useSettingsStore.getState().appBackgroundDimming).toBe(35);

    await vi.advanceTimersByTimeAsync(300);
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "app_background_dimming",
      value: "35",
    });
  });

  it("restores synced visual settings when a device-only path cannot be read", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command === "db_get_device_path" && args?.key === "terminal_shell_path") {
        throw new Error("terminal_shell_path is not a device path setting");
      }
      if (command !== "db_get_setting") return null;
      if (args?.key === "nickname") return '"Tanner"';
      if (args?.key === "user_avatar") return '"data:image/png;base64,avatar"';
      if (args?.key === "dashboard_banner") return '"data:image/png;base64,banner"';
      if (args?.key === "app_background_image") return '"data:image/png;base64,background"';
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState()).toMatchObject({
      nickname: "Tanner",
      userAvatar: "data:image/png;base64,avatar",
      dashboardBanner: "data:image/png;base64,banner",
      appBackgroundImage: "data:image/png;base64,background",
      appBackgroundImages: ["data:image/png;base64,background"],
      appBackgroundImageIndex: 0,
      appBackgroundImagePosition: { x: 50, y: 50 },
      isLoaded: true,
    });
  });

  it("restores a wallpaper gallery and its active image", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "app_background_images") return JSON.stringify(["first", "second", "third"]);
      if (args?.key === "app_background_image_index") return "1";
      if (args?.key === "app_background_image_positions") return JSON.stringify([{ x: 20, y: 30 }, { x: 70, y: 80 }]);
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState()).toMatchObject({
      appBackgroundImage: "second",
      appBackgroundImages: ["first", "second", "third"],
      appBackgroundImageIndex: 1,
      appBackgroundImagePosition: { x: 70, y: 80 },
    });
  });

  it("restores the complete saved custom terminal appearance", async () => {
    const custom = {
      backgroundColor: "#123456",
      textColor: "#fedcba",
      transparent: true,
      blur: 7,
      opacity: 23,
    };
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_color_scheme") return '"custom"';
      if (args?.key === "terminal_custom_appearance") return JSON.stringify(custom);
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "custom",
      terminalBackgroundColor: "#123456",
      terminalTextColor: "#fedcba",
      terminalTransparent: true,
      terminalBackgroundBlur: 7,
      terminalBackgroundOpacity: 23,
      terminalCustomAppearance: custom,
    });
  });

  it("caps the wallpaper gallery at five and persists its active image", async () => {
    useSettingsStore.getState().setAppBackgroundImages(
      ["one", "two", "three", "four", "five", "six"],
      5,
      [{ x: 10, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 40 }, { x: 40, y: 50 }, { x: 60, y: 70 }],
    );

    expect(useSettingsStore.getState()).toMatchObject({
      appBackgroundImage: "five",
      appBackgroundImages: ["one", "two", "three", "four", "five"],
      appBackgroundImageIndex: 4,
      appBackgroundImagePosition: { x: 60, y: 70 },
    });
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("db_set_setting", {
        key: "app_background_image",
        value: '"five"',
      });
    });
  });

  it("restores saved terminal appearance values", async () => {
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

    expect(useSettingsStore.getState().terminalTransparent).toBe(true);
    expect(useSettingsStore.getState().terminalRenderer).toBe("dom");
    expect(useSettingsStore.getState().terminalColorScheme).toBe("dracula");
    expect(useSettingsStore.getState().terminalBackgroundColor).toBe("#282a36");
    expect(useSettingsStore.getState().terminalTextColor).toBe("#f8f8f2");
    expect(useSettingsStore.getState().terminalBackgroundBlur).toBe(24);
    expect(useSettingsStore.getState().terminalBackgroundOpacity).toBe(42);
    expect(useSettingsStore.getState().terminalFontFamily).toBe("JetBrains Mono");
    expect(useSettingsStore.getState().terminalFontSize).toBe(17);
    expect(useSettingsStore.getState().terminalFontWeight).toBe(600);
  });

  it("upgrades the original too-dark Glass Light tint", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_color_scheme") return '"light"';
      if (args?.key === "terminal_background_opacity") return "8";
      if (args?.key === "terminal_transparent") return "true";
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().terminalBackgroundOpacity).toBe(76);
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_background_opacity",
      value: "76",
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

  it("uses a Warp-style glass palette and supports the retained presets", () => {
    useSettingsStore.getState().setTerminalColorScheme("light");
    expect(useSettingsStore.getState()).toMatchObject({
      terminalBackgroundColor: "#f4f1ea",
      terminalTextColor: "#202124",
      terminalTransparent: true,
      terminalBackgroundBlur: 0,
      terminalBackgroundOpacity: 76,
    });

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
