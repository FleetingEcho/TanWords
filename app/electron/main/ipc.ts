/** Main-side handlers for every channel `src/ipc/*.ts` calls via
 *  `window.tanwords.call(...)`. `browser_*` routes to `BrowserPanelManager` —
 *  a native WebContentsView-based panel (see browserPanel.ts). `http:*` is the
 *  streaming case and lives in its own module (see http.ts). */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { UpdateInfoPayload } from "./updater";
import type { BrowserPanelManager, PanelBounds } from "./browserPanel";
import type { TrayManager } from "./tray";
import { abortFetch, startFetch } from "./http";
import { rememberWindowBackground } from "./windowBackground";
import {
  terminalClose,
  terminalDefaultShell,
  terminalResize,
  terminalSpawn,
  terminalWrite,
} from "./terminal";

export type IpcDeps = {
  getMainWindow: () => BrowserWindow | null;
  broadcastEvent: (name: string, payload: unknown) => void;
  updater: {
    check: () => Promise<UpdateInfoPayload | null>;
    downloadAndInstall: () => Promise<void>;
  };
  browserPanel: BrowserPanelManager;
  tray: TrayManager;
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

function recordSavePath(p: string): void {
  saveDialogPaths.add(normalizeWritePath(p));
}

function recordSaveDir(d: string): void {
  saveDialogDirs.add(normalizeWritePath(d));
}

function isAllowedWritePath(p: string): boolean {
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

type DialogFilter = { name: string; extensions: string[] };

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
    const c = deps.browserPanel.cosmeticsForSync(String(url ?? ""), event.sender);
    event.returnValue = c;
  });
}

