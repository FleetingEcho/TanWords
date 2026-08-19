import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  let terminalOptions: Record<string, unknown> | null = null;
  let imageOptions: Record<string, unknown> | null = null;
  let clipboardValue: unknown = null;
  let contextLossHandler: (() => void) | null = null;
  let searchResultsHandler: ((result: { resultIndex: number; resultCount: number }) => void) | null = null;
  let resizeHandler: (() => void) | null = null;
  let titleHandler: ((title: string) => void) | null = null;
  let csiHandler: ((params: (number | number[])[]) => boolean | Promise<boolean>) | null = null;
  let spawnInfo: { id: string; shell: string; cwd: string; pid: number } | null = null;
  let windowState = { maximized: false, fullScreen: false };
  let deferWrites = false;
  const pendingWriteCallbacks: Array<() => void> = [];
  const eventHandlers = new Map<string, (payload: any) => void>();
  const fit = vi.fn();
  const image = { dispose: vi.fn() };
  const webgl = {
    dispose: vi.fn(),
    onContextLoss: vi.fn((handler: () => void) => {
      contextLossHandler = handler;
      return { dispose: vi.fn() };
    }),
  };
  const search = {
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn(),
    clearActiveDecoration: vi.fn(),
    dispose: vi.fn(),
    onDidChangeResults: vi.fn((handler: typeof searchResultsHandler) => {
      searchResultsHandler = handler;
      return { dispose: vi.fn() };
    }),
  };
  const terminal = {
    cols: 80,
    rows: 24,
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn((_data: Uint8Array, callback?: () => void) => {
      if (!callback) return;
      if (deferWrites) pendingWriteCallbacks.push(callback);
      else callback();
    }),
    focus: vi.fn(),
    dispose: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    onTitleChange: vi.fn((handler: (title: string) => void) => {
      titleHandler = handler;
      return { dispose: vi.fn() };
    }),
    parser: {
      registerCsiHandler: vi.fn((
        _id: { final: string },
        handler: (params: (number | number[])[]) => boolean | Promise<boolean>,
      ) => {
        csiHandler = handler;
        return { dispose: vi.fn() };
      }),
    },
    input: vi.fn(),
    _core: {
      _renderService: {
        dimensions: {
          css: {
            canvas: { width: 800, height: 500 },
            cell: { width: 8, height: 16 },
          },
          device: {
            canvas: { width: 1600, height: 1000 },
            cell: { width: 16, height: 32 },
          },
        },
      },
    },
    attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      keyHandler = handler;
    }),
    options: {} as Record<string, unknown>,
  };
  const callMain = vi.fn((channel: string) => {
    if (channel === "pty_spawn") return spawnInfo ? Promise.resolve(spawnInfo) : new Promise(() => {});
    if (channel === "clipboard:readForTerminal") return Promise.resolve(clipboardValue);
    return Promise.resolve(null);
  });
  const openExternal = vi.fn(() => Promise.resolve());
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  return {
    terminal,
    image,
    webgl,
    search,
    callMain,
    openExternal,
    toastSuccess,
    toastError,
    getKeyHandler: () => keyHandler,
    getTerminalOptions: () => terminalOptions,
    getImageOptions: () => imageOptions,
    triggerContextLoss: () => contextLossHandler?.(),
    emitSearchResults: (result: { resultIndex: number; resultCount: number }) => searchResultsHandler?.(result),
    triggerResize: () => resizeHandler?.(),
    emitTitle: (title: string) => titleHandler?.(title),
    emitCsi: (params: (number | number[])[]) => csiHandler?.(params),
    emit: (event: string, payload: unknown) => eventHandlers.get(event)?.(payload),
    setSpawnInfo: (value: typeof spawnInfo) => { spawnInfo = value; },
    setWindowState: (value: typeof windowState) => { windowState = value; },
    getWindowState: () => windowState,
    setDeferWrites: (value: boolean) => { deferWrites = value; },
    flushWrites: () => {
      while (pendingWriteCallbacks.length > 0) pendingWriteCallbacks.shift()!();
    },
    subscribe: (event: string, handler: (payload: any) => void) => {
      eventHandlers.set(event, handler);
      return () => { eventHandlers.delete(event); };
    },
    setResizeHandler: (handler: () => void) => { resizeHandler = handler; },
    fit,
    setClipboardValue: (value: unknown) => { clipboardValue = value; },
    reset: () => {
      keyHandler = null;
      terminalOptions = null;
      imageOptions = null;
      contextLossHandler = null;
      searchResultsHandler = null;
      resizeHandler = null;
      titleHandler = null;
      csiHandler = null;
      spawnInfo = null;
      windowState = { maximized: false, fullScreen: false };
      deferWrites = false;
      pendingWriteCallbacks.length = 0;
      eventHandlers.clear();
      terminal.options = {};
    },
    setTerminalOptions: (options: Record<string, unknown>) => { terminalOptions = options; },
    setImageOptions: (options: Record<string, unknown>) => { imageOptions = options; },
  };
});

