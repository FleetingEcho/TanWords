/** Main-side handlers for every channel `src/ipc/*.ts` calls via
 *  `window.tanwords.call(...)`. `browser_*` routes to `BrowserPanelManager` —
 *  a native WebContentsView-based panel (see browserPanel.ts). `http:*` is the
 *  streaming case and lives in its own module (see http.ts). */
import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { UpdateInfoPayload } from "./updater";
import type { BrowserPanelManager } from "./BrowserPanelManager";
import { cosmeticsForWebContents } from "./browserPanel";
import type { DshSupervisor } from "./dshSupervisor";
import type { TrayManager } from "./tray";
import { dispatch } from "./ipcDispatch";

export type IpcDeps = {
  getMainWindow: () => BrowserWindow | null;
  broadcastEvent: (name: string, payload: unknown) => void;
  updater: {
    check: () => Promise<UpdateInfoPayload | null>;
    downloadAndInstall: () => Promise<void>;
  };
  browserPanel: BrowserPanelManager;
  floatingBrowserPanel: BrowserPanelManager;
  tray: TrayManager;
  dshSupervisor: DshSupervisor;
  dshPanel: import("./dshPanel").DshPanel;
  /** Registers (or, given `""`, clears) the global "jump to DSH" shortcut.
   *  Lives in index.ts because `globalShortcut` is an OS-wide singleton the
   *  whole app shares — not something a per-feature manager should own.
   *  Returns whether registration succeeded (an accelerator already claimed
   *  by the OS or another app fails). */
  setDshShortcut: (accelerator: string) => boolean;
};

/** Schemes `shell:open` will actually hand to `shell.openExternal` — an
 *  unvalidated openExternal is a known RCE vector on Windows (see the comment
 *  in src/ipc/shell.ts). Also imported by index.ts, which applies the same
 *  gate to window.open and full-window navigation attempts. */
export const ALLOWED_EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** True for URLs `shell.openExternal` may safely receive. Shared by every
 *  code path that hands a renderer-controlled URL to the OS. */
export function isExternalUrlAllowed(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Permit-list of paths `file:write` / `window:printHtmlToPdf` may target.
 *  Both IPC handlers used to take an arbitrary renderer-supplied path — any
 *  renderer compromise (one navigation, one injected element) became an
 *  arbitrary local file write. Instead, `dialog:save` is the mint: the main
 *  process records every path the user picked in this session, and a write
 *  is only honored for one of those. This is transparent to the real flows —
 *  they all call `dialog:save` immediately before writing — and costs no UI
 *  change. Paths are normalized so separators/case can't smuggle a variant. */
const saveDialogPaths = new Set<string>();
// Directories the user picked with `dialog:pickSaveDir` this session. A write
// is honored for a path that is *inside* one of these (e.g. each image in a
// "download all" batch), so a multi-file save needs only one directory picker
// instead of N save dialogs. Membership is checked with `path.relative` so a
// `..` segment in the joined name can't escape the chosen folder.
const saveDialogDirs = new Set<string>();

function normalizeWritePath(p: string): string {
  return path.normalize(p);
}

export function recordSavePath(p: string): void {
  saveDialogPaths.add(normalizeWritePath(p));
}

export function recordSaveDir(d: string): void {
  saveDialogDirs.add(normalizeWritePath(d));
}

export function isAllowedWritePath(p: string): boolean {
  const n = normalizeWritePath(p);
  if (saveDialogPaths.has(n)) return true;
  for (const dir of saveDialogDirs) {
    const rel = path.relative(dir, n);
    // A non-empty relative path that stays inside `dir` (no `..`, not absolute)
    // is a file the user implicitly authorized by picking the folder.
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

export const __writePathGuardForTests = { recordSavePath, recordSaveDir, isAllowedWritePath, saveDialogPaths, saveDialogDirs };

export function registerIpcHandlers(deps: IpcDeps) {
  ipcMain.handle("tanwords:call", async (event, channel: string, args: unknown) => {
    return dispatch(channel, args, deps, event.sender);
  });

  // Sync channel for the browser panel's cosmetic preload: the preload runs
  // at document-start in a sandboxed isolated world and cannot await, so it
  // uses sendSync. Main answers purely from the prewarmed cache — never a
  // sidecar roundtrip — and fills a miss asynchronously with a late
  // executeJavaScript injection (fail-open: an empty answer is instant).
  ipcMain.on("adblock:cosmetics", (event, url: unknown) => {
    event.returnValue = cosmeticsForWebContents(event.sender, String(url ?? ""));
  });
}
