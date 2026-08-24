import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { open, reload, invoke } = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => null),
}));

vi.mock("@/platform", () => ({ isDesktopHost: true }));
vi.mock("@/ipc/backend", () => ({ invoke }));
vi.mock("@/ipc/shell", () => ({ openExternal: vi.fn(async () => {}) }));
vi.mock("./useBrowserPanel", () => ({
  useBrowserPanel: () => ({
    setContainer: vi.fn(),
    tabs: [{ key: "tab-1", panelId: "panel-1", url: "https://github.com", title: "GitHub", loading: false, atHome: false, preview: null }],
    active: { key: "tab-1", panelId: "panel-1", url: "https://github.com", title: "GitHub", loading: false, atHome: false, preview: null },
    error: null,
    open,
    reload,
    goBack: vi.fn(),
    goForward: vi.fn(),
    goHome: vi.fn(),
    clearData: vi.fn(),
    newTab: vi.fn(),
    selectTab: vi.fn(),
    closeTab: vi.fn(),
  }),
}));

import BrowserPage from "./BrowserPage";

beforeEach(() => {
  open.mockClear();
  reload.mockClear();
  invoke.mockClear();
});

describe("BrowserPage in a narrow workspace pane", () => {
  it("keeps the address field usable and scrolls excess toolbar actions", () => {
    render(<BrowserPage />);

    const address = screen.getByRole("textbox");
    const addressShell = address.parentElement!;
    const toolbar = addressShell.parentElement!;
    expect(addressShell).toHaveClass("min-w-40");
    expect(toolbar).toHaveClass("overflow-x-auto");

    fireEvent.change(address, { target: { value: "example.com" } });
    fireEvent.keyDown(address, { key: "Enter" });
    expect(open).toHaveBeenCalledWith("example.com");
  });

  it("reloads the active page after the blocker state reaches Electron", async () => {
    render(<BrowserPage />);

    fireEvent.click(screen.getByRole("button", { name: "Ad blocker on" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "browser_set_adblock_enabled",
      { enabled: false },
    ));
    expect(reload).toHaveBeenCalledTimes(1);
    const blockerCall = invoke.mock.invocationCallOrder.find((_, index) =>
      invoke.mock.calls[index][0] === "browser_set_adblock_enabled"
        && (invoke.mock.calls[index][1] as { enabled?: boolean }).enabled === false,
    );
    expect(blockerCall).toBeLessThan(reload.mock.invocationCallOrder[0]);
  });
});
