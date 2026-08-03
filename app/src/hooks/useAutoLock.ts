import { useEffect, useRef } from "react";
import { useAppLockStore } from "@/store/appLockStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { subscribe } from "@/ipc/events";
import { isDesktopHost } from "@/platform";

/** Input that counts as "still here". Pointer movement is included on purpose:
 *  reading a long article is real use, and it is usually all the movement a
 *  reader produces. Captured at the window so a handler that stops propagation
 *  further down cannot make the app look idle. */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"] as const;

/** How often the idle check runs. The intervals on offer are 10 minutes and
 *  up, so a coarse tick is plenty — and comparing timestamps rather than
 *  counting down means a machine that slept through the interval is correctly
 *  found idle on wake, which a `setTimeout` would not be. */
const TICK_MS = 20_000;

/** Locks the app after a stretch of no input, if the user asked for that in
 *  Settings → App lock.
 *
 *  Mounted once by App. Does nothing unless a lock password is actually set:
 *  the interval is a preference, but the password is what makes locking mean
 *  anything, and locking without one would just be a dead end. */
export function useAutoLock() {
  const minutes = useSettingsStore((s) => s.autoLockMinutes);
  const enabled = useAppLockStore((s) => s.enabled);
  const locked = useAppLockStore((s) => s.locked);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!enabled || locked || minutes <= 0) return;

    lastActivity.current = Date.now();
    const mark = () => { lastActivity.current = Date.now(); };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, mark, { capture: true, passive: true });
    }
    // Input inside the browser panel's native view, relayed by main — see
    // browserPanel.ts. Throttled there to one every 30s.
    const offInput = isDesktopHost ? subscribe("user-input", mark) : () => {};

    const timer = window.setInterval(() => {
      // Playback is use, even hands-off — and locking would tear down the
      // player along with the rest of the shell, cutting the audio mid-word.
      if (usePodcastPlayerStore.getState().status === "playing") {
        mark();
        return;
      }
      if (Date.now() - lastActivity.current < minutes * 60_000) return;
      useAppLockStore.getState().lock();
    }, TICK_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, mark, { capture: true });
      }
      offInput();
      window.clearInterval(timer);
    };
  }, [enabled, locked, minutes]);
}