// The engine switch is desktop-only (web forces every tab onto restty — see
// `TerminalWorkspace.tsx`'s `newTab`), so pin the host to desktop here.
vi.mock("@/platform", () => ({ isDesktopHost: true }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor(options: Record<string, unknown>) {
      mocks.setTerminalOptions(options);
      return mocks.terminal;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = mocks.fit; } }));
vi.mock("@xterm/addon-image", () => ({
  ImageAddon: class {
    constructor(options: Record<string, unknown>) {
      mocks.setImageOptions(options);
      return mocks.image;
    }
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    constructor() { return mocks.search; }
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() { return mocks.webgl; }
  },
}));
vi.mock("@/ipc/events", () => ({ subscribe: mocks.subscribe }));
vi.mock("@/ipc/host", () => ({ callMain: mocks.callMain }));
vi.mock("@/hooks/useWindowState", () => ({ useWindowState: mocks.getWindowState }));
vi.mock("@/ipc/shell", () => ({ openExternal: mocks.openExternal }));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import {
  TERMINAL_OUTPUT_HIGH_WATER_BYTES,
  TERMINAL_OUTPUT_LOW_WATER_BYTES,
  quoteTerminalPath,
  shellTabTitle,
  terminalFontStack,
  terminalOutputBytes,
  terminalPixelSizeReport,
} from "./terminalUtils";
import { TerminalTool } from "./TerminalTool";
import { useSettingsStore } from "@/store/settingsStore";

