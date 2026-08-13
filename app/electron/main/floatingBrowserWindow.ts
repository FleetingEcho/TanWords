/** The floating mobile-browser widget's "detached" state: a standalone,
 *  frameless/transparent/always-on-top window holding the SAME bezel chrome
 *  (`floating-browser.html`, a second Vite renderer entry — see
 *  vite.config.ts) that the docked widget renders inline in the main window.
 *  Detaching moves the active tab's native WebContentsView from the main
 *  window to this one (`BrowserPanelManager.reparentTo`); re-docking reverses
 *  it. Only one of these ever exists at a time. */
import { BrowserWindow } from "electron";
import path from "node:path";
import { rendererEntryUrl } from "./protocol";
import type { BrowserPanelManager } from "./BrowserPanelManager";

let popout: BrowserWindow | null = null;
/** Set while `dock()` is closing the window itself, so the generic `closed`
 *  handler below doesn't also broadcast "closed" right after dock already
 *  broadcast "open" for the same transition. */
let dockingInProgress = false;

export function isFloatingBrowserDetached(): boolean {
  return !!popout && !popout.isDestroyed();
}

export function createFloatingBrowserWindow(opts: {
  floatingBrowserPanel: BrowserPanelManager;
  bounds: { x: number; y: number; width: number; height: number };
  broadcastEvent: (name: string, payload: unknown) => void;
  getMainWindow: () => BrowserWindow | null;
}): void {
  if (popout && !popout.isDestroyed()) {
    popout.focus();
    return;
  }
  const { floatingBrowserPanel, bounds, broadcastEvent, getMainWindow } = opts;

  const win = new BrowserWindow({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    minWidth: 260,
    minHeight: 480,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    // Resized programmatically (floating_browser_window_set_bounds, driven
    // by the popout's own 8-way drag handles) rather than by the OS's native
    // edge-resize — transparent frameless windows don't reliably expose
    // resize cursors/hit-testing on macOS. `resizable: false` just turns off
    // the (unreliable) native path; win.setBounds() is unaffected by it.
    resizable: false,
    // Not a document you'd want cluttering the dock/alt-tab switcher — it's a
    // widget, not a separate app surface.
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  popout = win;

  // Reparent the active tab's native content here immediately — the window
  // doesn't need to finish loading its own chrome first, the view just sits
  // attached (and correctly hidden behind not-yet-shown `show: false`) until
  // ready-to-show.
  floatingBrowserPanel.reparentTo(win);

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  // This window's own top-level content is always our own bezel chrome, never
  // arbitrary remote content (that lives in the separately-managed
  // WebContentsView) — deny popups and cross-origin navigation outright
  // rather than needing the main window's external-link allowlist.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const entryOrigin = new URL(process.env["VITE_DEV_SERVER_URL"] ?? rendererEntryUrl()).origin;
  win.webContents.on("will-navigate", (event, url) => {
    let allowed: boolean;
    try {
      allowed = new URL(url).origin === entryOrigin || url === "about:blank";
    } catch {
      allowed = false;
    }
    if (!allowed) event.preventDefault();
  });

  win.on("closed", () => {
    popout = null;
    // Only `dock()` (below) already moved the manager's `win` back to the
    // main window before closing this one. Every OTHER way this window can
    // go away — the popout's own confirm-close (destroys tabs, then calls
    // `window.close()` directly rather than the dock IPC), a native close,
    // Cmd+W — skips that, and would otherwise leave `BrowserPanelManager.win`
    // pointing at this now-destroyed `BrowserWindow` forever: the next
    // `attach()`/`show()` call (e.g. reopening the docked widget) would throw
    // "Object has been destroyed" reaching into it. Reparenting onto the main
    // window here — even with no tab left attached to move, which is the
    // common case since confirm-close tears tabs down first — restores that
    // invariant regardless of which of those paths triggered it.
    if (!dockingInProgress) {
      const mainWin = getMainWindow();
      if (mainWin && !mainWin.isDestroyed()) floatingBrowserPanel.reparentTo(mainWin);
      broadcastEvent("floatingBrowser:statusChanged", { status: "closed" });
    }
    dockingInProgress = false;
  });

  const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
  const url = devServerUrl ? `${devServerUrl}/floating-browser.html` : rendererEntryUrl("floating-browser.html");
  void win.loadURL(url);
}

export function dockFloatingBrowserWindow(opts: {
  mainWindow: BrowserWindow;
  floatingBrowserPanel: BrowserPanelManager;
  broadcastEvent: (name: string, payload: unknown) => void;
}): void {
  if (!popout || popout.isDestroyed()) return;
  dockingInProgress = true;
  opts.floatingBrowserPanel.reparentTo(opts.mainWindow);
  popout.close();
  popout = null;
  opts.broadcastEvent("floatingBrowser:statusChanged", { status: "open" });
}

/** The popout's own minimize button — hides the OS window without closing
 *  it or docking it back into the main window; the tab keeps running exactly
 *  as it was (unlike dock, no reparent happens here at all). Distinct from
 *  the main window's `floatingBrowserPanel`/status "minimized": that hides a
 *  *docked* widget by detaching its native view, since the widget itself is
 *  DOM inside the main window. Here there's nothing to detach — hiding the
 *  whole popout window already takes the native view (its child) with it. */
export function hideFloatingBrowserWindow(broadcastEvent: (name: string, payload: unknown) => void): void {
  if (!popout || popout.isDestroyed()) return;
  popout.hide();
  broadcastEvent("floatingBrowser:statusChanged", { status: "detachedHidden" });
}

/** Reverses hideFloatingBrowserWindow — triggered from the main window's
 *  CommandBar icon while status is "detachedHidden". */
export function showFloatingBrowserWindow(broadcastEvent: (name: string, payload: unknown) => void): void {
  if (!popout || popout.isDestroyed()) return;
  popout.show();
  popout.focus();
  broadcastEvent("floatingBrowser:statusChanged", { status: "detached" });
}

/** The window (and everything attached to it) is gone — main's window
 *  `closed` handler on macOS, where the app survives its last window
 *  closing. Mirrors BrowserPanelManager.reset()'s reasoning. */
export function resetFloatingBrowserWindow(): void {
  if (popout && !popout.isDestroyed()) popout.destroy();
  popout = null;
}
