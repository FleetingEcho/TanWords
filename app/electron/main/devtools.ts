/** DevTools keyboard shortcuts.
 *
 *  Wired straight to a window's webContents rather than through a View menu:
 *  the app deliberately ships only the app/edit/window menus (see the
 *  `Menu.setApplicationMenu` call in index.ts), and an accelerator attached to
 *  a menu item that isn't in the menu does not reliably fire.
 *
 *  Both platform conventions are accepted everywhere, plus F12 — the cost of a
 *  spare binding is nil, and it means muscle memory from another OS still
 *  works. */
import type { BrowserWindow, WebContents } from "electron";

/** The subset of Electron's `Input` this needs. Declared structurally so the
 *  matcher can be exercised without an Electron runtime. */
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export function isDevToolsShortcut(input: KeyInput): boolean {
  if (input.type !== "keyDown") return false;
  const key = input.key.toLowerCase();

  if (key === "f12") return true;
  // Cmd+Opt+I (macOS) / Ctrl+Shift+I (Windows, Linux) — Chromium's own
  // bindings. `J` is accepted for the same reason F12 is: it is the other
  // combination people have in their fingers.
  if ((key === "i" || key === "j") && !input.control && input.meta && input.alt) return true;
  if ((key === "i" || key === "j") && input.control && input.shift && !input.meta) return true;

  return false;
}

/** Attaches the shortcut to `contents`. Safe to call for the main window and
 *  for a browser-panel view alike — each webContents opens its own inspector,
 *  which is what you want: F12 over the embedded page should inspect that
 *  page, not the app shell hosting it. */
export function wireDevToolsShortcut(contents: WebContents) {
  contents.on("before-input-event", (event, input) => {
    if (!isDevToolsShortcut(input as unknown as KeyInput)) return;
    event.preventDefault();
    contents.toggleDevTools();
  });
}

export function wireWindowDevTools(win: BrowserWindow) {
  wireDevToolsShortcut(win.webContents);
}
