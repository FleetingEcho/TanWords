import { create } from "zustand";
import { checkForUpdate, downloadAndInstall } from "@/ipc/updater";
import { relaunch } from "@/ipc/app";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "error";

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
      const update = await checkForUpdate();
      if (update) {
        set({ status: "available", version: update.version, notes: update.notes ?? null });
      } else {
        set({ status: "upToDate" });
      }
    } catch (e) {
      if (silent) {
        set({ status: "idle" });
      } else {
        set({ status: "error", error: String(e) });
      }
    }
  },

  downloadAndInstall: async () => {
    if (get().status !== "available") return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      // Main owns the pending update between check and download, so there is
      // no handle to carry across the two calls.
      await downloadAndInstall(({ percent }) => {
        set({ progress: Math.min(100, Math.round(percent)) });
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
