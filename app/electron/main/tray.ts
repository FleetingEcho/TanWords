/** The menu-bar / system-tray icon and its dropdown.
 *
 *  Ported from the Tauri-era `core/src/tray.rs`, which the Electron migration
 *  dropped. Same menu, same behaviour:
 *
 *    Open main window
 *    DeepSeek Harness
 *    Terminal
 *    Music Control  ▸  ⏸ <track>  /  ⏮ Previous  /  ⏭ Next
 *    ─────────────
 *    Refresh RSS
 *    ─────────────
 *    Quit
 *
 *  Only "open main window" and "quit" can be served from here. Playback lives
 *  in the renderer's podcastPlayerStore and RSS syncing goes through the
 *  sidecar, so those rows emit `tray://*` events for `useTraySync` to act on,
 *  and the renderer pushes playback state back so the labels stay honest.
 *  "DeepSeek Harness" and "Terminal" are the same pattern: they surface the
 *  window here (the only thing this process can do directly) and leave the
 *  actual page navigation to the renderer via `tray://open-dsh` /
 *  `tray://open-terminal`. */
import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import path from "node:path";
import { restoreAndFocusWindow } from "./windowVisibility";

export type TrayLang = "en" | "zh";

export interface NowPlaying {
  title: string | null;
  playing: boolean;
  hasPlaylist: boolean;
}

// Every row is prefixed with a glyph. These are text, not images, so they
// inherit the menu's foreground colour and stay legible in both light and dark
// menu bars — macOS does not invert menu-item images, so an embedded PNG icon
// would disappear in one theme or the other.
const GLYPH_PLAY = "▶";
const GLYPH_PAUSE = "⏸";

const STRINGS = {
  en: {
    showWindow: "Open main window",
    openDsh: "DeepSeek Harness",
    openTerminal: "Terminal",
    musicControl: "Music Control",
    play: "Play",
    prev: "Previous",
    next: "Next",
    refreshRss: "Refresh RSS",
    quit: "Quit",
  },
  zh: {
    showWindow: "打开主窗口",
    openDsh: "DeepSeek Harness",
    openTerminal: "终端",
    musicControl: "音乐控制",
    play: "播放",
    prev: "上一首",
    next: "下一首",
    refreshRss: "刷新 RSS",
    quit: "退出",
  },
} as const satisfies Record<TrayLang, Record<string, string>>;

/** The track title takes the place of the "Play"/"Pause" word — the glyph
 *  already says which action the row performs. */
function toggleLabel(lang: TrayLang, now: NowPlaying): string {
  if (!now.title) return `${GLYPH_PLAY}  ${STRINGS[lang].play}`;
  return `${now.playing ? GLYPH_PAUSE : GLYPH_PLAY}  ${[...now.title].slice(0, 40).join("")}`;
}

export class TrayManager {
  private tray: Tray | null = null;
  private win: BrowserWindow | null = null;
  private onEvent: ((name: string, payload: unknown) => void) | null = null;
  private lang: TrayLang = "en";
  private now: NowPlaying = { title: null, playing: false, hasPlaylist: false };
  /** Holds the native menu for Windows/Linux and the manual right-click popup
   *  on macOS. Keeping the JS object alive also avoids AppKit weak-reference
   *  warnings while a popup is open. */
  private menu: Menu | null = null;

  setWindow(win: BrowserWindow) {
    this.win = win;
  }

  setEventSink(sink: (name: string, payload: unknown) => void) {
    this.onEvent = sink;
  }

  /** macOS reads its icon as a template mask and recolours it for the current
   *  menu bar. Windows and Linux receive the full-colour TanWords icon instead
   *  (see trayIconPath), so their tray matches the installed application. */
  create(iconPath: string) {
    if (this.tray) return;
    const image = nativeImage.createFromPath(iconPath);
    image.setTemplateImage(process.platform === "darwin");
    this.tray = new Tray(image);
    this.tray.setToolTip(app.getName());
    // Windows/Linux: left-click is the fastest path back to the app;
    // `setContextMenu` below already gives right-click its native
    // context-menu behavior there, no separate handler needed. macOS wants
    // both clicks to open the same dropdown menu instead — `setContextMenu()`
    // already does exactly that there by default, so no click handler is
    // installed at all; adding one would have to fight it.
    if (process.platform !== "darwin") {
      this.tray.on("click", () => this.showMainWindow());
    }
    this.buildMenu();
  }

  setLanguage(lang: TrayLang) {
    if (this.lang === lang) return;
    this.lang = lang;
    this.buildMenu();
  }

