import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  let windowHeight = 480;
  let emulatedHeight: number | null = null;

  class ClipboardItem {
    readonly data: Record<string, Blob>;
    constructor(data: Record<string, Blob>) {
      this.data = data;
    }
  }

  const capturePage = vi.fn(async () => ({
    toPNG: () => Buffer.from(`height=${windowHeight}`),
  }));
  const debuggerApi = {
    isAttached: vi.fn(() => false),
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn(async (method: string, params?: { height?: number }) => {
      if (method === "Emulation.setDeviceMetricsOverride") emulatedHeight = params?.height ?? null;
      if (method === "Emulation.clearDeviceMetricsOverride") emulatedHeight = null;
      if (method === "Page.captureScreenshot") {
        return { data: Buffer.from(`height=${emulatedHeight ?? windowHeight}`).toString("base64") };
      }
      return {};
    }),
  };
  const webContents = { capturePage, debugger: debuggerApi };
  const win = {
    webContents,
    isDestroyed: () => false,
    getBounds: () => ({ x: 20, y: 30, width: 500, height: windowHeight }),
    // Simulate a Linux window manager that refuses a window taller than the
    // screen. A viewport-resize implementation therefore truncates the PNG.
    setBounds: vi.fn((bounds: { height: number }) => {
      windowHeight = Math.min(bounds.height, 1080);
    }),
  };
  const clipboard = { write: vi.fn(async (_items: ClipboardItem[]) => {}) };

  return {
    BrowserWindow: { fromWebContents: vi.fn(() => win) },
    ClipboardItem,
    clipboard,
    debuggerApi,
    webContents,
    win,
    reset: () => {
      windowHeight = 480;
      emulatedHeight = null;
      capturePage.mockClear();
      debuggerApi.isAttached.mockClear();
      debuggerApi.attach.mockClear();
      debuggerApi.detach.mockClear();
      debuggerApi.sendCommand.mockClear();
      win.setBounds.mockClear();
      clipboard.write.mockClear();
    },
  };
});

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: electron.BrowserWindow,
  clipboard: electron.clipboard,
  ClipboardItem: electron.ClipboardItem,
  dialog: {},
  shell: {},
}));
vi.mock("./floatingBrowserWindow", () => ({
  createFloatingBrowserWindow: vi.fn(), dockFloatingBrowserWindow: vi.fn(),
  hideFloatingBrowserWindow: vi.fn(), showFloatingBrowserWindow: vi.fn(),
}));
vi.mock("./stickyWindows", () => ({
  closeAllStickyWindows: vi.fn(), closeStickyManagerWindow: vi.fn(), closeStickyWindow: vi.fn(),
  focusStickyWindow: vi.fn(), hideAllStickies: vi.fn(), openStickyManagerWindow: vi.fn(),
  openStickyWindow: vi.fn(), setStickyAlwaysOnTop: vi.fn(), showAllStickies: vi.fn(),
}));
vi.mock("./http", () => ({ abortFetch: vi.fn(), startFetch: vi.fn() }));
vi.mock("./windowBackground", () => ({ rememberWindowBackground: vi.fn() }));
vi.mock("./windowVisibility", () => ({ requestWindowHide: vi.fn(), showWindow: vi.fn() }));
vi.mock("./appNotification", () => ({ showAppNotification: vi.fn() }));
vi.mock("./terminal", () => ({
  terminalClose: vi.fn(), terminalDefaultShell: vi.fn(), terminalResize: vi.fn(),
  terminalSetOutputBackpressure: vi.fn(), terminalSpawn: vi.fn(), terminalWrite: vi.fn(),
}));

import { dispatch } from "./ipcDispatch";

describe("stickywin_capture_image", () => {
  beforeEach(() => electron.reset());

  it("copies the entire scrolling note when the OS clamps window height", async () => {
    await dispatch(
      "stickywin_capture_image",
      { fullHeight: 2400 },
      {} as never,
      electron.webContents as never,
    );

    const item = electron.clipboard.write.mock.calls[0]?.[0][0] as InstanceType<typeof electron.ClipboardItem>;
    expect(await item.data["image/png"]?.text()).toBe("height=2400");
  });
});
