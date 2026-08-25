import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let capturedServices: { ptyTransport?: any } | null = null;
  let capturedOptions: Record<string, any> | null = null;
  let capturedCallbacks: Record<string, ReturnType<typeof vi.fn>> | null = null;
  let spawnInfo: { id: string; shell: string; cwd: string; pid: number } | null = null;
  let clipboardValue: unknown = null;
  const eventHandlers = new Map<string, (payload: any) => void>();
  const resttyPane = {
    applyTheme: vi.fn(),
    setFontSize: vi.fn(),
    setFonts: vi.fn(() => Promise.resolve()),
    copySelectionToClipboard: vi.fn(() => Promise.resolve(true)),
    pasteFromClipboard: vi.fn(() => Promise.resolve(true)),
    sendKeyInput: vi.fn(),
    updateSize: vi.fn(),
    // Mirrors what restty's real runtime does: build its own callbacks
    // object and pass it to the transport's `connect()`.
    connectPty: vi.fn((url?: string) => {
      capturedCallbacks = {
        onConnect: vi.fn(), onDisconnect: vi.fn(), onData: vi.fn(),
        onStatus: vi.fn(), onError: vi.fn(), onExit: vi.fn(),
      };
      capturedServices?.ptyTransport?.connect({ url: url ?? "", cols: 80, rows: 24, callbacks: capturedCallbacks });
    }),
  };
  const terminal = {
    cols: 80,
    rows: 24,
    restty: resttyPane,
    open: vi.fn(),
    focus: vi.fn(),
    // Mirrors restty's real `destroy()`, which cascades into
    // `ptyInputRuntime.disconnectPty()` + `ptyTransport.destroy?.()`
    // (confirmed in `node_modules/restty/dist/chunk-mnhegx4k.js`).
    dispose: vi.fn(() => {
      void capturedServices?.ptyTransport?.destroy?.();
    }),
  };
  const callMain = vi.fn((channel: string) => {
    if (channel === "pty_spawn") return spawnInfo ? Promise.resolve(spawnInfo) : new Promise(() => {});
    if (channel === "clipboard:readForTerminal") return Promise.resolve(clipboardValue);
    return Promise.resolve(null);
  });
  return {
    terminal,
    resttyPane,
    callMain,
    emit: (event: string, payload: unknown) => eventHandlers.get(event)?.(payload),
    subscribe: (event: string, handler: (payload: any) => void) => {
      eventHandlers.set(event, handler);
      return () => { eventHandlers.delete(event); };
    },
    setSpawnInfo: (value: typeof spawnInfo) => { spawnInfo = value; },
    setClipboardValue: (value: unknown) => { clipboardValue = value; },
    getTransport: () => capturedServices?.ptyTransport,
    getOptions: () => capturedOptions,
    getCallbacks: () => capturedCallbacks,
    setServices: (services: { ptyTransport?: any } | null) => { capturedServices = services; },
    setOptions: (options: Record<string, any>) => { capturedOptions = options; },
    reset: () => {
      spawnInfo = null;
      clipboardValue = null;
      capturedServices = null;
      capturedOptions = null;
      capturedCallbacks = null;
      eventHandlers.clear();
    },
  };
});

// This suite exercises the Electron PTY transport (pty_spawn/pty_write/etc via
// callMain) — pin the host to desktop, since the web build now runs a
// sandboxed just-bash transport instead (see `sandboxPtyTransport.ts`).
vi.mock("@/platform", () => ({ isDesktopHost: true }));

