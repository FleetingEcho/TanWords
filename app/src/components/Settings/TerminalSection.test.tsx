import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, openExternal } = vi.hoisted(() => ({ invoke: vi.fn(), openExternal: vi.fn() }));
vi.mock("@/ipc/backend", () => ({ invoke }));
vi.mock("@/ipc/shell", () => ({ openExternal }));

import { TerminalSection } from "./TerminalSection";
import { useSettingsStore } from "@/store/settingsStore";

describe("TerminalSection typography", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    invoke.mockReset();
    openExternal.mockReset();
    openExternal.mockResolvedValue(undefined);
    invoke.mockImplementation(async (command: string) =>
      command === "pty_default_shell" ? "/usr/bin/fish" : null);
    useSettingsStore.setState({
      uiLanguage: "en",
      terminalFontFamily: "ui-monospace",
      terminalFontSize: 13,
      terminalFontWeight: 400,
      terminalRenderer: "auto",
      terminalBackgroundColor: "#1a1b26",
      terminalTextColor: "#c0caf5",
      terminalColorScheme: "tokyo-night",
      terminalShellPath: "",
    });
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      value: vi.fn().mockResolvedValue([
        { family: "JetBrains Mono" },
        { family: "Fira Code" },
        { family: "JetBrains Mono" },
      ]),
    });
  });

  it("reads installed machine font families and applies typography settings", async () => {
    render(<TerminalSection />);

    fireEvent.click(screen.getByRole("combobox", { name: "Font family" }));
    await screen.findByText("2 font families available");
    expect(screen.getByRole("option", { name: "System monospace" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "App font (Inter)" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search fonts" }), {
      target: { value: "jetbrains" },
    });
    expect(screen.queryByRole("option", { name: "Fira Code" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "JetBrains Mono" }));
    await waitFor(() => expect(useSettingsStore.getState().terminalFontFamily).toBe("JetBrains Mono"));

    fireEvent.change(screen.getByRole("slider", { name: "Font size" }), {
      target: { value: "18" },
    });
    expect(useSettingsStore.getState().terminalFontSize).toBe(18);

    fireEvent.change(screen.getByRole("slider", { name: "Font weight" }), {
      target: { value: "600" },
    });
    expect(useSettingsStore.getState().terminalFontWeight).toBe(600);
  });

  it("stores a device shell override and explains the new-tab boundary", () => {
    render(<TerminalSection />);

    const input = screen.getByRole("textbox", { name: "Shell path" });
    fireEvent.change(input, { target: { value: " C:\\Program Files\\Git\\bin\\bash.exe " } });
    fireEvent.blur(input);

    expect(useSettingsStore.getState().terminalShellPath)
      .toBe("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(screen.getByText(/Changes apply only to new terminal tabs/i)).toBeInTheDocument();
  });

  it("shows the scrollback limit and Herdr recommendation in settings", () => {
    render(<TerminalSection />);

    expect(screen.getByText("Scrollback history")).toBeInTheDocument();
    expect(screen.getByText("Each terminal tab retains up to 5,000 scrollback lines."))
      .toBeInTheDocument();
    expect(screen.getByText(/recommend managing your sessions with Herdr/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open Herdr on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/herdrdev/herdr");

    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith("https://github.com/herdrdev/herdr");
  });

  it("changes the terminal renderer preference", () => {
    render(<TerminalSection />);

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Renderer" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "DOM (glass-safe)" }));

    expect(useSettingsStore.getState().terminalRenderer).toBe("dom");
  });

  it("selects a terminal palette and supports a custom text color", () => {
    render(<TerminalSection />);

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Theme" }), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Tokyo Night" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Dracula" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Glass Light" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "High Contrast" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4);
    fireEvent.click(screen.getByRole("option", { name: "Dracula" }));
    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "dracula",
      terminalBackgroundColor: "#282a36",
      terminalTextColor: "#f8f8f2",
    });

    const textColorPicker = screen.getAllByLabelText("Text color")
      .find((element) => element.getAttribute("type") === "color")!;
    fireEvent.change(textColorPicker, {
      target: { value: "#aabbcc" },
    });
    expect(useSettingsStore.getState().terminalTextColor).toBe("#aabbcc");
    expect(useSettingsStore.getState().terminalColorScheme).toBe("custom");
  });

  it("shows the shell actually used by default without persisting it as an override", async () => {
    render(<TerminalSection />);

    const input = screen.getByRole("textbox", { name: "Shell path" });
    await waitFor(() => expect(input).toHaveValue("/usr/bin/fish"));
    expect(invoke).toHaveBeenCalledWith("pty_default_shell");
    expect(useSettingsStore.getState().terminalShellPath).toBe("");
  });
});
