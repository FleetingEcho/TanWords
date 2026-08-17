import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Item = {
  id?: string;
  label?: string;
  type?: string;
  enabled?: boolean;
  click?: () => void;
  submenu?: Item[];
};

const built: Item[][] = [];
const trayInstances: Array<{
  handlers: Map<string, () => void>;
  setContextMenu: ReturnType<typeof vi.fn>;
  popUpContextMenu: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("electron", () => ({
  app: { getName: () => "TanWords", isPackaged: false, getAppPath: () => "/app", quit: vi.fn() },
  BrowserWindow: class {},
  Menu: {
    buildFromTemplate: (template: Item[]) => {
      built.push(template);
      // Returns the same objects the template is made of, so assertions
      // against `built` observe whatever syncPlaybackItems() mutates.
      const flat: Item[] = [];
      const walk = (items: Item[]) => items.forEach((i) => {
        flat.push(i);
        if (i.submenu) walk(i.submenu);
      });
      walk(template);
      return {
        items: template,
        getMenuItemById: (id: string) => flat.find((i) => i.id === id) ?? null,
      };
    },
  },
  Tray: class {
    handlers = new Map<string, () => void>();
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    popUpContextMenu = vi.fn();
    destroy = vi.fn();
    on = vi.fn((event: string, handler: () => void) => { this.handlers.set(event, handler); });
    constructor() { trayInstances.push(this); }
  },
  nativeImage: { createFromPath: () => ({ setTemplateImage: vi.fn() }) },
}));

import { TrayManager, trayIconPath } from "./tray";

/** The template captured from the most recent render. */
const latest = () => built[built.length - 1];
const labels = () => latest().map((i) => i.label);
const musicRows = () => latest().find((i) => i.submenu)!.submenu!;

function makeTray() {
  const events: string[] = [];
  const tray = new TrayManager();
  tray.setEventSink((name) => events.push(name));
  tray.create("/icons/tray-template.png");
  return { tray, events };
}

beforeEach(() => {
  built.length = 0;
  trayInstances.length = 0;
});
afterEach(() => { vi.restoreAllMocks(); });

describe("TrayManager menu", () => {
  it("opens the dropdown menu on a macOS click of either button, never the window", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const manager = new TrayManager();
    const win = {
      isDestroyed: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      focus: vi.fn(),
    };
    manager.setWindow(win as never);
    manager.create("/icons/tray-template.png");
    const nativeTray = trayInstances[0];

    // `setContextMenu` alone makes macOS treat both mouse buttons as "open
    // the menu" — no separate click/right-click handler needed, and none
    // should be installed (one would only race the built-in behavior).
    expect(nativeTray.setContextMenu).toHaveBeenCalledOnce();
    expect(nativeTray.handlers.has("click")).toBe(false);
    expect(nativeTray.handlers.has("right-click")).toBe(false);
    expect(win.show).not.toHaveBeenCalled();
  });

  it("keeps the native context menu on Windows and Linux", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    makeTray();

    expect(trayInstances[0].setContextMenu).toHaveBeenCalledOnce();
    expect(trayInstances[0].handlers.has("right-click")).toBe(false);
  });

  it("renders the ported menu in English by default", () => {
    makeTray();

    expect(labels()).toEqual([
      "Open main window",
      "DeepSeek Harness",
      "Terminal",
      "Music Control",
      undefined, // separator
      "Refresh RSS",
      undefined,
      "Quit",
    ]);
  });

  it("re-renders every label when the UI language changes", () => {
    const { tray } = makeTray();

    tray.setLanguage("zh");

    expect(labels()).toEqual([
      "打开主窗口",
      "DeepSeek Harness",
      "终端",
      "音乐控制",
      undefined,
      "刷新 RSS",
      undefined,
      "退出",
    ]);
    expect(musicRows().map((i) => i.label)).toEqual(["▶  播放", "⏮  上一首", "⏭  下一首"]);
  });

  it("disables every playback row while nothing is loaded", () => {
    makeTray();

    // Play used to stay enabled here, which offered a click that did nothing:
    // toggle() on an empty player is a no-op.
    expect(musicRows().map((i) => i.enabled)).toEqual([false, false, false]);
    expect(latest().find((i) => i.submenu)!.enabled).toBe(false);
  });

  it("enables play once a track is loaded, and skipping once there is a playlist", () => {
    const { tray } = makeTray();

    // A single track with no playlist around it: playable, but nowhere to skip.
    tray.setNowPlaying({ title: "Episode 12", playing: false, hasPlaylist: false });
    expect(musicRows().map((i) => i.enabled)).toEqual([true, false, false]);
    expect(latest().find((i) => i.submenu)!.enabled).toBe(true);

    tray.setNowPlaying({ title: "Episode 12", playing: true, hasPlaylist: true });
    expect(musicRows().map((i) => i.enabled)).toEqual([true, true, true]);
  });

  it("puts the track title where the Play/Pause word goes, with the glyph carrying the action", () => {
    const { tray } = makeTray();

    tray.setNowPlaying({ title: "Episode 12", playing: true, hasPlaylist: true });
    expect(musicRows()[0].label).toBe("⏸  Episode 12");

    tray.setNowPlaying({ title: "Episode 12", playing: false, hasPlaylist: true });
    expect(musicRows()[0].label).toBe("▶  Episode 12");
  });

  it("truncates a long title rather than stretching the menu", () => {
    const { tray } = makeTray();

    tray.setNowPlaying({ title: "x".repeat(80), playing: false, hasPlaylist: true });

    expect(musicRows()[0].label).toBe(`▶  ${"x".repeat(40)}`);
  });

  // Each rebuild hands the tray a new menu and orphans the NSMenu behind the
  // old one, which macOS reports as one "representedObject is not a
  // WeakPtrToElectronMenuModelAsNSObject" line per item. Playback changes
  // constantly, so it must update the installed menu in place instead.
  it("never rebuilds the menu for a playback change", () => {
    const { tray } = makeTray();
    const afterCreate = built.length;

    tray.setNowPlaying({ title: "Episode 12", playing: true, hasPlaylist: true });
    tray.setNowPlaying({ title: "Episode 13", playing: false, hasPlaylist: true });
    tray.setNowPlaying({ title: null, playing: false, hasPlaylist: false });

    expect(built.length).toBe(afterCreate);
    // …and the installed menu still reflects the latest state.
    expect(musicRows()[0].label).toBe("▶  Play");
    expect(musicRows().map((i) => i.enabled)).toEqual([false, false, false]);
  });

  it("does not rebuild the menu for an unchanged language", () => {
    const { tray } = makeTray();
    const afterCreate = built.length;

    tray.setLanguage("en");
    expect(built.length).toBe(afterCreate);

    tray.setLanguage("zh");
    expect(built.length).toBe(afterCreate + 1);
  });

  it("emits the events useTraySync listens for", () => {
    const { events } = makeTray();

    latest().find((i) => i.label === "DeepSeek Harness")!.click?.();
    latest().find((i) => i.label === "Terminal")!.click?.();
    musicRows().forEach((row) => row.click?.());
    latest().find((i) => i.label?.includes("Refresh RSS"))!.click?.();

    expect(events).toEqual([
      "tray://open-dsh",
      "tray://open-terminal",
      "tray://toggle-play",
      "tray://prev",
      "tray://next",
      "tray://refresh-rss",
    ]);
  });
});

describe("trayIconPath", () => {
  it("uses the full-colour application icon on Windows", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    expect(trayIconPath()).toMatch(/[\\/]icon\.png$/);
  });

  it("uses the full-colour application icon on Linux", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    expect(trayIconPath()).toMatch(/[\\/]icon\.png$/);
  });

  it("keeps the adaptive menu-bar template on macOS", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    expect(trayIconPath()).toMatch(/[\\/]tray-template\.png$/);
  });
});
