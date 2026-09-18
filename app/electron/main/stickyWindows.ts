/** Sticky-note windows — the tanNotes parity feature (Stickies plan S1).
 *
 *  Every sticky is a standalone frameless/transparent BrowserWindow loading
 *  `sticky.html?id=<id>` (a Vite renderer entry — see vite.config.ts). The
 *  Rust sidecar owns the DATA (db/stickies.rs: content, color, opacity,
 *  font, trash, search, bundle); THIS module owns only the OS windows and
 *  their per-window geometry hand-off:
 *
 *  - Geometry: the renderer persists its own window state through the normal
 *    sidecar commands (`sticky_update_window_state`), exactly like every
 *    other piece of sticky data — main only nudges it ("your bounds changed")
 *    via the `stickywin:geometryChanged` broadcast after native moves/resizes,
 *    and flushes geometry once more on quit (see `flushStickiesForQuit`).
 *  - `is_open`: flipped by whoever drives the lifecycle (manager renderer,
 *    sticky renderer's close button). The one case main handles itself is a
 *    sticky window destroyed out from under the renderer (native close, OS
 *    shutdown) — the `closed` handler posts `is_open:false` best-effort.
 *
 *  The floating-manager window lives here too: it's the sticky hub (list,
 *  search, new note, settings) in its own small window (`sticky-manager.html`)
 *  — tanNotes' manager parity, opened from tray/Settings/global hotkey.
 */
import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { rendererEntryUrl } from "./protocol";

/** The collapsed sticky is just its header row. */
export const STICKY_HEADER_HEIGHT = 44;
const MIN_W = 180;
const MIN_H = 140;
const DEFAULT_W = 260;
const DEFAULT_H = 480;
/** Cascade placement for notes with no saved geometry: offset each window
 *  by this much so opening several at once reads as a fan, not a stack. */
const CASCADE_STEP = 28;

type StickyEntry = {
  win: BrowserWindow;
  id: number;
  /** Set while `closeStickyWindow` is closing the window itself, so the
   *  generic `closed` handler below doesn't also broadcast "closed" and post
   *  `is_open:false` right after the renderer already did. */
  closingByRequest: boolean;
};

const windows = new Map<number, StickyEntry>();
let manager: BrowserWindow | null = null;
/** Assigned from index.ts once the sidecar exists — the only way main can
 *  reach the Rust side (it owns port+token; see sidecar.ts). */
let persistGeometry:
  | ((id: number, g: { x: number; y: number; width: number; height: number }, isOpen: boolean) => void)
  | null = null;
let broadcastEvent: (name: string, payload: unknown) => void = () => {};

export function initStickyWindows(opts: {
  persistGeometry: NonNullable<typeof persistGeometry>;
  broadcastEvent: (name: string, payload: unknown) => void;
}): void {
  persistGeometry = opts.persistGeometry;
  broadcastEvent = opts.broadcastEvent;
}

export function stickyWindowIds(): number[] {
  return [...windows.keys()];
}

export function isStickyWindowOpen(id: number): boolean {
  const entry = windows.get(id);
  return !!entry && !entry.win.isDestroyed();
}

function entryFor(id: number): StickyEntry | null {
  const entry = windows.get(id);
  return entry && !entry.win.isDestroyed() ? entry : null;
}

/** Loads a renderer page in a sticky-owned window, applying the same
 *  navigation allowlist as the floating-browser popout. */
function loadStickyPage(win: BrowserWindow, page: string, query: string): void {
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
  const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
  const url = devServerUrl
    ? `${devServerUrl}/${page}?${query}`
    : rendererEntryUrl(`${page}?${query}`);
  void win.loadURL(url);
}

