/** App updates, backed by `electron-updater` in the main process.
 *
 *  Existing Tauri-era 1.0.0 installs will NOT reach this code: they still check
 *  the old minisign latest.json. See migration plan §10.2. */

import { callMain } from "./host";
import { subscribe } from "./events";

export type UpdateInfo = {
  version: string;
  /** ISO release date, when the feed provides one. */
  date?: string;
  /** Release notes, when the feed provides them as plain text/HTML. */
  notes?: string;
};

export type DownloadProgress = {
  /** 0..100. electron-updater reports this directly; no accumulation needed. */
  percent: number;
  transferred: number;
  total: number;
};

/** Resolves to `null` when the app is up to date, or when no update feed is
 *  configured (dev builds) — main treats both the same way on purpose. */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  return callMain<UpdateInfo | null>("updater:check");
}

/** Downloads the pending update and restarts into it. Main holds the update
 *  state, so there is no handle for the caller to keep between calls. */
export async function downloadAndInstall(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  const off = onProgress ? subscribe<DownloadProgress>("updater:progress", onProgress) : () => {};
  try {
    await callMain("updater:downloadAndInstall");
  } finally {
    off();
  }
}
