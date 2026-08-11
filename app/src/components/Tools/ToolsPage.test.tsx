import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform", () => ({
  hostCapabilities: { terminal: true },
}));

vi.mock("./ImageReducerTool", () => ({
  ImageReducerTool: () => <div>Image reducer workspace</div>,
}));

vi.mock("./TerminalTool", () => ({
  TerminalTool: ({ visible }: { visible?: boolean }) => (
    <div data-testid="live-terminal" data-visible={String(visible)}>
      Live terminal workspace
    </div>
  ),
}));

import { ToolsPage } from "./ToolsPage";

describe("ToolsPage lifecycle", () => {
  it("keeps the active terminal mounted while navigation hides the page", () => {
    const view = render(<ToolsPage visible />);

    fireEvent.click(screen.getByRole("button", { name: /Terminal/i }));
    expect(screen.getByTestId("live-terminal")).toHaveAttribute("data-visible", "true");

    view.rerender(<ToolsPage visible={false} />);
    expect(screen.getByTestId("tools-page-host")).not.toBeVisible();
    expect(screen.getByTestId("live-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("live-terminal")).toHaveAttribute("data-visible", "false");

    view.rerender(<ToolsPage visible />);
    expect(screen.getByTestId("tools-page-host")).toBeVisible();
    expect(screen.getByTestId("live-terminal")).toHaveAttribute("data-visible", "true");
  });
});