vi.mock("restty/xterm", () => ({
  Terminal: class {
    constructor(options: { services?: { ptyTransport?: unknown }; surface?: unknown }) {
      mocks.setOptions(options);
      mocks.setServices(options.services ?? null);
      return mocks.terminal;
    }
  },
}));
vi.mock("@/ipc/events", () => ({ subscribe: mocks.subscribe }));
vi.mock("@/ipc/host", () => ({ callMain: mocks.callMain }));
vi.mock("@/hooks/useWindowState", () => ({ useWindowState: () => ({ maximized: false, fullScreen: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TerminalToolRestty } from "./TerminalToolRestty";
import { TERMINAL_OUTPUT_HIGH_WATER_BYTES } from "./terminalUtils";
import { useSettingsStore } from "@/store/settingsStore";

describe("TerminalToolRestty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
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
      terminalFontFamily: "ui-monospace",
      terminalFontSize: 13,
      terminalFontWeight: 400,
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("connects through a ptyTransport (not manual write/onData) and reports connected", async () => {
    mocks.setSpawnInfo({ id: "s1", shell: "/bin/zsh", cwd: "/home", pid: 1 });
    const onSessionReady = vi.fn();

    render(<TerminalToolRestty onBack={() => {}} onSessionReady={onSessionReady} />);

    expect(mocks.terminal.open).toHaveBeenCalled();
    expect(mocks.resttyPane.applyTheme).toHaveBeenCalled();
    expect(mocks.resttyPane.connectPty).toHaveBeenCalled();
    await waitFor(() => expect(onSessionReady).toHaveBeenCalledWith("/bin/zsh"));
    expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", expect.objectContaining({ shellPath: "" }));
  });

  it("feeds decoded PTY output through the transport's onData callback", async () => {
    mocks.setSpawnInfo({ id: "s1", shell: "/bin/zsh", cwd: "/home", pid: 1 });
    render(<TerminalToolRestty onBack={() => {}} />);
    await waitFor(() => expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", expect.anything()));

    mocks.emit("pty:data", { id: "s1", data: new TextEncoder().encode("hello") });
    expect(mocks.getCallbacks()?.onData).toHaveBeenCalledWith("hello");
  });

  it("coalesces multiple pty:data events into a single onData call per frame", async () => {
    const pending: { flush: FrameRequestCallback | null } = { flush: null };
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { pending.flush = cb; return 1; });
    mocks.setSpawnInfo({ id: "s1", shell: "/bin/zsh", cwd: "/home", pid: 1 });
    render(<TerminalToolRestty onBack={() => {}} />);
    await waitFor(() => expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", expect.anything()));

    mocks.emit("pty:data", { id: "s1", data: new TextEncoder().encode("foo") });
    mocks.emit("pty:data", { id: "s1", data: new TextEncoder().encode("bar") });
    expect(mocks.getCallbacks()?.onData).not.toHaveBeenCalled();

    pending.flush?.(0);
    expect(mocks.getCallbacks()?.onData).toHaveBeenCalledTimes(1);
    expect(mocks.getCallbacks()?.onData).toHaveBeenCalledWith("foobar");
  });

  it("pauses the PTY once queued output crosses the high-water mark and resumes after the next flush", async () => {
    const pending: { flush: FrameRequestCallback | null } = { flush: null };
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { pending.flush = cb; return 1; });
    mocks.setSpawnInfo({ id: "s1", shell: "/bin/zsh", cwd: "/home", pid: 1 });
    render(<TerminalToolRestty onBack={() => {}} />);
    await waitFor(() => expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", expect.anything()));
    mocks.callMain.mockClear();

    mocks.emit("pty:data", { id: "s1", data: new Uint8Array(TERMINAL_OUTPUT_HIGH_WATER_BYTES) });
    expect(mocks.callMain).toHaveBeenCalledWith("pty_set_output_backpressure", { id: "s1", paused: true });

    pending.flush?.(0);
    expect(mocks.callMain).toHaveBeenCalledWith("pty_set_output_backpressure", { id: "s1", paused: false });
  });

  it("forwards keystrokes through transport.sendInput to pty_write", async () => {
    mocks.setSpawnInfo({ id: "s1", shell: "/bin/zsh", cwd: "/home", pid: 1 });
    render(<TerminalToolRestty onBack={() => {}} />);
    await waitFor(() => expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", expect.anything()));

    const sent = mocks.getTransport().sendInput("ls\n");
    expect(sent).toBe(true);
    expect(mocks.callMain).toHaveBeenCalledWith("pty_write", expect.objectContaining({ id: "s1" }));
  });

  it("relays transport.resize to pty_resize", async () => {
    mocks.setSpawnInfo({ id: "s1", shell: "/bin/zsh", cwd: "/home", pid: 1 });
    render(<TerminalToolRestty onBack={() => {}} />);
    await waitFor(() => expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", expect.anything()));
    mocks.callMain.mockClear();

    const resized = mocks.getTransport().resize(120, 40, { widthPx: 900, heightPx: 600 });
    expect(resized).toBe(true);
    expect(mocks.callMain).toHaveBeenCalledWith("pty_resize", expect.objectContaining({
      id: "s1", cols: 120, rows: 40, pixelWidth: 900, pixelHeight: 600,
    }));
  });

  it("closes the PTY session and disposes the terminal on unmount", async () => {
    mocks.setSpawnInfo({ id: "s1", shell: "/bin/zsh", cwd: "/home", pid: 1 });
    const { unmount } = render(<TerminalToolRestty onBack={() => {}} />);
    await waitFor(() => expect(mocks.callMain).toHaveBeenCalledWith("pty_spawn", expect.anything()));

    unmount();

    expect(mocks.callMain).toHaveBeenCalledWith("pty_close", { id: "s1" });
    expect(mocks.terminal.dispose).toHaveBeenCalled();
  });

  it("shows an engine switch in the appearance panel when the tab supplies one", () => {
    mocks.setSpawnInfo(null);
    const onEngineChange = vi.fn();
    render(<TerminalToolRestty onBack={() => {}} engine="restty" onEngineChange={onEngineChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    expect(screen.getByRole("tab", { name: "restty" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "xterm" }));
    expect(onEngineChange).toHaveBeenCalledWith("xterm");
  });

  it("shows a starting status while no session is connected yet", () => {
    mocks.setSpawnInfo(null);
    render(<TerminalToolRestty onBack={() => {}} />);
    expect(screen.getByText("Starting…")).toBeInTheDocument();
  });

  it("disables Restty's built-in context menu while suppressing the browser menu", () => {
    mocks.setSpawnInfo(null);
    const { container } = render(<TerminalToolRestty onBack={() => {}} />);
    const host = container.querySelector(".terminal-tool-host");
    expect(host).not.toBeNull();
    expect(mocks.getOptions()).toMatchObject({
      surface: { defaultContextMenu: false },
    });

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    host!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("pastes a safely escaped temporary image path through Restty", async () => {
    mocks.setSpawnInfo(null);
    mocks.setClipboardValue({ kind: "image", path: "/tmp/Tan Words/image (1).png" });
    const { container } = render(<TerminalToolRestty onBack={() => {}} />);
    const host = container.querySelector(".terminal-tool-host");
    expect(host).not.toBeNull();

    fireEvent.paste(host!, {
      clipboardData: { getData: () => "" },
    });

    await waitFor(() => {
      expect(mocks.callMain).toHaveBeenCalledWith("clipboard:readForTerminal");
      expect(mocks.resttyPane.sendKeyInput).toHaveBeenCalledWith(
        "/tmp/Tan\\ Words/image\\ \\(1\\).png",
        "paste",
      );
    });
  });

  it("leaves ordinary text paste to Restty's bracketed-paste handler", () => {
    mocks.setSpawnInfo(null);
    const { container } = render(<TerminalToolRestty onBack={() => {}} />);
    const host = container.querySelector(".terminal-tool-host");
    expect(host).not.toBeNull();
    mocks.callMain.mockClear();

    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => type === "text/plain" ? "echo hello" : "" },
    });
    host!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(mocks.callMain).not.toHaveBeenCalledWith("clipboard:readForTerminal");
    expect(mocks.resttyPane.sendKeyInput).not.toHaveBeenCalled();
  });
});
