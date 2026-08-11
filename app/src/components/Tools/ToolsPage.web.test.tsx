import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform", () => ({
  hostCapabilities: { terminal: false },
}));

vi.mock("./ImageReducerTool", () => ({
  ImageReducerTool: () => <div>Image reducer workspace</div>,
}));

vi.mock("./TerminalWorkspace", () => ({
  TerminalWorkspace: () => <div>Terminal workspace must not render</div>,
}));

import { ToolsPage } from "./ToolsPage";
import { useSettingsStore } from "@/store/settingsStore";

describe("ToolsPage web capabilities", () => {
  beforeEach(() => useSettingsStore.setState({ uiLanguage: "en" }));

  it("does not expose or mount the desktop terminal", () => {
    render(<ToolsPage />);

    expect(screen.queryByRole("button", { name: /Terminal/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Terminal workspace must not render")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Image reducer/i })).toBeInTheDocument();
  });
});
