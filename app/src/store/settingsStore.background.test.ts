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

  it("migrates the former DSH transparency toggle to zero opacity", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command === "db_get_setting" && args?.key === "dsh_background_transparent") {
        return "true";
      }
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().dshBackgroundOpacity).toBe(0);
  });

  it("restores and clamps the saved DSH background appearance", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command === "db_get_setting" && args?.key === "dsh_background_opacity") return "135";
      if (command === "db_get_setting" && args?.key === "dsh_background_blur") return "-8";
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState()).toMatchObject({
      dshBackgroundOpacity: 100,
      dshBackgroundBlur: 0,
    });
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

  it("adds DSH in canonical order without re-enabling hidden top-bar items", () => {
    expect(includeDshTopBarItem(["search", "ai"])).toEqual(["search", "dsh", "ai"]);
  });

  it("respects a saved top-bar list that hides the DSH/tools/browser shortcuts", async () => {
    // Seeding is gated on "no saved DB list" (see loadFromDB), not a localStorage
    // flag, so a user who has customized their top bar — e.g. hidden the DSH,
    // tools and browser shortcuts, keeping only search + ai — must not have
    // those icons re-added on every load. This is the regression behind
    // "toggle mobile browser / tool use never persists, icons reappear".
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command === "db_get_setting" && args?.key === "visible_topbar_items") {
        return JSON.stringify(["search", "ai"]);
      }
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState().visibleTopBarItems).toEqual(["search", "ai"]);
  });

  it("does not re-add hidden shortcuts when localStorage migration flags are absent", async () => {
    // The old migrations keyed off localStorage flags; if those were ever
    // cleared the icons reappeared. The fix gates seeding on the DB list
    // instead, so even with no localStorage flags a saved list is respected.
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command === "db_get_setting" && args?.key === "visible_topbar_items") {
        return JSON.stringify(["search", "dsh", "theme", "updates"]);
      }
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    // tools + browser were hidden; they must stay hidden with no flag set.
    expect(useSettingsStore.getState().visibleTopBarItems).toEqual(["search", "dsh", "theme", "updates"]);
  });

  it("adds the tools/browser top-bar icons in canonical order without re-enabling hidden items", () => {
    expect(includeTopBarItems(["search", "ai"], ["tools", "browser"])).toEqual(["search", "tools", "browser", "ai"]);
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

  it("restores a wallpaper gallery from per-slot rows", async () => {
    invoke.mockImplementation(async (command: string, args?: { key?: string }) => {
      if (command !== "db_get_setting") return null;
      if (args?.key === "app_background_image_0") return JSON.stringify("first");
      if (args?.key === "app_background_image_1") return JSON.stringify("");
      if (args?.key === "app_background_image_2") return JSON.stringify("third");
      if (args?.key === "app_background_image_3") return JSON.stringify("fourth");
      if (args?.key === "app_background_image_4") return JSON.stringify("");
      if (args?.key === "app_background_image_index") return "3";
      // Slot-aligned fixed-length positions: the empty slot 1 still maps by slot.
      if (args?.key === "app_background_image_positions") {
        return JSON.stringify([
          { x: 10, y: 20 }, { x: 50, y: 50 }, { x: 30, y: 40 }, { x: 80, y: 90 }, { x: 50, y: 50 },
        ]);
      }
      return null;
    });

    await useSettingsStore.getState().loadFromDB();

    expect(useSettingsStore.getState()).toMatchObject({
      // Slot 1 is empty, so the compact list skips it but positions stay paired.
      appBackgroundImage: "fourth",
      appBackgroundImages: ["first", "third", "fourth"],
      appBackgroundImageIndex: 2,
      appBackgroundImagePosition: { x: 80, y: 90 },
    });
  });

  it("persists only the changed wallpaper slot, not the whole gallery", async () => {
    useSettingsStore.setState({ appBackgroundImages: ["one", "two", "three", "four"] });

    useSettingsStore.getState().setAppBackgroundImages(
      ["one", "two", "three", "four", "five"],
      4,
      [
        { x: 10, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 40 },
        { x: 40, y: 50 }, { x: 60, y: 70 },
      ],
    );

    await vi.waitFor(() => {
      // Slot 4 is new; slots 0-3 are unchanged and must NOT be written.
      expect(invoke).toHaveBeenCalledWith("db_set_setting", {
        key: "app_background_image_4",
        value: JSON.stringify("five"),
      });
    });
    expect(invoke).not.toHaveBeenCalledWith("db_set_setting", { key: "app_background_image_0", value: expect.anything() });
    expect(invoke).not.toHaveBeenCalledWith("db_set_setting", { key: "app_background_image_1", value: expect.anything() });
    expect(invoke).not.toHaveBeenCalledWith("db_set_setting", { key: "app_background_image_2", value: expect.anything() });
    expect(invoke).not.toHaveBeenCalledWith("db_set_setting", { key: "app_background_image_3", value: expect.anything() });
  });

  it("writes only slot 0 when setting a single app background image", async () => {
    useSettingsStore.getState().setAppBackgroundImage("data:image/png;base64,only");

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("db_set_setting", {
        key: "app_background_image_0",
        value: JSON.stringify("data:image/png;base64,only"),
      });
    });
    expect(invoke).not.toHaveBeenCalledWith("db_set_setting", { key: "app_background_image_1", value: expect.anything() });
    expect(invoke).not.toHaveBeenCalledWith("db_set_setting", { key: "app_background_image_4", value: expect.anything() });
  });
});
