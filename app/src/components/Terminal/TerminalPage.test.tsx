import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/Tools/TerminalWorkspace", () => ({
  TerminalWorkspace: ({ visible, maximized }: { visible: boolean; maximized: boolean }) => (
    <div data-testid="terminal-workspace" data-visible={visible} data-maximized={maximized} />
  ),
}));

import { TerminalPage } from "./TerminalPage";

describe("TerminalPage", () => {
  it("is a standalone persistent host that can be hidden without unmounting", () => {
    const props = {
      maximized: false,
      onMaximizedChange: vi.fn(),
      onClose: vi.fn(),
    };
    const view = render(<TerminalPage {...props} visible />);

    expect(screen.getByTestId("terminal-page-host")).toBeVisible();
    view.rerender(<TerminalPage {...props} visible={false} />);

    expect(screen.getByTestId("terminal-page-host")).not.toBeVisible();
    expect(screen.getByTestId("terminal-workspace")).toBeInTheDocument();
  });
});