export function openStickyWindow(opts: {
  id: number;
  /** Last saved geometry (DB `sticky_windows`, this device). May be null —
   *  the note has never been opened here, so cascade off the work area. */
  bounds?: { x: number; y: number; width: number; height: number } | null;
  alwaysOnTop?: boolean;
  collapsed?: boolean;
  opacity?: number;
}): void {
  const existing = entryFor(opts.id);
  if (existing) {
    existing.win.show();
    existing.win.focus();
    return;
  }

  const bounds = opts.bounds ?? null;
  const width = Math.max(MIN_W, bounds?.width ?? DEFAULT_W);
  const height = Math.max(MIN_H, bounds?.height ?? DEFAULT_H);
  // Cascade for unknown positions: stack down-right from the top-left of the
  // screen the CURSOR is on (tanNotes F8 — the note appears where the user is
  // looking, which matters on multi-monitor setups), offset by how many
  // stickies are already open.
  const cursor = screen.getCursorScreenPoint();
  const wa = screen.getDisplayMatching({ x: cursor.x, y: cursor.y, width: 1, height: 1 }).workArea;
  const x = bounds?.x ?? wa.x + 60 + CASCADE_STEP * (windows.size % 10);
  const y = bounds?.y ?? wa.y + 60 + CASCADE_STEP * (windows.size % 10);

  const win = new BrowserWindow({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(opts.collapsed ? STICKY_HEADER_HEIGHT : height),
    minWidth: MIN_W,
    minHeight: opts.collapsed ? STICKY_HEADER_HEIGHT : MIN_H,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: opts.alwaysOnTop ?? true,
    // Same reasoning as the floating-browser popout (floatingBrowserWindow.ts):
    // transparent frameless windows don't reliably expose native resize
    // hit-testing, so `resizable:false` only turns off the unreliable native
    // path — the renderer's 8-way handles drive `stickywin_set_bounds`.
    resizable: false,
    skipTaskbar: true,
    show: false,
    // Platform translucency beyond plain alpha (tanNotes risk #2 mitigation):
    // macOS blurs what's behind the note, Windows 11 uses acrylic. The
    // renderer's own opacity slider still applies on top; a user who finds
    // any of this unreadable flips the manager's "translucent" toggle, which
    // forces alpha 1.0 (see StickyWindowApp's sticky_translucent read).
    ...(process.platform === "darwin" ? { vibrancy: "under-window" as const } : {}),
    ...(process.platform === "win32" ? { backgroundMaterial: "acrylic" as const } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium spellcheck inside notes (tanNotes F20 parity).
      spellcheck: true,
    },
  });
  // All Spaces (macOS F9): a sticky pinned to the desktop should follow the
  // user across Spaces, including over fullscreen apps.
  if (process.platform === "darwin") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  const entry: StickyEntry = { win, id: opts.id, closingByRequest: false };
  windows.set(opts.id, entry);

  // Native moves/resizes (header drag) — tell the renderer so it persists
  // through the normal sidecar command. Debounced per window: 'moved' fires
  // continuously during a drag.
  let geoTimer: NodeJS.Timeout | null = null;
  const pushGeometry = () => {
    if (geoTimer) clearTimeout(geoTimer);
    geoTimer = setTimeout(() => {
      geoTimer = null;
      if (win.isDestroyed()) return;
      broadcastEvent("stickywin:geometryChanged", { id: opts.id });
    }, 700);
  };
  win.on("moved", pushGeometry);
  win.on("resized", pushGeometry);

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  win.on("closed", () => {
    windows.delete(opts.id);
    if (geoTimer) clearTimeout(geoTimer);
    broadcastEvent("stickywin:closed", { id: opts.id });
    // A renderer-driven close already persisted `is_open:false` + geometry
    // before asking us to destroy the window. Every OTHER way this window can
    // go away leaves the DB row claiming "open" — post the correction.
    if (!entry.closingByRequest && persistGeometry) {
      try {
        const b = win.getBounds();
        persistGeometry(opts.id, b, false);
      } catch {
        // Window already gone — nothing to persist.
      }
    }
  });

  loadStickyPage(win, "sticky.html", `id=${opts.id}`);
}

export function closeStickyWindow(id: number): void {
  const entry = entryFor(id);
  if (!entry) return;
  entry.closingByRequest = true;
  entry.win.close();
  windows.delete(id);
}

