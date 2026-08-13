import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  let terminalOptions: Record<string, unknown> | null = null;
  let clipboardValue: unknown = null;
  let contextLossHandler: (() => void) | null = null;
  let searchResultsHandler: ((result: { resultIndex: number; resultCount: number }) => void) | null = null;
  let resizeHandler: (() => void) | null = null;
  let titleHandler: ((title: string) => void) | null = null;
  let spawnInfo: { id: string; shell: string; cwd: string; pid: number } | null = null;
  let windowState = { maximized: false, fullScreen: false };
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
    onTitleChange: vi.fn((handler: (title: string) => void) => {
      titleHandler = handler;
      return { dispose: vi.fn() };
    }),
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
    webgl,
    search,
    callMain,
    openExternal,
    toastSuccess,
    toastError,
    getKeyHandler: () => keyHandler,
    getTerminalOptions: () => terminalOptions,
    triggerContextLoss: () => contextLossHandler?.(),
    emitSearchResults: (result: { resultIndex: number; resultCount: number }) => searchResultsHandler?.(result),
    triggerResize: () => resizeHandler?.(),
    emitTitle: (title: string) => titleHandler?.(title),
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
      contextLossHandler = null;
      searchResultsHandler = null;
      resizeHandler = null;
      titleHandler = null;
      spawnInfo = null;
      windowState = { maximized: false, fullScreen: false };
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
vi.mock("@/hooks/useWindowState", () => ({ useWindowState: mocks.getWindowState }));
vi.mock("@/ipc/shell", () => ({ openExternal: mocks.openExternal }));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { quoteTerminalPath, shellTabTitle, terminalFontStack } from "./terminalUtils";
import { TerminalTool } from "./TerminalTool";
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
      terminalBackgroundBlur: 12,
      terminalBackgroundOpacity: 16,
      terminalBackgroundColor: "#0d1117",
      terminalRenderer: "auto",
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

  it("uses WebGL for the opaque terminal with DOM fallback", () => {
    renderTerminal();

    expect(mocks.getTerminalOptions()).toMatchObject({
      allowProposedApi: true,
      allowTransparency: true,
      scrollback: 5_000,
      theme: { background: "#0d1117" },
    });
    expect(mocks.terminal.loadAddon).toHaveBeenCalledWith(mocks.webgl);

    mocks.triggerContextLoss();
    expect(mocks.webgl.dispose).toHaveBeenCalledOnce();
  });

  it("paints an explicit palette contrast-matched to its own backdrop", () => {
    renderTerminal();
    const theme = (mocks.getTerminalOptions()?.theme ?? {}) as Record<string, string>;

    // Every ANSI slot is set: an unset theme falls back to xterm's Tango
    // default, whose black/bright-black all but disappear on this backdrop.
    for (const slot of ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]) {
      expect(theme[slot]).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme[`bright${slot[0].toUpperCase()}${slot.slice(1)}`]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(theme.foreground).toBe("#c9d1d9");
    // Tango's values must not survive anywhere in the palette.
    expect(Object.values(theme)).not.toContain("#2e3436");
    expect(theme.background).toBe("#0d1117");
  });

  it("uses the built-in renderer in glass mode to avoid dark dim-text cells", () => {
    renderTerminal();

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));

    expect(mocks.webgl.dispose).toHaveBeenCalledOnce();
    expect((mocks.terminal.options.theme as Record<string, string>).background)
      .toBe("rgba(0, 0, 0, 0)");
  });

  it("honors explicit DOM and WebGL renderer choices", () => {
    useSettingsStore.setState({ terminalRenderer: "dom", terminalTransparent: false });
    const domView = renderTerminal();
    expect(mocks.terminal.loadAddon).not.toHaveBeenCalledWith(mocks.webgl);
    domView.unmount();

    vi.clearAllMocks();
    useSettingsStore.setState({ terminalRenderer: "webgl", terminalTransparent: true });
    renderTerminal();
    expect(mocks.terminal.loadAddon).toHaveBeenCalledWith(mocks.webgl);
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

  it("puts appearance controls on a dedicated row below the toolbar", () => {
    renderTerminal();
    const toolbar = screen.getByText("Terminal").parentElement?.parentElement;

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    const controls = screen.getByRole("group", { name: "Terminal appearance" });

    expect(toolbar).not.toContainElement(controls);
    expect(toolbar?.nextElementSibling).toBe(controls);
    expect(controls).toHaveClass("shrink-0", "border-t");
  });

  it("exits OS fullscreen when the maximized terminal toolbar is dragged down", () => {
    mocks.setWindowState({ maximized: false, fullScreen: true });
    render(<TerminalTool onBack={() => {}} maximized />);
    const toolbar = screen.getByText("Terminal").parentElement?.parentElement;

    expect(toolbar).not.toHaveClass("app-drag-region");
    fireEvent.mouseDown(toolbar!, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: 8 });

    expect(mocks.callMain).toHaveBeenCalledWith("window:toggleFullScreen");
  });

  it("explains the 5k scrollback limit and recommends Herdr", async () => {
    renderTerminal();
    const badge = screen.getByLabelText("Scrollback limit and Herdr recommendation");

    expect(badge).toHaveTextContent("5k scrollback");
    expect(badge).toHaveClass("app-region-no-drag");
    fireEvent.focus(badge);

    expect(await screen.findByText("Each terminal tab retains up to 5,000 scrollback lines."))
      .toBeInTheDocument();
    expect(screen.getByText(/recommend managing your sessions with Herdr/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open Herdr on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/herdrdev/herdr");

    fireEvent.click(link);
    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/herdrdev/herdr");
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

  it("forwards the shell's OSC title to its workspace owner", async () => {
    mocks.setSpawnInfo({ id: "session-1", shell: "/bin/fish", cwd: "/tmp", pid: 42 });
    const onShellTitleChange = vi.fn();
    const { unmount } = render(
      <TerminalTool onBack={() => {}} onShellTitleChange={onShellTitleChange} />,
    );
    await screen.findByText("Connected");

    act(() => { mocks.emitTitle("user@host:~/projects/demo"); });
    expect(onShellTitleChange).toHaveBeenLastCalledWith("~/projects/demo");

    // A dead session must not leave its directory on the tab.
    unmount();
    expect(onShellTitleChange).toHaveBeenLastCalledWith("");
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

  it("preserves a finite TUI startup burst while xterm paints", async () => {
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

    expect(mocks.callMain).not.toHaveBeenCalledWith("pty_set_output_suppressed", expect.anything());
    act(() => mocks.flushWrites());
    expect(mocks.terminal.write.mock.calls.some(([chunk]) => (
      new TextDecoder().decode(chunk).includes("Output truncated")
    ))).toBe(false);
  });

  it("truncates an unbounded output flood and resumes forwarding after xterm catches up", async () => {
    mocks.setSpawnInfo({ id: "session-1", shell: "/bin/fish", cwd: "/tmp", pid: 42 });
    mocks.setDeferWrites(true);
    render(<TerminalTool onBack={() => {}} />);
    await screen.findByText("Connected");
    const data = Buffer.alloc(8192, 0x78).toString("base64");

    act(() => {
      for (let index = 0; index < 640; index += 1) {
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
    expect(second.shell).toHaveStyle({ background: "rgba(13,17,23,0.16)" });
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
      background: "rgba(13,17,23,0.16)",
      backdropFilter: "blur(1px)",
    });
  });
});

describe("shellTabTitle", () => {
  it("drops the user@host prefix that every tab would share", () => {
    expect(shellTabTitle("user@host:~/projects/demo")).toBe("~/projects/demo");
  });

  it("keeps a title that carries no prefix", () => {
    expect(shellTabTitle("npm run build")).toBe("npm run build");
  });

  it("strips control characters before the title reaches the DOM", () => {
    expect(shellTabTitle("np\u0007m run\u001b build")).toBe("npm run build");
  });

  it("truncates from the left so the identifying tail survives", () => {
    const title = shellTabTitle(`~/${"deep/".repeat(20)}leaf`);
    expect(title).toHaveLength(60);
    expect(title.startsWith("\u2026")).toBe(true);
    expect(title.endsWith("deep/leaf")).toBe(true);
  });

  it("treats a blank or whitespace-only title as no title", () => {
    expect(shellTabTitle("")).toBe("");
    expect(shellTabTitle("     ")).toBe("");
  });
});
