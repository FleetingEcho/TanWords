/** `tanwords:call` channel dispatch — moved verbatim from ipc.ts so that file
 *  stays under 600 lines. The switch body is byte-identical to the original. */
import { app, BrowserWindow, clipboard, dialog, shell, type WebContents } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PanelBounds } from "./browserPanel";
import type { DshBounds } from "./dshPanel";
import {
  createFloatingBrowserWindow, dockFloatingBrowserWindow,
  hideFloatingBrowserWindow, showFloatingBrowserWindow,
} from "./floatingBrowserWindow";
import { abortFetch, startFetch } from "./http";
import { rememberWindowBackground } from "./windowBackground";
import { requestWindowHide, showWindow } from "./windowVisibility";
import {
  terminalClose,
  terminalDefaultShell,
  terminalResize,
  terminalSetOutputBackpressure,
  terminalSpawn,
  terminalWrite,
} from "./terminal";
import { isExternalUrlAllowed, recordSavePath, recordSaveDir, isAllowedWritePath, type IpcDeps } from "./ipc";

type DialogFilter = { name: string; extensions: string[] };

/** Reads the clipboard's image as PNG bytes, or null when it has none.
 *
 *  Electron 44 replaced `clipboard.readImage()` (NativeImage) with the
 *  W3C-shaped async model: `read()` yields `ClipboardItem`s whose payloads
 *  arrive as Blobs. PNG is what every consumer here wants — the renderer
 *  embeds it as a data URL and the terminal paste writes a .png file — so
 *  the first image-flavoured item is taken as-is. */
async function clipboardImagePng(): Promise<Buffer | null> {
  let items: Electron.ClipboardItem[];
  try {
    items = await clipboard.read();
  } catch {
    return null;
  }
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (!type) continue;
    try {
      const payload = await item.getType(type);
      if (!(payload instanceof Blob)) continue;
      return Buffer.from(await payload.arrayBuffer());
    } catch {
      continue;
    }
  }
  return null;
}

