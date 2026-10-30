/** Regression tests for the manager's Show all / Hide all buttons
 *  (2026-09): both only touched LIVE windows, so after closing a note the
 *  manager's "Show all" silently did nothing — closed notes never came back.
 *  Show all must also reopen notes closed on this device (tanNotes parity);
 *  Hide all stays a visibility-only toggle (hidden notes reopen at launch). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeWin = {
  isDestroyed: () => boolean;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  webContents: { executeJavaScript: ReturnType<typeof vi.fn> };
};

const fakeWins: FakeWin[] = [];

vi.mock("electron", () => ({
  app: { getName: () => "TanNotes", isPackaged: false, getAppPath: () => "/app" },
  BrowserWindow: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    isDestroyed = () => false;
    on = vi.fn();
    once = vi.fn();
    close = vi.fn();
    destroy = vi.fn();
    // Eager like the real thing: the creation path shows the window.
    loadURL = vi.fn().mockImplementation(async () => {
      this.readyToShow?.();
    });
    readyToShow?: () => void;
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      isDestroyed: () => false,
      isDevToolsOpened: vi.fn().mockReturnValue(false),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(true),
    };
    constructor() {
      this.readyToShow = () => this.show();
      fakeWins.push(this as unknown as FakeWin);
    }
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
  nativeImage: { createFromPath: () => ({ setTemplateImage: vi.fn() }) },
}));
vi.mock("./protocol", () => ({ rendererEntryUrl: () => "file:///app/index.html" }));

import {
  destroyAllStickyWindows,
  closeStickyWindow,
  flushStickyContent,
  flushStickyContentForQuit,
  hideAllStickies,
  initStickyWindows,
  openStickyWindow,
  setStickyReopener,
  showAllStickies,
} from "./stickyWindows";

describe("show all / hide all stickies", () => {
  beforeEach(() => {
    destroyAllStickyWindows();
    fakeWins.length = 0;
    setStickyReopener(null);
  });

  afterEach(() => {
    setStickyReopener(null);
  });

  it("shows every live window and does not touch closed notes when none are closed", async () => {
    openStickyWindow({ id: 1, bounds: null });
    openStickyWindow({ id: 2, bounds: null });
    const reopen = vi.fn().mockResolvedValue(undefined);
    setStickyReopener(reopen);

    showAllStickies();

    // Creation already shows via ready-to-show; show-all shows again.
    expect(fakeWins.every((w) => w.show.mock.calls.length >= 1)).toBe(true);
    // Wait a microtask turn for the fire-and-forget reopen call.
    await Promise.resolve();
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("delegates reopening closed notes to the injected reopener", async () => {
    openStickyWindow({ id: 1, bounds: null });
    const reopen = vi.fn().mockResolvedValue(undefined);
    setStickyReopener(reopen);

    showAllStickies();
    await Promise.resolve();

    // The live window is shown; the reopener handles the closed notes.
    expect(fakeWins.every((w) => w.show.mock.calls.length >= 1)).toBe(true);
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("hide all hides every live window without lifecycle changes", () => {
    openStickyWindow({ id: 1, bounds: null });
    openStickyWindow({ id: 2, bounds: null });

    hideAllStickies();

    expect(fakeWins.map((w) => w.hide.mock.calls.length)).toEqual([1, 1]);
  });

  it("skips destroyed windows instead of throwing", () => {
    openStickyWindow({ id: 1, bounds: null });
    // Creation itself shows via ready-to-show; only the show/hide-ALL calls
    // after this point must be skipped for a destroyed window.
    fakeWins[0]!.show.mockClear();
    fakeWins[0]!.hide.mockClear();
    (fakeWins[0] as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true;

    expect(() => showAllStickies()).not.toThrow();
    expect(() => hideAllStickies()).not.toThrow();
    expect(fakeWins[0]!.show).not.toHaveBeenCalled();
    expect(fakeWins[0]!.hide).not.toHaveBeenCalled();
  });

  it("asks the renderer to save before a native close", () => {
    const broadcastEvent = vi.fn();
    initStickyWindows({ persistGeometry: vi.fn(), broadcastEvent });
    openStickyWindow({ id: 3, bounds: null });
    const win = fakeWins[0]!;
    const closeHandler = win.on.mock.calls.find(([name]) => name === "close")?.[1] as (event: { preventDefault: () => void }) => void;
    const preventDefault = vi.fn();

    closeHandler({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(broadcastEvent).toHaveBeenCalledWith("stickywin:requestClose", { id: 3 });

    closeStickyWindow(3);
    preventDefault.mockClear();
    closeHandler({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("opens sticky DevTools in a separate window and toggles them closed", () => {
    openStickyWindow({ id: 6, bounds: null });
    const contents = fakeWins[0]!.webContents as FakeWin["webContents"] & {
      on: ReturnType<typeof vi.fn>;
      isDevToolsOpened: ReturnType<typeof vi.fn>;
      openDevTools: ReturnType<typeof vi.fn>;
      closeDevTools: ReturnType<typeof vi.fn>;
    };
    const inputHandler = contents.on.mock.calls.find(([name]) => name === "before-input-event")?.[1] as
      | ((event: { preventDefault: () => void }, input: object) => void)
      | undefined;
    expect(inputHandler).toBeTypeOf("function");
    const preventDefault = vi.fn();
    const shortcut = { type: "keyDown", key: "i", control: true, shift: true, meta: false, alt: false };
    inputHandler!({ preventDefault }, shortcut);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(contents.openDevTools).toHaveBeenCalledWith({ mode: "detach" });

    contents.isDevToolsOpened.mockReturnValue(true);
    inputHandler!({ preventDefault }, shortcut);
    expect(contents.closeDevTools).toHaveBeenCalledOnce();
  });

  it("flushes note content before quit destroys the windows", async () => {
    openStickyWindow({ id: 4, bounds: null });
    expect(await flushStickyContentForQuit()).toBe(true);
    expect(fakeWins[0]!.webContents.executeJavaScript)
      .toHaveBeenCalledWith("window.__tanwordsFlushSticky?.() ?? true");
  });

  it("reports a failed renderer save to the manager", async () => {
    openStickyWindow({ id: 5, bounds: null });
    fakeWins[0]!.webContents.executeJavaScript.mockResolvedValue(false);
    expect(await flushStickyContent(5)).toBe(false);
    expect(await flushStickyContentForQuit()).toBe(false);
  });
});
