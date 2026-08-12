import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./TerminalTool", () => ({
  TerminalTool: ({
    visible,
    shellPath,
    tabBar,
    onSessionExit,
    maximized,
    onMaximizedChange,
  }: {
    visible?: boolean;
    shellPath?: string;
    tabBar?: ReactNode;
    onSessionExit?: () => void;
    maximized?: boolean;
    onMaximizedChange?: (maximized: boolean) => void;
  }) => (
    <div data-testid="terminal-session" data-visible={String(visible)} data-shell={shellPath}>
      <div data-testid="terminal-toolbar">terminal toolbar</div>
      {tabBar}
      <div data-testid="terminal-shell">terminal session</div>
      <button type="button" onClick={onSessionExit}>Exit terminal session</button>
      <button type="button" onClick={() => onMaximizedChange?.(!maximized)}>
        {maximized ? "Restore terminal" : "Maximize terminal"}
      </button>
    </div>
  ),
}));

import { TerminalWorkspace } from "./TerminalWorkspace";
import { useSettingsStore } from "@/store/settingsStore";

describe("TerminalWorkspace tabs", () => {
  beforeEach(() => {
    useSettingsStore.setState({ uiLanguage: "en", terminalShellPath: "/bin/fish" });
  });

  it("keeps switched tabs mounted and captures shell settings only for new tabs", () => {
    render(<TerminalWorkspace onBack={() => {}} />);

    expect(screen.getAllByTestId("terminal-session")).toHaveLength(1);
    expect(screen.getByTestId("terminal-session")).toHaveAttribute("data-shell", "/bin/fish");

    useSettingsStore.setState({ terminalShellPath: "/bin/zsh" });
    fireEvent.click(screen.getByRole("button", { name: "New terminal tab" }));

    const sessions = screen.getAllByTestId("terminal-session");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toHaveAttribute("data-shell", "/bin/fish");
    expect(sessions[0]).toHaveAttribute("data-visible", "false");
    expect(sessions[1]).toHaveAttribute("data-shell", "/bin/zsh");
    expect(sessions[1]).toHaveAttribute("data-visible", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Terminal 1" }));
    expect(sessions[0]).toHaveAttribute("data-visible", "true");
    expect(sessions[1]).toHaveAttribute("data-visible", "false");
  });

  it("limits the workspace to two live terminal tabs and frees a slot on close", () => {
    render(<TerminalWorkspace onBack={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "New terminal tab" }));

    expect(screen.getAllByTestId("terminal-session")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "New terminal tab" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Close terminal tab 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getAllByTestId("terminal-session")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "New terminal tab" })).toBeEnabled();
  });

  it("places the tab switcher inside the terminal, between its toolbar and shell", () => {
    render(<TerminalWorkspace onBack={() => {}} />);

    const terminal = screen.getByTestId("terminal-session");
    const toolbar = screen.getByTestId("terminal-toolbar");
    const tabList = screen.getByRole("tablist", { name: "Terminal tabs" });
    const shell = screen.getByTestId("terminal-shell");

    expect(terminal).toContainElement(tabList);
    expect(toolbar.compareDocumentPosition(tabList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabList.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps maximize state at workspace level and restores chrome when hidden", () => {
    const onMaximizedChange = vi.fn();
    const view = render(
      <TerminalWorkspace
        onBack={() => {}}
        maximized
        onMaximizedChange={onMaximizedChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Restore terminal" })).toBeInTheDocument();
    view.rerender(
      <TerminalWorkspace
        onBack={() => {}}
        visible={false}
        maximized
        onMaximizedChange={onMaximizedChange}
      />,
    );

    expect(onMaximizedChange).toHaveBeenCalledWith(false);
  });

  it("closes one session without unmounting the others", () => {
    render(<TerminalWorkspace onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "New terminal tab" }));
    fireEvent.click(screen.getByRole("button", { name: "Close terminal tab 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getAllByTestId("terminal-session")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Terminal 1" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes a tab immediately when its shell exits naturally", () => {
    render(<TerminalWorkspace onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "New terminal tab" }));

    fireEvent.click(screen.getByRole("button", { name: "Exit terminal session" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("terminal-session")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Terminal 1" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens a fresh shell after the final terminal exits", () => {
    const onBack = vi.fn();
    const view = render(<TerminalWorkspace onBack={onBack} visible />);

    fireEvent.click(screen.getByRole("button", { name: "Exit terminal session" }));
    expect(onBack).toHaveBeenCalledOnce();

    view.rerender(<TerminalWorkspace onBack={onBack} visible={false} />);
    view.rerender(<TerminalWorkspace onBack={onBack} visible />);
    expect(screen.getByRole("tab", { name: "Terminal 2" })).toHaveAttribute("aria-selected", "true");
  });

  it("renames a tab through its right-click modal", () => {
    render(<TerminalWorkspace onBack={() => {}} />);

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Terminal 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Tab name" });
    fireEvent.change(input, { target: { value: "Server logs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("tab", { name: "Server logs" })).toBeInTheDocument();
  });

  it("stars and pins tabs from the right-click menu", () => {
    render(<TerminalWorkspace onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "New terminal tab" }));

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Terminal 2" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Star" }));
    expect(screen.getByRole("tab", { name: "Terminal 2" })).toHaveAttribute("data-starred", "true");

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Terminal 2" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    const names = screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"));
    expect(names).toEqual(["Terminal 2", "Terminal 1"]);
  });

  it("always confirms before closing from either the tab button or context menu", () => {
    const onBack = vi.fn();
    render(<TerminalWorkspace onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Close terminal tab 1" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-session")).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Terminal 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
