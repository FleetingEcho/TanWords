import { create } from "zustand";
import { invoke } from "@/ipc/backend";

/** Screen-lock state for the whole app.
 *
 *  `locked` starts true whenever a password is configured, so the very first
 *  paint after launch is the lock screen rather than a flash of content. It is
 *  a UI gate, not encryption — see core/src/app_lock.rs. */
interface AppLockState {
  /** Null until the first status check resolves; the shell renders nothing
   *  rather than guessing, which is what avoids the flash. */
  enabled: boolean | null;
  locked: boolean;
  refresh: () => Promise<void>;
  lock: () => void;
  /** Checks the password without dismissing the screen — the lock screen plays
   *  its exit animation first and calls `setLocked(false)` when that ends. */
  verify: (password: string) => Promise<boolean>;
  setLocked: (locked: boolean) => void;
}

export const useAppLockStore = create<AppLockState>((set, get) => ({
  enabled: null,
  locked: false,

  refresh: async () => {
    try {
      const status = await invoke<{ enabled: boolean }>("app_lock_status");
      set({
        enabled: status.enabled,
        // Only ever *raises* the gate here: a refresh triggered by changing
        // the password in settings must not throw the user out.
        locked: status.enabled ? get().locked || get().enabled === null : false,
      });
    } catch {
      // A backend that cannot answer must not lock the user out of their own
      // notes — the lock is a convenience, not a security boundary.
      set({ enabled: false, locked: false });
    }
  },

  lock: () => {
    if (get().enabled) set({ locked: true });
  },

  verify: (password) => invoke<boolean>("app_lock_verify", { password }),

  setLocked: (locked) => set({ locked }),
}));

export function setAppLockPassword(current: string | null, next: string): Promise<void> {
  return invoke("app_lock_set", { current, next });
}

export function disableAppLock(current: string): Promise<void> {
  return invoke("app_lock_disable", { current });
}
