/** Wires `src/bridge/updater.ts`'s `updater:check` / `updater:downloadAndInstall`
 *  IPC contract to `electron-updater`. Full update-server configuration is out
 *  of scope for this task (migration plan §10.2 — existing 1.0.0 installs
 *  can't auto-migrate anyway) — this just makes the IPC contract correct and
 *  non-crashing: checking with no feed configured resolves to "no update
 *  available" rather than throwing. */
import { autoUpdater } from "electron-updater";

export type UpdateInfoPayload = {
  version: string;
  date?: string;
  notes?: string;
};

export function initUpdater(emitEvent: (name: string, payload: unknown) => void) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  let sentStarted = false;

  autoUpdater.on("download-progress", (progress) => {
    if (!sentStarted) {
      sentStarted = true;
      emitEvent("updater:progress", { event: "Started", data: { contentLength: progress.total } });
    }
    emitEvent("updater:progress", { event: "Progress", data: { chunkLength: progress.delta } });
  });

  autoUpdater.on("update-downloaded", () => {
    emitEvent("updater:progress", { event: "Finished", data: {} });
  });

  return {
    async check(): Promise<UpdateInfoPayload | null> {
      sentStarted = false;
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
