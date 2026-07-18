import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "error";

// The Update handle from check() isn't serializable UI state — it holds the
// download methods and must be the same instance across check → download.
let pendingUpdate: Update | null = null;

interface UpdaterState {
  status: UpdaterStatus;
  /** New version number when status is available/downloading/ready. */
  version: string | null;
  /** Release notes from latest.json, if any. */
  notes: string | null;
  /** Download progress 0..100, only meaningful while downloading. */
  progress: number;
  error: string | null;
  /**
   * silent: startup background check — failures stay invisible (status
   * returns to idle) instead of surfacing an error in the panel.
   */
  checkForUpdate: (opts?: { silent?: boolean }) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restart: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: 0,
  error: null,

  checkForUpdate: async ({ silent = false } = {}) => {
    const { status } = get();
    if (status === "checking" || status === "downloading" || status === "ready") return;
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        pendingUpdate = update;
        set({ status: "available", version: update.version, notes: update.body ?? null });
      } else {
        pendingUpdate = null;
        set({ status: "upToDate" });
      }
    } catch (e) {
      pendingUpdate = null;
      if (silent) {
        set({ status: "idle" });
      } else {
        set({ status: "error", error: String(e) });
      }
    }
  },

  downloadAndInstall: async () => {
    if (!pendingUpdate || get().status !== "available") return;
    set({ status: "downloading", progress: 0, error: null });
    let total = 0;
    let received = 0;
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            received += event.data.chunkLength;
            if (total > 0) {
              set({ progress: Math.min(100, Math.round((received / total) * 100)) });
            }
            break;
          case "Finished":
            set({ progress: 100 });
            break;
        }
      });
      set({ status: "ready" });
    } catch (e) {
      // Back to available so the user can retry the download.
      set({ status: "available", error: String(e), progress: 0 });
    }
  },

  restart: async () => {
    await relaunch();
  },
}));
