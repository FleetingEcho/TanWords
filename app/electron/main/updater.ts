/** Serves the `updater:check` / `updater:downloadAndInstall` IPC channels that
 *  `src/ipc/updater.ts` calls, on top of `electron-updater`. Full update-server
 *  configuration is out of scope (migration plan §10.2 — existing 1.0.0
 *  installs can't auto-migrate anyway); this just makes the IPC contract
 *  correct and non-crashing: checking with no feed configured resolves to "no
 *  update available" rather than throwing. */
import { autoUpdater } from "electron-updater";

export type UpdateInfoPayload = {
  version: string;
  date?: string;
  notes?: string;
};

export function initUpdater(emitEvent: (name: string, payload: unknown) => void) {
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
      autoUpdater.quitAndInstall();
    },
  };
}
