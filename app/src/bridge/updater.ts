/** Replaces `@tauri-apps/plugin-updater`, backed by electron-updater.
 *
 *  `store/updaterStore.ts` keeps the returned handle outside React state and
 *  calls `update.downloadAndInstall(cb)` later, where cb receives Tauri's
 *  progress events. Reproduce that shape exactly — see the store's own comment
 *  at line 14 about why the handle is held rather than serialized.
 *
 *  Existing 1.0.0 installs will NOT reach this code: they still check the Tauri
 *  minisign latest.json. See migration plan §10.2. */
import { listen } from "./event";

export type Update = {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void>;
};

export type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export async function check(): Promise<Update | null> {
  const info = await window.tanwords?.call("updater:check");
  if (!info) return null;
  return {
    version: info.version,
    date: info.date,
    body: info.notes,
    downloadAndInstall: async (onEvent) => {
      const unlisten = onEvent
        ? await listen<DownloadEvent>("updater:progress", (e) => onEvent(e.payload))
        : () => {};
      try {
        await window.tanwords?.call("updater:downloadAndInstall");
      } finally {
        unlisten();
      }
    },
  };
}
