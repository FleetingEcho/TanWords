/** Main-side handlers for every channel `src/bridge/*.ts` calls via
 *  `window.tanwords.call(...)`. Grepped exhaustively from `tanwords?.call("` —
 *  see docs/electron-migration-handoff.md Task 3. `browser_*`/`tray_*` are
 *  deliberately NOT implemented here: the browser panel and tray are being
 *  built directly against native Electron APIs (WebContentsView, Tray), not
 *  ported from the old Rust command contract — see Task 4. They're stubbed
 *  with a clean rejection so an accidental call fails loudly instead of
 *  crashing the renderer. */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import type { UpdateInfoPayload } from "./updater";

export type IpcDeps = {
  getMainWindow: () => BrowserWindow | null;
  broadcastEvent: (name: string, payload: unknown) => void;
  updater: {
    check: () => Promise<UpdateInfoPayload | null>;
    downloadAndInstall: () => Promise<void>;
  };
};

/** Schemes `shell:open` will actually hand to `shell.openExternal` — an
 *  unvalidated openExternal is a known RCE vector on Windows (see the comment
 *  in src/bridge/shell.ts). */
const ALLOWED_EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

type DialogFilter = { name: string; extensions: string[] };

export function registerIpcHandlers(deps: IpcDeps) {
  ipcMain.handle("tanwords:call", async (_event, channel: string, args: unknown) => {
    return dispatch(channel, args, deps);
  });
}

async function dispatch(channel: string, args: unknown, deps: IpcDeps): Promise<unknown> {
  switch (channel) {
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

    default: {
      if (/^(browser_|tray_)/.test(channel)) {
        // Owned by native-Electron browser panel / tray work (Task 4), not
        // by this Rust-command-contract port. Reject cleanly rather than
        // crash so any not-yet-wired call site fails loudly and visibly.
        throw new Error(`tanwords: "${channel}" is not implemented yet (browser panel/tray, see Task 4)`);
      }
      throw new Error(`tanwords: unknown IPC channel "${channel}"`);
    }
  }
}
