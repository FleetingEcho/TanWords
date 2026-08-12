import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  let terminalOptions: Record<string, unknown> | null = null;
  let clipboardValue: unknown = null;
  let contextLossHandler: (() => void) | null = null;
  let searchResultsHandler: ((result: { resultIndex: number; resultCount: number }) => void) | null = null;
  let resizeHandler: (() => void) | null = null;
  let spawnInfo: { id: string; shell: string; cwd: string; pid: number } | null = null;
  let deferWrites = false;
  const pendingWriteCallbacks: Array<() => void> = [];
  const eventHandlers = new Map<string, (payload: any) => void>();
  const fit = vi.fn();
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
  return {
    terminal,
    webgl,
    search,
    callMain,
    getKeyHandler: () => keyHandler,
    getTerminalOptions: () => terminalOptions,
    triggerContextLoss: () => contextLossHandler?.(),
    emitSearchResults: (result: { resultIndex: number; resultCount: number }) => searchResultsHandler?.(result),
    triggerResize: () => resizeHandler?.(),
    emit: (event: string, payload: unknown) => eventHandlers.get(event)?.(payload),
    setSpawnInfo: (value: typeof spawnInfo) => { spawnInfo = value; },
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
      contextLossHandler = null;
      searchResultsHandler = null;
      resizeHandler = null;
      spawnInfo = null;
      deferWrites = false;
      pendingWriteCallbacks.length = 0;
      eventHandlers.clear();
      terminal.options = {};
    },
    setTerminalOptions: (options: Record<string, unknown>) => { terminalOptions = options; },
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor(options: Record<string, unknown>) {
      mocks.setTerminalOptions(options);
      return mocks.terminal;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = mocks.fit; } }));
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

import { quoteTerminalPath, terminalFontStack, TerminalTool } from "./TerminalTool";
import { useSettingsStore } from "@/store/settingsStore";

