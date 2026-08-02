import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/api/client", () => ({ invoke }));

import { useSettingsStore } from "./settingsStore";

describe("settingsStore database hydration", () => {
  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
    useSettingsStore.setState({ appBackgroundVisible: true, isLoaded: false });
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
});
