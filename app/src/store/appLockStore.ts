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
    if (get().enabled) set({ locked: true });
  },

  verify: (password) => isDesktopHost
    ? invoke<boolean>("app_lock_verify", { password })
    : webAppLock<boolean>("verify", "POST", { password }),

  setLocked: (locked) => set({ locked }),
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
