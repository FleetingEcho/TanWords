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

  it("uses WebGL for the opaque terminal with DOM fallback", () => {
    renderTerminal();

    expect(mocks.getTerminalOptions()).toMatchObject({
      allowProposedApi: true,
      allowTransparency: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      smoothScrollDuration: 80,
      rescaleOverlappingGlyphs: true,
      scrollback: 5_000,
      theme: { background: "#1a1b26" },
    });
    expect(mocks.terminal.loadAddon).toHaveBeenCalledWith(mocks.webgl);

    mocks.triggerContextLoss();
    expect(mocks.webgl.dispose).toHaveBeenCalledOnce();
  });

  it("renders bounded SIXEL and iTerm inline images", () => {
    renderTerminal();

    expect(mocks.getImageOptions()).toMatchObject({
      enableSizeReports: true,
      pixelLimit: 4096 * 4096,
      storageLimit: 64,
      showPlaceholder: true,
      sixelSupport: true,
      sixelScrolling: true,
      sixelSizeLimit: 25_000_000,
      iipSupport: true,
      iipSizeLimit: 20_000_000,
    });
    expect(mocks.terminal.loadAddon).toHaveBeenCalledWith(mocks.image);
    expect(TERMINAL_OUTPUT_HIGH_WATER_BYTES).toBeLessThanOrEqual(500 * 1024);
    expect(TERMINAL_OUTPUT_LOW_WATER_BYTES).toBeLessThan(TERMINAL_OUTPUT_HIGH_WATER_BYTES);
  });

  it("reports logical pixels so Retina DPR does not halve image layout", () => {
    renderTerminal();

    expect(mocks.terminal.parser.registerCsiHandler).toHaveBeenCalledWith(
      { final: "t" },
      expect.any(Function),
    );
    expect(mocks.emitCsi([16])).toBe(true);
    expect(mocks.terminal.input).toHaveBeenLastCalledWith("\x1b[6;16;8t", false);

    expect(mocks.emitCsi([14])).toBe(true);
    expect(mocks.terminal.input).toHaveBeenLastCalledWith("\x1b[4;500;800t", false);
    expect(mocks.emitCsi([18])).toBe(false);
  });

  it("accepts binary PTY output without a Base64 round trip", () => {
    const bytes = new Uint8Array([0, 27, 91, 109, 255]);
    expect(terminalOutputBytes(bytes)).toEqual(bytes);
    expect(terminalOutputBytes(bytes.buffer)).toEqual(bytes);
    expect(terminalOutputBytes(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
    expect(terminalOutputBytes({ data: [...bytes] })).toBeNull();
  });

  it("falls back to xterm's built-in pixel report when device metrics are unavailable", () => {
    expect(terminalPixelSizeReport([16], undefined)).toBeNull();
    expect(terminalPixelSizeReport([16], {
      css: {
        canvas: { width: 0, height: 0 },
        cell: { width: 0, height: 16 },
      },
      device: {
        canvas: { width: 0, height: 0 },
        cell: { width: 0, height: 32 },
      },
    })).toBeNull();
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
    expect(theme.foreground).toBe("#c0caf5");
    // Tango's values must not survive anywhere in the palette.
    expect(Object.values(theme)).not.toContain("#2e3436");
    expect(theme.background).toBe("#1a1b26");
  });

  it("keeps reverse-video input legible with the transparent light preset", () => {
    useSettingsStore.getState().setTerminalColorScheme("light");
    renderTerminal();

    expect(mocks.getTerminalOptions()).toMatchObject({
      allowTransparency: true,
      minimumContrastRatio: 4.5,
      theme: {
        foreground: "#000000",
        // Alpha 0 keeps the canvas transparent; the RGB channels still carry
        // the real (light) backdrop so minimumContrastRatio corrects glyphs
        // against it instead of an assumed black background.
        background: "rgba(222, 222, 222, 0)",
      },
    });
  });

  it("uses VS Code-style structural accents in high-contrast mode", () => {
    useSettingsStore.setState({
      terminalColorScheme: "high-contrast",
      terminalBackgroundColor: "#000000",
      terminalTextColor: "#ffffff",
    });
    renderTerminal();

    expect(mocks.getTerminalOptions()?.theme).toMatchObject({
      background: "#000000",
      foreground: "#ffffff",
      yellow: "#cca700",
      brightYellow: "#ffd700",
      cyan: "#00b7c3",
      brightCyan: "#4ec9b0",
      blue: "#75beff",
    });
  });

  it("applies text colors and complete presets live without restarting the session", () => {
    renderTerminal();

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Theme" }), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Custom" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Dracula" }));

    expect(mocks.terminal.options.theme).toMatchObject({
      foreground: "#f8f8f2",
      background: "#282a36",
      red: "#ff5555",
      blue: "#bd93f9",
    });
    expect(useSettingsStore.getState()).toMatchObject({
      terminalBackgroundColor: "#282a36",
      terminalTransparent: false,
      terminalBackgroundBlur: 16,
      terminalBackgroundOpacity: 100,
    });
    expect(mocks.terminal.dispose).not.toHaveBeenCalled();

    const textColorPicker = screen.getAllByLabelText("Text color")
      .find((element) => element.getAttribute("type") === "color")!;
    fireEvent.change(textColorPicker, {
      target: { value: "#abcdef" },
    });
    expect(mocks.terminal.options.theme).toMatchObject({ foreground: "#abcdef" });
    expect(useSettingsStore.getState().terminalColorScheme).toBe("custom");
    expect(mocks.terminal.dispose).not.toHaveBeenCalled();
  });

  it("shows an engine switch in the appearance panel when the tab supplies one", () => {
    const onEngineChange = vi.fn();
    render(<TerminalTool onBack={() => {}} engine="xterm" onEngineChange={onEngineChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    expect(screen.getByRole("tab", { name: "xterm" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "restty · Experimental" }));
    expect(onEngineChange).toHaveBeenCalledWith("restty");
  });

  it("omits the engine switch when the tab does not supply one", () => {
    renderTerminal();

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    expect(screen.queryByRole("tab", { name: "xterm" })).not.toBeInTheDocument();
  });

  it("uses the built-in renderer in glass mode to avoid dark dim-text cells", () => {
    renderTerminal();
    act(() => useSettingsStore.getState().setTerminalTransparent(true));

    expect(mocks.webgl.dispose).toHaveBeenCalledOnce();
    // Alpha 0 keeps the canvas transparent; the RGB channels still carry the
    // chosen background so minimumContrastRatio corrects against the real
    // backdrop instead of an assumed black one.
    expect((mocks.terminal.options.theme as Record<string, string>).background)
      .toBe("rgba(26, 27, 38, 0)");
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

  it("only uses the combined tab toolbar as a window drag region in Zen mode", () => {
    const view = renderTerminal();
    const normalToolbar = screen.getByTestId("terminal-tab-toolbar");

    expect(normalToolbar).toHaveClass("app-region-no-drag");
    expect(normalToolbar).not.toHaveClass("app-drag-region");

    view.unmount();
    render(<TerminalTool onBack={() => {}} maximized />);
    const zenToolbar = screen.getByTestId("terminal-tab-toolbar");

    expect(zenToolbar).toHaveClass("app-drag-region");
    expect(zenToolbar).not.toHaveClass("app-region-no-drag");
  });

  it("combines tabs and actions, removes the title row, and keeps appearance controls below", () => {
    render(
      <TerminalTool
        onBack={() => {}}
        tabBar={<div role="tablist" aria-label="Terminal tabs"><button role="tab">Shell 1</button></div>}
      />,
    );
    const toolbar = screen.getByTestId("terminal-tab-toolbar");

    expect(toolbar).toHaveClass("bg-transparent", "text-foreground");
    expect(toolbar).not.toHaveClass("bg-background/80");
    expect(toolbar).not.toHaveClass("backdrop-blur-md");
    expect(toolbar).toContainElement(screen.getByRole("tab", { name: "Shell 1" }));
    const searchButton = screen.getByRole("button", { name: "Search terminal" });
    expect(toolbar).toContainElement(searchButton);
    expect(searchButton).toHaveClass("text-foreground/80");
    const fontSizeControl = screen.getByRole("group", { name: "Terminal font size" });
    expect(fontSizeControl).toHaveClass("bg-transparent");
    expect(fontSizeControl).not.toHaveClass("bg-background/40", "backdrop-blur-md");
    expect(toolbar).toContainElement(screen.getByRole("button", { name: "Terminal appearance" }));
    expect(screen.queryByText("Terminal")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All tools" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    const controls = screen.getByRole("group", { name: "Terminal appearance" });

    expect(toolbar).not.toContainElement(controls);
    expect(toolbar?.nextElementSibling).toBe(controls);
    expect(controls).toHaveClass("shrink-0", "border-t", "bg-transparent");
    expect(controls).not.toHaveClass("bg-background/55", "backdrop-blur-md");
    const themeSelector = screen.getByRole("combobox", { name: "Theme" });
    expect(themeSelector).toHaveClass("bg-transparent");
    expect(themeSelector).not.toHaveClass("bg-background/70", "backdrop-blur-md");
  });

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
