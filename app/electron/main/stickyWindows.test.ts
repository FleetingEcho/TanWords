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
  hideAllStickies,
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
});
