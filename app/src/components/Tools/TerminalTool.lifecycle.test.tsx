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

describe("TerminalTool PTY lifecycle and typography", () => {
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

  it("exits OS fullscreen when the maximized terminal toolbar is dragged down", () => {
    mocks.setWindowState({ maximized: false, fullScreen: true });
    render(<TerminalTool onBack={() => {}} maximized />);
    const toolbar = screen.getByTestId("terminal-tab-toolbar");

    expect(toolbar).not.toHaveClass("app-drag-region");
    fireEvent.mouseDown(toolbar!, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: 8 });

    expect(mocks.callMain).toHaveBeenCalledWith("window:toggleFullScreen");
  });

  it("fits only once when a hidden terminal tab becomes visible", () => {
    const view = render(<TerminalTool onBack={() => {}} visible={false} />);
    mocks.fit.mockClear();

    view.rerender(<TerminalTool onBack={() => {}} visible />);
    mocks.triggerResize();

    expect(mocks.fit).toHaveBeenCalledOnce();
  });

  it("releases WebGL while hidden and restores it when visible again", () => {
    const view = render(<TerminalTool onBack={() => {}} />);
    expect(mocks.terminal.loadAddon).toHaveBeenCalledWith(mocks.webgl);
    const initialLoads = mocks.terminal.loadAddon.mock.calls.filter(
      ([addon]) => addon === mocks.webgl,
    ).length;

    view.rerender(<TerminalTool onBack={() => {}} visible={false} />);
    expect(mocks.webgl.dispose).toHaveBeenCalled();
    expect(mocks.terminal.loadAddon.mock.calls.filter(
      ([addon]) => addon === mocks.webgl,
    )).toHaveLength(initialLoads);

    view.rerender(<TerminalTool onBack={() => {}} visible />);
    expect(mocks.terminal.loadAddon.mock.calls.filter(
      ([addon]) => addon === mocks.webgl,
    )).toHaveLength(initialLoads + 1);
  });

  it("passes the tab's captured shell path when spawning its PTY", () => {
    render(<TerminalTool onBack={() => {}} shellPath="/bin/fish" />);

    expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", {
      cols: 80,
      rows: 24,
      pixelWidth: 800,
      pixelHeight: 500,
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
    await waitForConnected();

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
    await waitForConnected();
    const initialSpawns = mocks.callMain.mock.calls.filter(([channel]) => channel === "pty_spawn").length;

    act(() => {
      mocks.emit("pty:exit", { id: "session-1", code: 1, error: "helper crashed" });
    });

    await waitFor(() => {
      expect(mocks.callMain.mock.calls.filter(([channel]) => channel === "pty_spawn"))
        .toHaveLength(initialSpawns + 1);
    }, { timeout: 1_500 });
    expect(onSessionExit).not.toHaveBeenCalled();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Starting…")).not.toBeInTheDocument();
  });

  it("preserves a finite TUI startup burst while xterm paints", async () => {
    mocks.setSpawnInfo({ id: "session-1", shell: "/bin/fish", cwd: "/tmp", pid: 42 });
    mocks.setDeferWrites(true);
    render(<TerminalTool onBack={() => {}} />);
    await waitForConnected();
    const data = new Uint8Array(8192).fill(0x78);

    act(() => {
      for (let index = 0; index < 40; index += 1) {
        mocks.emit("pty:data", { id: "session-1", data });
      }
    });

    expect(mocks.callMain).not.toHaveBeenCalledWith("pty_set_output_backpressure", expect.anything());
    act(() => mocks.flushWrites());
    expect(mocks.terminal.write.mock.calls.some(([chunk]) => (
      new TextDecoder().decode(chunk).includes("Output truncated")
    ))).toBe(false);
  });

  it("backpressures an output flood and preserves it while xterm catches up", async () => {
    mocks.setSpawnInfo({ id: "session-1", shell: "/bin/fish", cwd: "/tmp", pid: 42 });
    mocks.setDeferWrites(true);
    render(<TerminalTool onBack={() => {}} />);
    await waitForConnected();
    const data = new Uint8Array(64 * 1024).fill(0x78);

    act(() => {
      for (let index = 0; index < 100; index += 1) {
        mocks.emit("pty:data", { id: "session-1", data });
      }
    });

    expect(mocks.callMain).toHaveBeenCalledWith("pty_set_output_backpressure", {
      id: "session-1",
      paused: true,
    });
    act(() => mocks.flushWrites());
    expect(mocks.callMain).toHaveBeenCalledWith("pty_set_output_backpressure", {
      id: "session-1",
      paused: false,
    });
    expect(mocks.terminal.write).toHaveBeenCalledTimes(100);
    expect(mocks.terminal.write.mock.calls.some(([chunk]) => (
      new TextDecoder().decode(chunk).includes("Output truncated")
    ))).toBe(false);
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
      useSettingsStore.setState({
        terminalFontFamily: "Fira Code",
        terminalFontSize: 17,
        terminalFontWeight: 600,
      });
    });

    expect(mocks.terminal.options.fontFamily).toBe(terminalFontStack("Fira Code"));
    expect(mocks.terminal.options.fontSize).toBe(17);
    expect(mocks.terminal.options.fontWeight).toBe(600);
    expect(mocks.terminal.options.fontWeightBold).toBe(700);
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

  it("changes the persisted font weight from the appearance strip", () => {
    renderTerminal();

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    fireEvent.change(screen.getByRole("slider", { name: "Font weight" }), {
      target: { value: "600" },
    });

    expect(useSettingsStore.getState().terminalFontWeight).toBe(600);
    expect(mocks.terminal.options.fontWeight).toBe(600);
    expect(mocks.terminal.options.fontWeightBold).toBe(700);
  });
});
