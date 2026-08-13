import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/ipc/backend", () => ({ invoke }));

import { TerminalSection } from "./TerminalSection";
import { useSettingsStore } from "@/store/settingsStore";

describe("TerminalSection typography", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) =>
      command === "pty_default_shell" ? "/usr/bin/fish" : null);
    useSettingsStore.setState({
      uiLanguage: "en",
      terminalFontFamily: "ui-monospace",
      terminalFontSize: 13,
      terminalRenderer: "auto",
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

  it("changes the terminal renderer preference", () => {
    render(<TerminalSection />);

    fireEvent.change(screen.getByRole("combobox", { name: "Renderer" }), {
      target: { value: "dom" },
    });

    expect(useSettingsStore.getState().terminalRenderer).toBe("dom");
  });

  it("shows the shell actually used by default without persisting it as an override", async () => {
    render(<TerminalSection />);

    const input = screen.getByRole("textbox", { name: "Shell path" });
    await waitFor(() => expect(input).toHaveValue("/usr/bin/fish"));
    expect(invoke).toHaveBeenCalledWith("pty_default_shell");
    expect(useSettingsStore.getState().terminalShellPath).toBe("");
  });
});