export function closeAllStickyWindows(): void {
  for (const id of [...windows.keys()]) closeStickyWindow(id);
}

export function focusStickyWindow(id: number): void {
  const entry = entryFor(id);
  if (!entry) return;
  entry.win.show();
  entry.win.focus();
}

export function setStickyAlwaysOnTop(id: number, on: boolean): void {
  const entry = entryFor(id);
  entry?.win.setAlwaysOnTop(on);
}

/** Bounds of an open sticky window, or null. The manager/renderer uses this
 *  (via `window_get_bounds` for its OWN window) — main uses it at quit. */
export function stickyWindowBounds(id: number): { x: number; y: number; width: number; height: number } | null {
  const entry = entryFor(id);
  return entry ? entry.win.getBounds() : null;
}

/** Reopens notes that were CLOSED on this device. Injected by index.ts (it
 *  owns the sidecar client + openStickyFromDb; importing here would be
 *  circular). Regression 2026-09: show-all used to only un-hide LIVE
 *  windows, so a closed note never came back and the manager's button
 *  looked dead. */
let reopenClosedStickies: (() => Promise<void>) | null = null;
export function setStickyReopener(fn: (() => Promise<void>) | null): void {
  reopenClosedStickies = fn;
}

/** Whether a live OS window exists for this note id (used by the reopener
 *  to skip notes that are already on screen). */
export function hasStickyWindow(id: number): boolean {
  const entry = entryFor(id);
  return !!entry && !entry.win.isDestroyed();
}

/** Show all: every live window comes back, AND notes closed on this device
 *  reopen (tanNotes parity). `is_open` flips via the normal open path so
 *  launch-reopen stays consistent. */
export function showAllStickies(): void {
  for (const entry of windows.values()) {
    if (!entry.win.isDestroyed()) entry.win.show();
  }
  void reopenClosedStickies?.();
}

export function hideAllStickies(): void {
  for (const entry of windows.values()) {
    if (!entry.win.isDestroyed()) entry.win.hide();
  }
}

/** Quit-time flush: one last geometry write per open sticky so a drag in the
 *  final second isn't lost (the renderer's own persistence covers everything
 *  else). Fire-and-forget — `before-quit` can't await forever. */
export function flushStickiesForQuit(): void {
  if (!persistGeometry) return;
  for (const entry of [...windows.values()]) {
    if (entry.win.isDestroyed()) continue;
    try {
      persistGeometry(entry.id, entry.win.getBounds(), true);
    } catch {
      // ignore
    }
  }
}

/** Destroys every sticky window without persistence — used after the flush
 *  on quit so the windows don't outlive the app teardown. */
export function destroyAllStickyWindows(): void {
  for (const entry of [...windows.values()]) {
    entry.closingByRequest = true;
    if (!entry.win.isDestroyed()) entry.win.destroy();
  }
  windows.clear();
  if (manager && !manager.isDestroyed()) manager.destroy();
  manager = null;
}

// ── Floating manager window ────────────────────────────────────────────────

const MANAGER_W = 380;
const MANAGER_H = 620;

export function isStickyManagerOpen(): boolean {
  return !!manager && !manager.isDestroyed();
}

export function openStickyManagerWindow(): void {
  if (manager && !manager.isDestroyed()) {
    manager.show();
    manager.focus();
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    x: Math.round(wa.x + wa.width - MANAGER_W - 40),
    y: Math.round(wa.y + 40),
    width: MANAGER_W,
    height: MANAGER_H,
    minWidth: 320,
    minHeight: 420,
    frame: false,
    // Opaque window — unlike sticky notes this is a control surface and uses
    // normal app chrome, so no transparency gymnastics.
    hasShadow: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  manager = win;
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on("closed", () => {
    manager = null;
    broadcastEvent("stickywin:managerClosed", null);
  });
  loadStickyPage(win, "sticky-manager.html", "");
}

export function closeStickyManagerWindow(): void {
  if (manager && !manager.isDestroyed()) manager.close();
  manager = null;
}
