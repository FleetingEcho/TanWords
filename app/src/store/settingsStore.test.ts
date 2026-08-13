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
      terminalTransparent: false,
      terminalBackgroundBlur: 16,
      terminalBackgroundOpacity: 16,
      terminalRenderer: "auto",
      terminalFontFamily: "ui-monospace",
      terminalFontSize: 13,
      terminalShellPath: "",
      userAvatar: "",
      dashboardBanner: "",
      nickname: "",
      appBackgroundImage: "",
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
      isLoaded: true,
    });
  });

  it("restores saved terminal appearance values", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "terminal_background_blur") return "24";
      if (args?.key === "terminal_background_opacity") return "42";
      if (args?.key === "terminal_transparent") return "true";
      if (args?.key === "terminal_renderer") return '"dom"';
      if (args?.key === "terminal_font_family") return '"JetBrains Mono"';
      if (args?.key === "terminal_font_size") return "17";
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().terminalTransparent).toBe(true);
    expect(useSettingsStore.getState().terminalRenderer).toBe("dom");
    expect(useSettingsStore.getState().terminalBackgroundBlur).toBe(24);
    expect(useSettingsStore.getState().terminalBackgroundOpacity).toBe(42);
    expect(useSettingsStore.getState().terminalFontFamily).toBe("JetBrains Mono");
    expect(useSettingsStore.getState().terminalFontSize).toBe(17);
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

  it("sanitizes, clamps, and persists terminal typography", async () => {
    vi.useFakeTimers();

    useSettingsStore.getState().setTerminalFontFamily("  Fira Code  ");
    useSettingsStore.getState().setTerminalFontSize(99);

    expect(useSettingsStore.getState().terminalFontFamily).toBe("Fira Code");
    expect(useSettingsStore.getState().terminalFontSize).toBe(32);
    await vi.advanceTimersByTimeAsync(300);
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_font_family",
      value: '"Fira Code"',
    });
    expect(invoke).toHaveBeenCalledWith("db_set_setting", {
      key: "terminal_font_size",
      value: "32",
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
