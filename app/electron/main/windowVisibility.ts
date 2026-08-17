import type { BrowserWindow } from "electron";

/** Windows waiting for the native fullscreen Space to finish closing. */
const pendingFullscreenHides = new WeakSet<BrowserWindow>();

/**
 * Hide-to-tray cannot happen while macOS still owns a fullscreen Space. Doing
 * so leaves that Space active with no renderer to composite, which looks like
 * a stuck black window. Exit fullscreen first and hide only after Electron has
 * received AppKit's leave-full-screen confirmation.
 */
export function requestWindowHide(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (!win.isFullScreen()) {
    win.hide();
    return;
  }
  if (pendingFullscreenHides.has(win)) return;

  pendingFullscreenHides.add(win);
  win.once("leave-full-screen", () => {
    if (!pendingFullscreenHides.delete(win) || win.isDestroyed()) return;
    win.hide();
  });
  win.setFullScreen(false);
}

/** Showing the window cancels a close that is still leaving fullscreen. */
export function showWindow(win: BrowserWindow): void {
  pendingFullscreenHides.delete(win);
  win.show();
}

/** Bring a possibly-hidden/minimized/background window fully to the front —
 *  the "make it visible right now" used by the tray's "Open main window" row,
 *  a task-finished notification click, and the global DSH shortcut. Restore
 *  before show(): showing a still-minimized window on some platforms just
 *  un-minimizes in place behind other windows rather than raising it. */
export function restoreAndFocusWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  showWindow(win);
  win.focus();
}
