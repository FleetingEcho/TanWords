import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settingsStore";
import { AppThemeMenu, THEME_CHOICES } from "./AppThemeMenu";

const originalSetTheme = useSettingsStore.getState().setTheme;

describe("AppThemeMenu", () => {
  const setTheme = vi.fn();

  beforeEach(() => {
    setTheme.mockReset();
    useSettingsStore.setState({ theme: "dark", uiLanguage: "en", setTheme });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ theme: "system", setTheme: originalSetTheme });
  });

  it("offers every app theme and applies the selected one", async () => {
    render(<AppThemeMenu trigger={<button type="button">Choose theme</button>} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Choose theme" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findAllByRole("menuitem")).toHaveLength(THEME_CHOICES.length);
    fireEvent.click(screen.getByRole("menuitem", { name: /Dracula/ }));
    expect(setTheme).toHaveBeenCalledWith("dracula");
  });
});
