import { create } from "zustand";
import { invoke } from "@/ipc/backend";
import { hostCapabilities, isDesktopHost } from "@/platform";
import { webAuthFetch } from "@/platform/webClient";

async function webAppLock<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await webAuthFetch(`/api/app-lock/${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* plain-text response */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

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
  /** True from the moment `verify()` succeeds until the lock screen's exit
   *  animation finishes and `setLocked(false)` lands. While true, the app
   *  underneath is mounted (hidden behind the still-animating lock screen)
   *  instead of only starting to mount once `locked` goes false — otherwise
   *  the destination page's whole tree (images, first layout, …) has to do
   *  its first paint in the instant the lock screen disappears, which reads
   *  as a flash. Authorization already happened at this point, so mounting
   *  the app early here is not an early content leak. */
  unlocking: boolean;
  refresh: () => Promise<void>;
  lock: () => void;
  /** Checks the password. On success, marks `unlocking` so the app underneath
   *  starts mounting while the lock screen plays its exit animation; the lock
   *  screen calls `setLocked(false)` when that animation ends. */
  verify: (password: string) => Promise<boolean>;
  setLocked: (locked: boolean) => void;
}

export const useAppLockStore = create<AppLockState>((set, get) => ({
  enabled: null,
  locked: false,
  unlocking: false,

  refresh: async () => {
    if (!hostCapabilities.appLock) {
      set({ enabled: false, locked: false });
      return;
    }
    try {
      const status = isDesktopHost
        ? await invoke<{ enabled: boolean }>("app_lock_status")
        : await webAppLock<{ enabled: boolean }>("status");
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
    if (get().enabled) set({ locked: true, unlocking: false });
  },

  verify: async (password) => {
    const ok = isDesktopHost
      ? await invoke<boolean>("app_lock_verify", { password })
      : await webAppLock<boolean>("verify", "POST", { password });
    if (ok) set({ unlocking: true });
    return ok;
  },

  setLocked: (locked) => set({ locked, unlocking: locked ? get().unlocking : false }),
}));

export function setAppLockPassword(current: string | null, next: string): Promise<void> {
  return isDesktopHost
    ? invoke("app_lock_set", { current, next })
    : webAppLock<void>("set", "POST", { current, next });
}

export function disableAppLock(current: string): Promise<void> {
  return isDesktopHost
    ? invoke("app_lock_disable", { current })
    : webAppLock<void>("disable", "POST", { password: current });
}