async function dispatch(
  channel: string,
  args: unknown,
  deps: IpcDeps,
  sender: WebContents,
): Promise<unknown> {
  switch (channel) {
    // Streaming HTTP for the AI providers — resolves as soon as the request is
    // started; the response arrives on the per-id event channels. See http.ts.
    case "http:fetch": {
      startFetch(sender, args as Parameters<typeof startFetch>[1]);
      return null;
    }
    case "http:abort": {
      const { id } = (args ?? {}) as { id: number };
      abortFetch(sender, id);
      return null;
    }

    // PTY terminal sessions (desktop Terminal tool). Spawn resolves with the
    // {"id","shell","cwd","pid"} handshake once the shell is ready; output
    // and exit arrive on the "pty:data" / "pty:exit" broadcast events.
    case "pty_default_shell":
      return terminalDefaultShell();
    case "pty_spawn": {
      const { cols, rows, shellPath } = (args ?? {}) as {
        cols?: number;
        rows?: number;
        shellPath?: string;
      };
      return terminalSpawn({ cols, rows, shellPath });
    }
    case "pty_write": {
      const { id, data } = (args ?? {}) as { id: string; data?: string };
      if (id && typeof data === "string") terminalWrite(id, data);
      return null;
    }
    case "pty_resize": {
      const { id, cols, rows } = (args ?? {}) as { id: string; cols?: number; rows?: number };
      if (id) terminalResize(id, cols ?? 0, rows ?? 0);
      return null;
    }
    case "pty_close": {
      const { id } = (args ?? {}) as { id: string };
      if (id) terminalClose(id);
      return null;
    }

    case "window:hide": {
      deps.getMainWindow()?.hide();
      return null;
    }
    case "window:show": {
      const win = deps.getMainWindow();
      win?.show();
      win?.focus();
      return null;
    }
    case "window:minimize": {
      deps.getMainWindow()?.minimize();
      return null;
    }
    case "window:toggleMaximize": {
      const win = deps.getMainWindow();
      if (!win) return false;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return win.isMaximized();
    }
    case "window:toggleFullScreen": {
      const win = deps.getMainWindow();
      if (!win) return false;
      win.setFullScreen(!win.isFullScreen());
      return win.isFullScreen();
    }
    case "window:close": {
      deps.getMainWindow()?.close();
      return null;
    }
    case "window:state": {
      const win = deps.getMainWindow();
      return win
        ? { maximized: win.isMaximized(), fullScreen: win.isFullScreen() }
        : { maximized: false, fullScreen: false };
    }
    /** The renderer reporting its resolved theme background, so the next
     *  launch can create the window in that colour instead of white. */
    case "window:background": {
      const { color } = (args ?? {}) as { color?: unknown };
      rememberWindowBackground(color);
      return null;
    }

    case "event:emit": {
      const { name, payload } = (args ?? {}) as { name: string; payload?: unknown };
      deps.broadcastEvent(name, payload);
      return null;
    }

    case "dialog:open": {
      const opts = (args ?? {}) as {
        multiple?: boolean;
        directory?: boolean;
        defaultPath?: string;
        filters?: DialogFilter[];
      };
      const properties: Electron.OpenDialogOptions["properties"] = [];
      if (opts.directory) {
        properties.push("openDirectory");
      } else {
        properties.push("openFile");
      }
      if (opts.multiple) properties.push("multiSelections");

      const win = deps.getMainWindow();
      const result = win
        ? await dialog.showOpenDialog(win, {
            properties,
            defaultPath: opts.defaultPath,
            filters: opts.filters,
          })
        : await dialog.showOpenDialog({
            properties,
            defaultPath: opts.defaultPath,
            filters: opts.filters,
          });
      if (result.canceled || result.filePaths.length === 0) return null;
      return opts.multiple ? result.filePaths : result.filePaths[0];
    }

    case "dialog:save": {
      const opts = (args ?? {}) as { defaultPath?: string; filters?: DialogFilter[] };
      const win = deps.getMainWindow();
      const result = win
        ? await dialog.showSaveDialog(win, { defaultPath: opts.defaultPath, filters: opts.filters })
        : await dialog.showSaveDialog({ defaultPath: opts.defaultPath, filters: opts.filters });
      if (result.canceled || !result.filePath) return null;
      // The user just picked this path in a real OS dialog — it is the only
      // kind of path `file:write` / `printHtmlToPdf` will accept afterwards.
      recordSavePath(result.filePath);
      return result.filePath;
    }

    // A directory picker for multi-file saves (e.g. "download all" in the
    // image reducer). Records the folder so `file:writeBinary` accepts any
    // path inside it; `isAllowedWritePath` checks the path stays within bounds.
    case "dialog:pickSaveDir": {
      const win = deps.getMainWindow();
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (result.canceled || result.filePaths.length === 0) return null;
      recordSaveDir(result.filePaths[0]);
      return result.filePaths[0];
    }

    case "file:write": {
      const { path: filePath, data } = (args ?? {}) as { path?: string; data?: string };
      if (!filePath || typeof data !== "string") throw new Error("file:write requires path and data");
      if (!isAllowedWritePath(filePath)) {
        throw new Error("file:write only writes to paths the user picked in a save dialog this session");
      }
      await writeFile(filePath, data, "utf8");
      return null;
    }

    // Binary counterpart to `file:write` for in-memory image bytes (the image
    // reducer's reduced blobs). Same path allowlist — only a path the user just
    // picked, or a file inside a folder the user just picked, is written.
    case "file:writeBinary": {
      const { path: filePath, data } = (args ?? {}) as { path?: string; data?: Uint8Array | ArrayBuffer };
      if (!filePath || !data) throw new Error("file:writeBinary requires path and data");
      if (!isAllowedWritePath(filePath)) {
        throw new Error("file:writeBinary only writes to paths the user picked in a save dialog this session");
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
      await writeFile(filePath, buf);
      return null;
    }

    case "window:printHtmlToPdf": {
      const { path: pdfPath, html } = (args ?? {}) as { path?: string; html?: string };
      if (!pdfPath || typeof html !== "string") throw new Error("printHtmlToPdf requires path and html");
      if (!isAllowedWritePath(pdfPath)) {
        throw new Error("printHtmlToPdf only writes to paths the user picked in a save dialog this session");
      }
      const win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 1600,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        await win.webContents.executeJavaScript(
          `document.fonts?.ready ?? Promise.resolve()`,
        );
        const pdf = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
        });
        await writeFile(pdfPath, pdf);
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
      return null;
    }

    case "shell:open": {
      const { url } = (args ?? {}) as { url: string };
      if (!isExternalUrlAllowed(url)) {
        throw new Error(`refusing to open URL with scheme ${new URL(url).protocol}`);
      }
      await shell.openExternal(url);
      return null;
    }

    case "clipboard:readImage": {
      const image = clipboard.readImage();
      if (image.isEmpty()) return null;
      return image.toDataURL();
    }
    case "clipboard:writeText": {
      const { text } = (args ?? {}) as { text: string };
      clipboard.writeText(text ?? "");
      return null;
    }
    case "clipboard:readText": {
      return clipboard.readText();
    }
    case "clipboard:readForTerminal": {
      // A shell cannot consume image pixels directly. Materialize clipboard
      // images as temporary PNGs and let the renderer paste the resulting path,
      // matching what desktop terminals do for dragged/pasted files.
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const directory = path.join(app.getPath("temp"), "tanwords-terminal-paste");
        await mkdir(directory, { recursive: true });
        const imagePath = path.join(directory, `clipboard-${Date.now()}-${randomUUID()}.png`);
        await writeFile(imagePath, image.toPNG());
        return { kind: "image", path: imagePath };
      }
      const text = clipboard.readText();
      return text ? { kind: "text", text } : null;
    }

    case "process:relaunch": {
      // quit(), not exit(): exit() skips before-quit, so the old sidecar would
      // still be draining its final Turso sync while the relaunched instance
      // spawns a new one against the same SQLite data dir. Going through
      // quit() lets index.ts's before-quit run the normal graceful shutdown
      // first; Electron carries the relaunch flag across the deferred exit.
      app.relaunch();
      app.quit();
      return null;
    }
    case "process:exit": {
      const { code } = (args ?? {}) as { code?: number };
      app.exit(code ?? 0);
      return null;
    }

    case "updater:check": {
      return deps.updater.check();
    }
    case "updater:downloadAndInstall": {
      await deps.updater.downloadAndInstall();
      return null;
    }

    case "app:version": {
      return app.getVersion();
    }
    case "app:name": {
      return app.getName();
    }

    case "browser_show": {
      const { tabId, url, ...bounds } = (args ?? {}) as { tabId: string | null; url: string | null } & PanelBounds;
      return deps.browserPanel.show(tabId, bounds, url);
    }
    case "browser_set_bounds": {
      deps.browserPanel.setBounds((args ?? {}) as PanelBounds);
      return null;
    }
    case "browser_hide": {
      const { withSnapshot } = (args ?? {}) as { withSnapshot?: boolean };
      return deps.browserPanel.hide(withSnapshot === true);
    }
    case "browser_get_state": {
      return deps.browserPanel.getState();
    }
    // The tray's labels live in the main process but its language and playback
    // state are the renderer's to know, so both are pushed in rather than
    // polled (see src/hooks/useTraySync.ts).
    case "tray_set_language": {
      const { lang } = (args ?? {}) as { lang?: string };
      deps.tray.setLanguage(lang === "zh" ? "zh" : "en");
      return null;
    }
    case "tray_update_now_playing": {
      const { title, playing, hasPlaylist } = (args ?? {}) as {
        title?: string | null; playing?: boolean; hasPlaylist?: boolean;
      };
      deps.tray.setNowPlaying({
        title: title ?? null,
        playing: playing === true,
        hasPlaylist: hasPlaylist === true,
      });
      return null;
    }
    case "browser_go_home": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.browserPanel.goHome(tabId);
      return null;
    }
    case "browser_close_tab": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.browserPanel.closeTab(tabId);
      return null;
    }
    case "browser_reload": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.browserPanel.reload(tabId);
      return null;
    }
    case "browser_go_back": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.browserPanel.goBack(tabId);
      return null;
    }
    case "browser_go_forward": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.browserPanel.goForward(tabId);
      return null;
    }
    case "browser_clear_data": {
      await deps.browserPanel.clearData();
      return null;
    }
    case "browser_set_adblock_enabled": {
      const { enabled } = (args ?? {}) as { enabled?: boolean };
      deps.browserPanel.setAdBlockEnabled(enabled !== false);
      return null;
    }

    default: {
      throw new Error(`tanwords: unknown IPC channel "${channel}"`);
    }
  }
}
