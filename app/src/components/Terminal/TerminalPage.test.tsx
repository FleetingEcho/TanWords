import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspaceThrows: false }));

vi.mock("@/components/Tools/TerminalWorkspace", () => ({
  TerminalWorkspace: ({ visible, maximized }: { visible: boolean; maximized: boolean }) => {
    if (mocks.workspaceThrows) throw new Error("terminal exploded");
    return <div data-testid="terminal-workspace" data-visible={visible} data-maximized={maximized} />;
  },
}));

import { TerminalPage } from "./TerminalPage";

describe("TerminalPage", () => {
  beforeEach(() => {
    mocks.workspaceThrows = false;
  });

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

  it("isolates terminal failures and can remount a fresh workspace", () => {
    mocks.workspaceThrows = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    const onMaximizedChange = vi.fn();

    render(
      <TerminalPage
        visible
        maximized
        onClose={onClose}
        onMaximizedChange={onMaximizedChange}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Terminal view stopped");
    expect(screen.getByText("terminal exploded")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-workspace")).not.toBeInTheDocument();

    mocks.workspaceThrows = false;
    fireEvent.click(screen.getByRole("button", { name: "Restart terminal" }));
    expect(screen.getByTestId("terminal-workspace")).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("can leave a failed terminal without taking down the app", () => {
    mocks.workspaceThrows = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    const onMaximizedChange = vi.fn();

    render(
      <TerminalPage
        visible
        maximized
        onClose={onClose}
        onMaximizedChange={onMaximizedChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to app" }));

    expect(onMaximizedChange).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