  /** Read by other main-process rows (the task-finished notification) that
   *  want to match the tray's language without each tracking their own copy
   *  of the `tray_set_language` IPC the renderer already pushes here. */
  getLanguage(): TrayLang {
    return this.lang;
  }

  setNowPlaying(now: NowPlaying) {
    // The renderer pushes a seed value at mount and again on every store
    // change; rebuilding a menu that would come out identical is pure native
    // churn, and each rebuild is what risks orphaning the previous NSMenu.
    if (
      this.now.title === now.title &&
      this.now.playing === now.playing &&
      this.now.hasPlaylist === now.hasPlaylist
    ) {
      return;
    }
    this.now = now;
    // Deliberately not a rebuild: handing the tray a fresh menu orphans the
    // NSMenu behind the old one, which macOS reports as one
    // "representedObject is not a WeakPtrToElectronMenuModelAsNSObject" line
    // per menu item. Playback state changes often, so mutate the existing
    // items instead and leave setContextMenu for language switches.
    this.syncPlaybackItems();
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
    this.menu = null;
  }

  private showMainWindow() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    restoreAndFocusWindow(win);
  }

  /** Builds and installs the menu. Only the static labels come from here, so
   *  this runs on startup and on a language switch — the two moments where
   *  replacing the native menu is unavoidable. */
  private buildMenu() {
    if (!this.tray) return;
    const s = STRINGS[this.lang];
    const emit = (name: string) => this.onEvent?.(name, null);

    this.menu = Menu.buildFromTemplate([
      { label: s.showWindow, click: () => this.showMainWindow() },
      {
        label: s.openDsh,
        click: () => {
          this.showMainWindow();
          emit("tray://open-dsh");
        },
      },
      {
        label: s.openTerminal,
        click: () => {
          this.showMainWindow();
          emit("tray://open-terminal");
        },
      },
      {
        id: "music",
        label: s.musicControl,
        submenu: [
          { id: "toggle", label: toggleLabel(this.lang, this.now), click: () => emit("tray://toggle-play") },
          { id: "prev", label: `⏮  ${s.prev}`, click: () => emit("tray://prev") },
          { id: "next", label: `⏭  ${s.next}`, click: () => emit("tray://next") },
        ],
      },
      { type: "separator" },
      { label: `${s.refreshRss}`, click: () => emit("tray://refresh-rss") },
      { type: "separator" },
      { label: s.quit, click: () => app.quit() },
    ]);
    this.syncPlaybackItems();
    // On every platform this both installs the right-click menu and (macOS
    // only — see create()) makes left-click open the same menu instead of
    // the window.
    this.tray.setContextMenu(this.menu);
    // macOS Dock icon: a plain left-click on a running app's Dock icon always
    // activates/restores its windows — that's Dock behavior the OS owns, not
    // something an app can redirect into showing a menu instead (there is no
    // Electron/macOS API for it). Right-click (or Control-click / long-press)
    // is the one Dock interaction apps DO get to customize, via this same
    // menu — same items as the tray's, so both entry points agree.
    if (process.platform === "darwin") app.dock?.setMenu(this.menu);
  }

  /** Applies the current playback state to the already-installed menu.
   *
   *  Nothing loaded means every row in here is a no-op — `toggle()` on an
   *  empty player does nothing, so leaving it enabled just offers a click that
   *  appears broken. Greyed out rather than hidden, so the submenu keeps a
   *  stable shape as playback starts and stops. */
  private syncPlaybackItems() {
    const menu = this.menu;
    if (!menu) return;
    const hasTrack = this.now.title !== null;

    const music = menu.getMenuItemById("music");
    if (music) music.enabled = hasTrack || this.now.hasPlaylist;

    const toggle = menu.getMenuItemById("toggle");
    if (toggle) {
      toggle.label = toggleLabel(this.lang, this.now);
      toggle.enabled = hasTrack;
    }
    // Skipping needs somewhere to skip to.
    const prev = menu.getMenuItemById("prev");
    if (prev) prev.enabled = this.now.hasPlaylist;
    const next = menu.getMenuItemById("next");
    if (next) next.enabled = this.now.hasPlaylist;
  }
}

/** Packaged builds get the icon from extraResources; a dev run reads it out of
 *  the repo, mirroring how `appIconPath()` resolves the window icon.
 *
 *  macOS uses a monochrome template because the menu bar recolours it for the
 *  current theme. Windows and Linux display pixels as-is, so use the same
 *  full-colour application icon already shipped for BrowserWindow there. */
export function trayIconPath(): string {
  const name = process.platform === "darwin" ? "tray-template.png" : "icon.png";
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(app.getAppPath(), "core", "icons", name);
}