describe("TerminalTool clipboard controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
    mocks.setClipboardValue(null);
    mocks.terminal.hasSelection.mockReturnValue(false);
    mocks.terminal.getSelection.mockReturnValue("");
    useSettingsStore.setState({
      terminalTransparent: false,
      appBackgroundImage: "",
      appBackgroundVisible: true,
      appBackgroundBlur: 20,
      terminalFontFamily: "ui-monospace",
      terminalFontSize: 13,
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

  it("uses the transparent WebGL canvas renderer with DOM fallback", () => {
    renderTerminal();

    expect(mocks.getTerminalOptions()).toMatchObject({
      allowProposedApi: true,
      allowTransparency: true,
      scrollback: 40_000,
      theme: { background: "rgba(0, 0, 0, 0)" },
    });
    expect(mocks.terminal.loadAddon).toHaveBeenCalledWith(mocks.webgl);

    mocks.triggerContextLoss();
    expect(mocks.webgl.dispose).toHaveBeenCalledOnce();
  });

  it("keeps the terminal shell flush with its tab strip without page margins", () => {
    const { shell } = renderTerminal();

    expect(shell).not.toHaveClass("mx-4", "mb-4", "sm:mx-6", "sm:mb-6");
    expect(shell).toHaveClass("rounded-none");
  });

  it("fits xterm inside a padding-free host so the final row is not clipped", () => {
    const { shell } = renderTerminal();
    const host = shell.querySelector(".terminal-tool-host");

    expect(shell).toHaveClass("p-2", "border-t");
    expect(host).toHaveClass("h-full", "w-full");
    expect(host).not.toHaveClass("p-2", "border-t");
    expect(mocks.terminal.open).toHaveBeenCalledWith(host);
  });

  it("uses the terminal toolbar as a window drag region", () => {
    renderTerminal();

    expect(screen.getByText("Terminal").parentElement?.parentElement).toHaveClass("app-drag-region");
  });

  it("fits only once when a hidden terminal tab becomes visible", () => {
    const view = render(<TerminalTool onBack={() => {}} visible={false} />);
    mocks.fit.mockClear();

    view.rerender(<TerminalTool onBack={() => {}} visible />);
    mocks.triggerResize();

    expect(mocks.fit).toHaveBeenCalledOnce();
  });

  it("passes the tab's captured shell path when spawning its PTY", () => {
    render(<TerminalTool onBack={() => {}} shellPath="/bin/fish" />);

    expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", {
      cols: 80,
      rows: 24,
      shellPath: "/bin/fish",
    });
  });

  it("reports a natural shell exit to its workspace owner", async () => {
    mocks.setSpawnInfo({ id: "session-1", shell: "/bin/fish", cwd: "/tmp", pid: 42 });
    const onSessionExit = vi.fn();
    const onSessionReady = vi.fn();
    render(<TerminalTool onBack={() => {}} onSessionReady={onSessionReady} onSessionExit={onSessionExit} />);
    await waitFor(() => expect(onSessionReady).toHaveBeenCalledWith("/bin/fish"));

    await act(async () => { mocks.emit("pty:exit", { id: "session-1", code: 0 }); });

    expect(onSessionExit).toHaveBeenCalledOnce();
  });

  it("restarts the PTY in place when its helper exits unexpectedly", async () => {
    mocks.setSpawnInfo({ id: "session-1", shell: "/bin/fish", cwd: "/tmp", pid: 42 });
    const onSessionExit = vi.fn();
    render(<TerminalTool onBack={() => {}} onSessionExit={onSessionExit} />);
    await screen.findByText("Connected");
    const initialSpawns = mocks.callMain.mock.calls.filter(([channel]) => channel === "pty_spawn").length;

    act(() => {
      mocks.emit("pty:exit", { id: "session-1", code: 1, error: "helper crashed" });
    });

    await waitFor(() => {
      expect(mocks.callMain.mock.calls.filter(([channel]) => channel === "pty_spawn"))
        .toHaveLength(initialSpawns + 1);
    }, { timeout: 1_500 });
    expect(onSessionExit).not.toHaveBeenCalled();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("truncates a pending output flood and resumes forwarding after xterm catches up", async () => {
    mocks.setSpawnInfo({ id: "session-1", shell: "/bin/fish", cwd: "/tmp", pid: 42 });
    mocks.setDeferWrites(true);
    render(<TerminalTool onBack={() => {}} />);
    await screen.findByText("Connected");
    const data = Buffer.alloc(8192, 0x78).toString("base64");

    act(() => {
      for (let index = 0; index < 40; index += 1) {
        mocks.emit("pty:data", { id: "session-1", data });
      }
    });

    expect(mocks.callMain).toHaveBeenCalledWith("pty_set_output_suppressed", {
      id: "session-1",
      suppressed: true,
    });
    act(() => mocks.flushWrites());
    expect(mocks.callMain).toHaveBeenCalledWith("pty_set_output_suppressed", {
      id: "session-1",
      suppressed: false,
    });
    expect(mocks.terminal.write.mock.calls.some(([chunk]) => (
      new TextDecoder().decode(chunk).includes("Output truncated")
    ))).toBe(true);
  });

  it("delegates maximize and restore to the standalone page shell", () => {
    const onMaximizedChange = vi.fn();
    const view = render(
      <TerminalTool onBack={() => {}} onMaximizedChange={onMaximizedChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Maximize terminal" }));
    expect(onMaximizedChange).toHaveBeenCalledWith(true);

    view.rerender(
      <TerminalTool onBack={() => {}} maximized onMaximizedChange={onMaximizedChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Minimize terminal" }));
    expect(onMaximizedChange).toHaveBeenLastCalledWith(false);
  });

  it("applies terminal typography live without replacing the PTY", () => {
    renderTerminal();
    const spawnCalls = mocks.callMain.mock.calls.filter(([channel]) => channel === "pty_spawn").length;

    act(() => {
      useSettingsStore.setState({ terminalFontFamily: "Fira Code", terminalFontSize: 17 });
    });

    expect(mocks.terminal.options.fontFamily).toBe(terminalFontStack("Fira Code"));
    expect(mocks.terminal.options.fontSize).toBe(17);
    expect(mocks.callMain.mock.calls.filter(([channel]) => channel === "pty_spawn")).toHaveLength(spawnCalls);
  });

  it("changes the persisted font size from the terminal toolbar", () => {
    renderTerminal();

    fireEvent.click(screen.getByRole("button", { name: "Increase terminal font size" }));
    expect(useSettingsStore.getState().terminalFontSize).toBe(14);
    expect(mocks.terminal.options.fontSize).toBe(14);

    fireEvent.click(screen.getByRole("button", { name: "Decrease terminal font size" }));
    expect(useSettingsStore.getState().terminalFontSize).toBe(13);
    expect(mocks.terminal.options.fontSize).toBe(13);
  });

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
  });

  it("uses Ctrl+C for copy only while text is selected", () => {
    mocks.terminal.hasSelection.mockReturnValue(true);
    mocks.terminal.getSelection.mockReturnValue("copy me");
    renderTerminal();
    const handler = mocks.getKeyHandler();
    expect(handler).not.toBeNull();

    const copyEvent = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, cancelable: true });
    expect(handler!(copyEvent)).toBe(false);
    expect(mocks.callMain).toHaveBeenCalledWith("clipboard:writeText", { text: "copy me" });

    mocks.callMain.mockClear();
    mocks.terminal.hasSelection.mockReturnValue(false);
    expect(handler!(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(true);
    expect(mocks.callMain).not.toHaveBeenCalledWith("clipboard:writeText", expect.anything());
  });

  it("searches scrollback, highlights matches, and navigates results", async () => {
    renderTerminal();
    // Simulate a terminal instance retained across Vite Fast Refresh from
    // before proposed decoration APIs were enabled.
    mocks.terminal.options.allowProposedApi = false;

    act(() => {
      const handled = mocks.getKeyHandler()!(
        new KeyboardEvent("keydown", { key: "f", metaKey: true, cancelable: true }),
      );
      expect(handled).toBe(false);
    });

    const input = await screen.findByRole("searchbox", { name: "Terminal search query" });
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

  it("pastes clipboard text with Ctrl+V", async () => {
    mocks.setClipboardValue({ kind: "text", text: "echo hello" });
    renderTerminal();

    const handled = mocks.getKeyHandler()!(
      new KeyboardEvent("keydown", { key: "v", ctrlKey: true, cancelable: true }),
    );

    expect(handled).toBe(false);
    await waitFor(() => expect(mocks.terminal.paste).toHaveBeenCalledWith("echo hello"));
  });

  it("pastes a safely escaped temporary image path with Ctrl+V", async () => {
    mocks.setClipboardValue({ kind: "image", path: "/tmp/Tan Words/image (1).png" });
    renderTerminal();

    mocks.getKeyHandler()!(new KeyboardEvent("keydown", { key: "v", ctrlKey: true }));

    await waitFor(() => {
      expect(mocks.terminal.paste).toHaveBeenCalledWith("/tmp/Tan\\ Words/image\\ \\(1\\).png");
    });
    expect(quoteTerminalPath("/tmp/Tan Words/image (1).png"))
      .toBe("/tmp/Tan\\ Words/image\\ \\(1\\).png");
  });

  it("selects the full terminal buffer from the context menu", () => {
    const { shell } = renderTerminal();
    fireEvent.contextMenu(shell);
    fireEvent.click(screen.getByRole("menuitem", { name: "Select all" }));
    expect(mocks.terminal.selectAll).toHaveBeenCalledOnce();
  });

  it("keeps transparent mode enabled when the terminal is reopened", () => {
    const first = renderTerminal();
    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    expect(screen.getByRole("button", { name: "Terminal appearance" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    first.unmount();

    const second = renderTerminal();
    expect(useSettingsStore.getState().terminalTransparent).toBe(true);
    expect(screen.getByRole("button", { name: "Terminal appearance" })).toHaveAttribute("aria-pressed", "false");
    expect(second.shell).toHaveStyle({ background: "rgba(8,10,14,0.16)" });
  });

  it("keeps the glass effect when its appearance controls are closed", () => {
    const { shell } = renderTerminal();
    const appearanceButton = screen.getByRole("button", { name: "Terminal appearance" });

    fireEvent.click(appearanceButton);
    fireEvent.change(screen.getByRole("slider", { name: /^Background blur/ }), {
      target: { value: "1" },
    });
    fireEvent.click(appearanceButton);

    expect(screen.queryByRole("slider", { name: /^Background blur/ })).not.toBeInTheDocument();
    expect(useSettingsStore.getState().terminalTransparent).toBe(true);
    expect(shell).toHaveStyle({
      background: "rgba(8,10,14,0.16)",
      backdropFilter: "blur(1px)",
    });
  });
});
