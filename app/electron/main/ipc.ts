/** Main-side handlers for every channel `src/ipc/*.ts` calls via
 *  `window.tanwords.call(...)`. `browser_*` routes to `BrowserPanelManager` —
 *  a native WebContentsView-based panel (see browserPanel.ts). `http:*` is the
 *  streaming case and lives in its own module (see http.ts). */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from "electron";
import type { UpdateInfoPayload } from "./updater";
import type { BrowserPanelManager, PanelBounds } from "./browserPanel";
import type { TrayManager } from "./tray";
import { abortFetch, startFetch } from "./http";

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
 *  in src/ipc/shell.ts). */
const ALLOWED_EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

type DialogFilter = { name: string; extensions: string[] };

export function registerIpcHandlers(deps: IpcDeps) {
  ipcMain.handle("tanwords:call", async (event, channel: string, args: unknown) => {
    return dispatch(channel, args, deps, event.sender);
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
      return result.filePath;
    }

    case "shell:open": {
      const { url } = (args ?? {}) as { url: string };
      const parsed = new URL(url);
      if (!ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)) {
        throw new Error(`refusing to open URL with scheme ${parsed.protocol}`);
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

    case "process:relaunch": {
      app.relaunch();
      app.exit();
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

    default: {
      throw new Error(`tanwords: unknown IPC channel "${channel}"`);
    }
  }
}