describe("TerminalTool interaction: context menu, search, and transparency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
    mocks.setClipboardValue(null);
    mocks.terminal.hasSelection.mockReturnValue(false);
    mocks.terminal.getSelection.mockReturnValue("");
    useSettingsStore.setState({
      terminalTransparent: false,
      terminalBackgroundBlur: 12,
      terminalBackgroundOpacity: 16,
      terminalBackgroundColor: "#1a1b26",
      terminalTextColor: "#c0caf5",
      terminalColorScheme: "tokyo-night",
      terminalCustomAppearance: {
        backgroundColor: "#1a1b26",
        textColor: "#c0caf5",
        transparent: false,
        blur: 12,
        opacity: 16,
      },
      terminalRenderer: "auto",
      appBackgroundImage: "",
      appBackgroundVisible: true,
      appBackgroundBlur: 20,
      terminalFontFamily: "ui-monospace",
      terminalFontSize: 13,
      terminalFontWeight: 400,
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(handler: () => void) { mocks.setResizeHandler(handler); }
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 500 });
  });

  function renderTerminal() {
    const result = render(<TerminalTool onBack={() => {}} />);
    const shell = result.container.querySelector(".terminal-tool-shell");
    expect(shell).not.toBeNull();
    return { ...result, shell: shell! };
  }

  async function waitForConnected() {
    await waitFor(() => {
      expect(screen.queryByText("Starting…")).not.toBeInTheDocument();
    });
  }

  it("opens a right-click menu and copies the xterm selection", async () => {
    mocks.terminal.hasSelection.mockReturnValue(true);
    mocks.terminal.getSelection.mockReturnValue("selected output");
    const { shell } = renderTerminal();

    fireEvent.contextMenu(shell, { clientX: 40, clientY: 60 });
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy/ }));

    expect(mocks.callMain).toHaveBeenCalledWith("clipboard:writeText", {
      text: "selected output",
    });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Copied"));
  });

  it("does not cover a terminal program's context menu when nothing is selected", () => {
    const { shell } = renderTerminal();

    const allowed = fireEvent.contextMenu(shell, { clientX: 40, clientY: 60 });

    expect(allowed).toBe(false);
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument();

    mocks.terminal.hasSelection.mockReturnValue(true);
    fireEvent.contextMenu(shell);
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument();

    mocks.terminal.hasSelection.mockReturnValue(false);
    fireEvent.contextMenu(shell);
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument();
  });

  it("reports a right-click copy failure", async () => {
    mocks.terminal.hasSelection.mockReturnValue(true);
    mocks.terminal.getSelection.mockReturnValue("selected output");
    const { shell } = renderTerminal();
    mocks.callMain.mockRejectedValueOnce(new Error("clipboard unavailable"));

    fireEvent.contextMenu(shell, { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy/ }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Could not copy terminal text");
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("passes terminal keys through without assigning TanWords shortcuts", () => {
    renderTerminal();
    const handler = mocks.getKeyHandler();
    expect(handler).not.toBeNull();

    for (const event of [
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      new KeyboardEvent("keydown", { key: "c", ctrlKey: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "v", metaKey: true, cancelable: true }),
    ]) {
      expect(handler!(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(mocks.callMain).not.toHaveBeenCalledWith("clipboard:writeText", expect.anything());
    expect(mocks.callMain).not.toHaveBeenCalledWith("clipboard:readForTerminal");
  });

  it("forwards Ctrl+Enter as a modified key for the foreground terminal program", async () => {
    mocks.setSpawnInfo({ id: "terminal-1", shell: "/bin/bash", cwd: "/tmp", pid: 42 });
    renderTerminal();
    await waitFor(() => expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", expect.anything()));
    mocks.callMain.mockClear();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      cancelable: true,
    });
    expect(mocks.getKeyHandler()!(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.callMain).toHaveBeenCalledWith("pty_write", {
      id: "terminal-1",
      data: "G1sxMzs1dQ==",
    });

    mocks.callMain.mockClear();
    expect(mocks.getKeyHandler()!(new KeyboardEvent("keyup", {
      key: "Enter",
      ctrlKey: true,
    }))).toBe(false);
    expect(mocks.callMain).not.toHaveBeenCalled();
  });

  it("does not consume Escape from xterm to close its context menu", () => {
    mocks.terminal.hasSelection.mockReturnValue(true);
    const { shell } = renderTerminal();
    fireEvent.contextMenu(shell);

    fireEvent.keyDown(shell, { key: "Escape" });

    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument();
  });

  it("searches scrollback, highlights matches, and navigates results", async () => {
    renderTerminal();
    // Simulate a terminal instance retained across Vite Fast Refresh from
    // before proposed decoration APIs were enabled.
    mocks.terminal.options.allowProposedApi = false;

    fireEvent.click(screen.getByRole("button", { name: "Search terminal" }));
    const searchBar = screen.getByRole("search");
    const input = await screen.findByRole("searchbox", { name: "Terminal search query" });
    expect(searchBar).toHaveClass("bg-transparent");
    expect(searchBar).not.toHaveClass("bg-background/75", "backdrop-blur-md");
    fireEvent.change(input, { target: { value: "build complete" } });
    expect(mocks.terminal.options.allowProposedApi).toBe(true);
    expect(mocks.search.findNext).toHaveBeenCalledWith(
      "build complete",
      expect.objectContaining({
        caseSensitive: false,
        incremental: true,
        decorations: expect.objectContaining({
          matchBackground: expect.any(String),
          activeMatchBackground: expect.any(String),
        }),
      }),
    );

    act(() => mocks.emitSearchResults({ resultIndex: 1, resultCount: 4 }));
    expect(screen.getByText("2 / 4")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.search.findNext).toHaveBeenLastCalledWith(
      "build complete",
      expect.objectContaining({ incremental: false }),
    );

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(mocks.search.findPrevious).toHaveBeenCalledWith(
      "build complete",
      expect.objectContaining({ incremental: false }),
    );
  });

  it("supports case-sensitive search and clears highlights when closed", async () => {
    renderTerminal();
    fireEvent.click(screen.getByRole("button", { name: "Search terminal" }));
    const input = await screen.findByRole("searchbox", { name: "Terminal search query" });
    fireEvent.change(input, { target: { value: "Error" } });

    fireEvent.click(screen.getByRole("button", { name: "Match case" }));
    expect(mocks.search.findNext).toHaveBeenLastCalledWith(
      "Error",
      expect.objectContaining({ caseSensitive: true, incremental: true }),
    );

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "Terminal search query" })).not.toBeInTheDocument();
    expect(mocks.search.clearDecorations).toHaveBeenCalled();
    expect(mocks.terminal.focus).toHaveBeenCalled();
  });

  it("pastes clipboard text from the context menu", async () => {
    mocks.terminal.hasSelection.mockReturnValue(true);
    mocks.setClipboardValue({ kind: "text", text: "echo hello" });
    const { shell } = renderTerminal();

    fireEvent.contextMenu(shell);
    fireEvent.click(screen.getByRole("menuitem", { name: /Paste/ }));
    await waitFor(() => expect(mocks.terminal.paste).toHaveBeenCalledWith("echo hello"));
  });

  it("pastes a safely escaped temporary image path from the context menu", async () => {
    mocks.terminal.hasSelection.mockReturnValue(true);
    mocks.setClipboardValue({ kind: "image", path: "/tmp/Tan Words/image (1).png" });
    const { shell } = renderTerminal();

    fireEvent.contextMenu(shell);
    fireEvent.click(screen.getByRole("menuitem", { name: /Paste/ }));

    await waitFor(() => {
      expect(mocks.terminal.paste).toHaveBeenCalledWith("/tmp/Tan\\ Words/image\\ \\(1\\).png");
    });
    expect(quoteTerminalPath("/tmp/Tan Words/image (1).png"))
      .toBe("/tmp/Tan\\ Words/image\\ \\(1\\).png");
  });

  it("selects the full terminal buffer from the context menu", () => {
    mocks.terminal.hasSelection.mockReturnValue(true);
    const { shell } = renderTerminal();
    fireEvent.contextMenu(shell);
    fireEvent.click(screen.getByRole("menuitem", { name: "Select all" }));
    expect(mocks.terminal.selectAll).toHaveBeenCalledOnce();
  });

  it("does not change transparency when the appearance controls are opened", () => {
    const first = renderTerminal();
    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    expect(screen.getByRole("button", { name: "Terminal appearance" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    first.unmount();

    const second = renderTerminal();
    expect(useSettingsStore.getState().terminalTransparent).toBe(false);
    expect(screen.getByRole("button", { name: "Terminal appearance" })).toHaveAttribute("aria-pressed", "false");
    expect(second.shell).toHaveStyle({ background: "#1a1b26" });
  });

  it("keeps the transparent background's blur when its appearance controls are closed", () => {
    useSettingsStore.getState().setTerminalTransparent(true);
    const { shell } = renderTerminal();
    const appearanceButton = screen.getByRole("button", { name: "Terminal appearance" });

    fireEvent.click(appearanceButton);
    expect(screen.getByRole("slider", { name: /^Background blur/ })).toBeInTheDocument();
    fireEvent.click(appearanceButton);

    expect(useSettingsStore.getState().terminalTransparent).toBe(true);
    expect(shell).toHaveStyle({ background: "rgba(26,27,38,0.16)" });
    // jsdom's CSSOM doesn't recognize the vendor-prefixed property, so only
    // the standard one is checked here; TerminalTool still sets both inline.
    expect((shell as HTMLElement).style.backdropFilter).toBe("blur(12px)");
  });

  it("applies no backdrop-filter when background blur is zero", () => {
    useSettingsStore.setState({ terminalTransparent: true, terminalBackgroundBlur: 0 });
    const { shell } = renderTerminal();

    expect((shell as HTMLElement).style.backdropFilter).toBe("");
    expect((shell as HTMLElement).style.getPropertyValue("-webkit-backdrop-filter")).toBe("");
  });

  it("keeps the selected preset when its appearance controls are closed", () => {
    renderTerminal();
    const appearanceButton = screen.getByRole("button", { name: "Terminal appearance" });

    fireEvent.click(appearanceButton);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Theme" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "High Contrast" }));
    fireEvent.click(appearanceButton);

    expect(screen.queryByRole("combobox", { name: "Theme" })).not.toBeInTheDocument();
    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "high-contrast",
      terminalBackgroundColor: "#000000",
      terminalTextColor: "#ffffff",
      terminalTransparent: false,
      terminalBackgroundBlur: 16,
      terminalBackgroundOpacity: 100,
    });

    fireEvent.click(appearanceButton);
    expect(screen.getByRole("combobox", { name: "Theme" })).toBeInTheDocument();
    expect(useSettingsStore.getState()).toMatchObject({
      terminalColorScheme: "high-contrast",
      terminalTransparent: false,
      terminalBackgroundBlur: 16,
      terminalBackgroundOpacity: 100,
    });
  });

  it("reveals the app background when Custom uses zero background opacity", () => {
    useSettingsStore.setState({
      terminalColorScheme: "high-contrast",
      terminalBackgroundColor: "#000000",
      terminalTextColor: "#ffffff",
      terminalTransparent: false,
      terminalBackgroundBlur: 16,
      terminalBackgroundOpacity: 16,
      terminalCustomAppearance: {
        backgroundColor: "#000000",
        textColor: "#ffffff",
        transparent: false,
        blur: 0,
        opacity: 0,
      },
    });
    const { shell } = renderTerminal();

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Theme" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Custom" }));

    expect(shell).toHaveStyle({ background: "rgba(0,0,0,0)" });
    expect((mocks.terminal.options.theme as Record<string, string>).background)
      .toBe("rgba(0, 0, 0, 0)");
  });
});
