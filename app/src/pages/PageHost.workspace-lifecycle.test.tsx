import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  terminalUnmounts: 0,
  dshUnmounts: 0,
}));

vi.mock("@/platform", () => ({
  isDesktopHost: true,
  isWebHost: false,
  hostCapabilities: { terminal: true, dsh: true },
}));

vi.mock("@/pages/StartupReadySignal", () => ({ StartupReadySignal: () => null }));
vi.mock("@/pages/adapters/ReactPageAdapter", () => ({ ReactPageAdapter: () => null }));
vi.mock("@/pages/adapters/BrowserPageAdapter", () => ({ BrowserPageAdapter: () => null }));
vi.mock("@/pages/adapters/ToolsPageAdapter", () => ({ ToolsPageAdapter: () => null }));
vi.mock("@/pages/adapters/TerminalPageAdapter", () => ({
  TerminalPageAdapter: ({ visible }: { visible: boolean }) => {
    useEffect(() => () => { lifecycle.terminalUnmounts += 1; }, []);
    return <div data-testid="terminal-adapter" data-visible={String(visible)} />;
  },
}));
vi.mock("@/pages/adapters/DshPageAdapter", () => ({
  DshPageAdapter: ({ visible }: { visible: boolean }) => {
    useEffect(() => () => { lifecycle.dshUnmounts += 1; }, []);
    return <div data-testid="dsh-adapter" data-visible={String(visible)} />;
  },
}));

import { PageHost } from "./PageHost";

describe("PageHost workspace lifecycle", () => {
  beforeEach(() => {
    lifecycle.terminalUnmounts = 0;
    lifecycle.dshUnmounts = 0;
  });

  it("hides a running terminal for a workspace without unmounting it", () => {
    const view = render(<PageHost activePage="terminal" />);
    expect(screen.getByTestId("terminal-adapter")).toHaveAttribute("data-visible", "true");

    view.rerender(<PageHost activePage="terminal" visible={false} />);

    expect(screen.getByTestId("terminal-adapter")).toHaveAttribute("data-visible", "false");
    expect(lifecycle.terminalUnmounts).toBe(0);
  });

  it("hides a running DSH page for a workspace without unmounting it", () => {
    const view = render(<PageHost activePage="dsh" />);
    expect(screen.getByTestId("dsh-adapter")).toHaveAttribute("data-visible", "true");

    view.rerender(<PageHost activePage="dsh" visible={false} />);

    expect(screen.getByTestId("dsh-adapter")).toHaveAttribute("data-visible", "false");
    expect(lifecycle.dshUnmounts).toBe(0);
  });
});
