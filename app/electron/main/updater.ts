/** Serves the `updater:check` / `updater:downloadAndInstall` IPC channels that
 *  `src/ipc/updater.ts` calls.
 *
 *  Two implementations behind one contract. Windows and Linux use
 *  `electron-updater` against the GitHub feed electron-builder publishes.
 *  macOS cannot: electron-updater delegates to native Squirrel.Mac, which
 *  rejects an update whose code signature doesn't match the running app's, and
 *  without an Apple Developer ID the app is only ad-hoc signed — an identity
 *  that changes with every build. See ./macUpdater.ts for the replacement,
 *  which is what the Tauri version did before this one.
 *
 *  Checking resolves to "no update available" rather than throwing when there
 *  is no feed (dev builds, or a release that predates it). */
import { autoUpdater } from "electron-updater";
import { createMacUpdater } from "./macUpdater";

export type UpdateInfoPayload = {
  version: string;
  date?: string;
  notes?: string;
};

export function initUpdater(
  emitEvent: (name: string, payload: unknown) => void,
  beforeInstall: () => Promise<void> = () => Promise.resolve(),
) {
  if (process.platform === "darwin") return createMacUpdater(emitEvent);
  return initElectronUpdater(emitEvent, beforeInstall);
}

function initElectronUpdater(
  emitEvent: (name: string, payload: unknown) => void,
  beforeInstall: () => Promise<void>,
) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // electron-updater already reports a cumulative percentage, so this forwards
  // it as-is rather than making the renderer accumulate deltas.
  autoUpdater.on("download-progress", ({ percent, transferred, total }) => {
    emitEvent("updater:progress", { percent, transferred, total });
  });

  autoUpdater.on("update-downloaded", () => {
    emitEvent("updater:progress", { percent: 100, transferred: 0, total: 0 });
  });

  return {
    async check(): Promise<UpdateInfoPayload | null> {
      try {
        const result = await autoUpdater.checkForUpdates();
        if (!result || !result.isUpdateAvailable) return null;
        const info = result.updateInfo;
        return {
          version: info.version,
          date: info.releaseDate,
          notes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
        };
      } catch (error) {
        // No feed configured (dev, or no update server set up yet) — treat
        // as "no update available" rather than surfacing a scary error.
        console.warn("[updater] check failed, treating as no update available:", error);
        return null;
      }
    },

    async downloadAndInstall(): Promise<void> {
      await autoUpdater.downloadUpdate();
      // quitAndInstall() spawns the NSIS/AppImage installer *before* calling
      // app.quit(), and our before-quit handler would otherwise hold the
      // process alive draining the sidecar — with the installer already
      // running, prompting (or force-killing us mid-drain). Drain first, so
      // the quit passes straight through.
      await beforeInstall();
      autoUpdater.quitAndInstall();
    },
  };
}