export async function dispatch(
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
      const { cols, rows, pixelWidth, pixelHeight, shellPath } = (args ?? {}) as {
        cols?: number;
        rows?: number;
        pixelWidth?: number;
        pixelHeight?: number;
        shellPath?: string;
      };
      return terminalSpawn({ cols, rows, pixelWidth, pixelHeight, shellPath });
    }
    case "pty_write": {
      const { id, data } = (args ?? {}) as { id: string; data?: string };
      if (id && typeof data === "string") terminalWrite(id, data);
      return null;
    }
    case "pty_resize": {
      const { id, cols, rows, pixelWidth, pixelHeight } = (args ?? {}) as {
        id: string;
        cols?: number;
        rows?: number;
        pixelWidth?: number;
        pixelHeight?: number;
      };
      if (id) terminalResize(id, cols ?? 0, rows ?? 0, pixelWidth ?? 0, pixelHeight ?? 0);
      return null;
    }
    case "pty_close": {
      const { id } = (args ?? {}) as { id: string };
      if (id) terminalClose(id);
      return null;
    }
    case "pty_set_output_backpressure": {
      const { id, paused } = (args ?? {}) as { id: string; paused?: boolean };
      if (id) terminalSetOutputBackpressure(id, paused === true);
      return null;
    }

    case "window:hide": {
      const win = deps.getMainWindow();
      if (win) requestWindowHide(win);
      return null;
    }
    case "window:show": {
      const win = deps.getMainWindow();
      if (win) showWindow(win);
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
        // Do not re-parse the URL here: `isExternalUrlAllowed` also rejects
        // strings that fail `new URL()` outright, and this template would
        // then throw its own unrelated TypeError instead of the intended
        // policy message reaching the renderer.
        throw new Error(`refusing to open URL: ${url}`);
      }
      await shell.openExternal(url);
      return null;
    }

    case "clipboard:readImage": {
      const png = await clipboardImagePng();
      if (!png || png.length === 0) return null;
      return `data:image/png;base64,${png.toString("base64")}`;
    }
    case "clipboard:writeText": {
      const { text } = (args ?? {}) as { text: string };
      await clipboard.writeText(text ?? "");
      return null;
    }
    case "clipboard:readText": {
      return clipboard.readText();
    }
    case "clipboard:readForTerminal": {
      // A shell cannot consume image pixels directly. Materialize clipboard
      // images as temporary PNGs and let the renderer paste the resulting path,
      // matching what desktop terminals do for dragged/pasted files.
      const png = await clipboardImagePng();
      if (png && png.length > 0) {
        const directory = path.join(app.getPath("temp"), "tanwords-terminal-paste");
        await mkdir(directory, { recursive: true });
        const imagePath = path.join(directory, `clipboard-${Date.now()}-${randomUUID()}.png`);
        await writeFile(imagePath, png);
        return { kind: "image", path: imagePath };
      }
      const text = await clipboard.readText();
      return text ? { kind: "text", text } : null;
    }

    case "process:relaunch": {
      // quit(), not exit(): exit() skips before-quit, so the old sidecar would
      // still be draining its final write while the relaunched instance
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

    // Floating mobile-browser overlay — same shape as the browser_* cases
    // above, dispatched to its own independent manager/session.
    case "floating_browser_show": {
      const { tabId, url, ...bounds } = (args ?? {}) as { tabId: string | null; url: string | null } & PanelBounds;
      return deps.floatingBrowserPanel.show(tabId, bounds, url);
    }
    case "floating_browser_set_bounds": {
      deps.floatingBrowserPanel.setBounds((args ?? {}) as PanelBounds);
      return null;
    }
    case "floating_browser_hide": {
      const { withSnapshot } = (args ?? {}) as { withSnapshot?: boolean };
      return deps.floatingBrowserPanel.hide(withSnapshot === true);
    }
    case "floating_browser_get_state": {
      return deps.floatingBrowserPanel.getState();
    }
    case "floating_browser_go_home": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.floatingBrowserPanel.goHome(tabId);
      return null;
    }
    case "floating_browser_close_tab": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.floatingBrowserPanel.closeTab(tabId);
      return null;
    }
    case "floating_browser_reload": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.floatingBrowserPanel.reload(tabId);
      return null;
    }
    case "floating_browser_go_back": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.floatingBrowserPanel.goBack(tabId);
      return null;
    }
    case "floating_browser_go_forward": {
      const { tabId } = (args ?? {}) as { tabId: string };
      deps.floatingBrowserPanel.goForward(tabId);
      return null;
    }
    case "floating_browser_clear_data": {
      await deps.floatingBrowserPanel.clearData();
      return null;
    }

    // Detach-into-an-independent-window support — see floatingBrowserWindow.ts.
    // Resolved from the calling window, not always the main one: the docked
    // widget's renderer IS the main window (so this doubles as "get the main
    // window's bounds" for its detach-threshold check), and the popout's own
    // renderer gets its own window's bounds for its resize handles.
    case "window_get_bounds": {
      const win = BrowserWindow.fromWebContents(sender);
      return win ? win.getBounds() : null;
    }
    case "floating_browser_window_set_bounds": {
      const win = BrowserWindow.fromWebContents(sender);
      const bounds = (args ?? {}) as { x: number; y: number; width: number; height: number };
      win?.setBounds({
        x: Math.round(bounds.x), y: Math.round(bounds.y),
        width: Math.round(bounds.width), height: Math.round(bounds.height),
      });
      return null;
    }
    case "floating_browser_detach": {
      const bounds = (args ?? {}) as { x: number; y: number; width: number; height: number };
      createFloatingBrowserWindow({
        floatingBrowserPanel: deps.floatingBrowserPanel,
        bounds,
        broadcastEvent: deps.broadcastEvent,
        getMainWindow: deps.getMainWindow,
      });
      return null;
    }
    case "floating_browser_dock": {
      const win = deps.getMainWindow();
      if (win) {
        dockFloatingBrowserWindow({
          mainWindow: win,
          floatingBrowserPanel: deps.floatingBrowserPanel,
          broadcastEvent: deps.broadcastEvent,
        });
      }
      return null;
    }
    case "floating_browser_window_hide": {
      hideFloatingBrowserWindow(deps.broadcastEvent);
      return null;
    }
    case "floating_browser_window_show": {
      showFloatingBrowserWindow(deps.broadcastEvent);
      return null;
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
    // History is shared session-wide (see PanelSessionState in
    // browserPanel.ts) — the floating overlay calls these same two commands
    // rather than getting its own floating_browser_* mirror, since the data
    // is identical either way.
    case "browser_get_history": {
      return deps.browserPanel.getHistory();
    }
    case "browser_clear_history": {
      deps.browserPanel.clearHistory();
      return null;
    }
    case "browser_set_adblock_enabled": {
      const { enabled } = (args ?? {}) as { enabled?: boolean };
      deps.browserPanel.setAdBlockEnabled(enabled !== false);
      return null;
    }

    // Whole-browser private-mode toggle, shared by the full-page Browser and
    // the floating overlay — see PRIVATE_PARTITION's doc in browserPanel.ts.
    // Both managers' privateMode flags are set together and both are
    // notified so either surface's UI reflects the current state regardless
    // of which one triggered the change.
    case "browser_set_private_mode": {
      const { enabled } = (args ?? {}) as { enabled?: boolean };
      const on = enabled === true;
      deps.browserPanel.setPrivateMode(on);
      deps.floatingBrowserPanel.setPrivateMode(on);
      deps.broadcastEvent("browser:privateModeChanged", { enabled: on });
      return null;
    }

    // ── DeepSeek Harness page ────────────────────────────────────────────────
    // The DSH Web host is spawned lazily on first show; `dsh_show` resolves
    // with the ready URL (and starts the supervisor if it hasn't been started
    // yet), then attaches the native WebContentsView at the measured bounds.
    // `dsh_hide` detaches the view without destroying it, so a revisit is
    // instant. `dsh_status` lets the renderer render the "starting / failed"
    // state before the host is ready. `port` (optional, 0 = standard 3080) pins the
    // host on a fixed loopback port; `dsh_restart` stops and respawns to apply
    // a port change to a live host (the renderer's "Restart" button).
    case "dsh_show": {
      const { port, backgroundOpacity, ...bounds } = (args ?? {}) as {
        port?: number;
        backgroundOpacity?: number;
      } & DshBounds;
      deps.dshPanel.setBackgroundOpacity(Number(backgroundOpacity ?? 100));
      let url: string;
      try {
        url = await deps.dshSupervisor.start(port);
      } catch (error) {
        // The host couldn't start (e.g. `dsh` not installed, port in use). A
        // *previous* successful run may have left a native view attached over
        // the DOM, which would hide the renderer's failure/guidance UI.
        // Detach it so the failure overlay is visible — never leave a stale
        // view up when there is no live host behind it.
        deps.dshPanel.hide();
        deps.dshSupervisor.noteVisibility(false);
        throw error;
      }
      await deps.dshPanel.show(url, bounds);
      deps.dshSupervisor.noteVisibility(true);
      return url;
    }
    case "dsh_hide": {
      deps.dshPanel.hide();
      deps.dshSupervisor.noteVisibility(false);
      return null;
    }
    case "dsh_set_bounds": {
      deps.dshPanel.setBounds((args ?? {}) as DshBounds);
      return null;
    }
    case "dsh_set_background_opacity": {
      const { opacity } = (args ?? {}) as { opacity?: number };
      deps.dshPanel.setBackgroundOpacity(Number(opacity ?? 100));
      return null;
    }
    case "dsh_reload": {
      const { url } = (args ?? {}) as { url?: string };
      deps.dshPanel.reload(url);
      return null;
    }
    case "dsh_restart": {
      const { port } = (args ?? {}) as { port?: number };
      try {
        return await deps.dshSupervisor.restart(port);
      } catch (error) {
        // Same reason as dsh_show: detach any stale view so the failure UI is
        // not buried under a dead native view.
        deps.dshPanel.hide();
        throw error;
      }
    }
    case "dsh_get_url": {
      return deps.dshSupervisor.currentUrl();
    }
    case "dsh_get_port": {
      return deps.dshSupervisor.currentPort();
    }
    case "dsh_set_idle_stop_minutes": {
      const { minutes } = (args ?? {}) as { minutes?: number };
      deps.dshSupervisor.setIdleStopMinutes(Number(minutes ?? 0));
      return null;
    }
    case "dsh_set_global_shortcut": {
      const { accelerator } = (args ?? {}) as { accelerator?: string };
      return deps.setDshShortcut(String(accelerator ?? ""));
    }

    default: {
      throw new Error(`tanwords: unknown IPC channel "${channel}"`);
    }
  }
}
