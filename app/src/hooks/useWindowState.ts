import { useEffect, useState } from "react";
import { callMain } from "@/ipc/host";
import { subscribe } from "@/ipc/events";

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
}

/**
 * Desktop window state (maximized / OS-level fullscreen), kept in sync with the
 * main process. On web (`window.tanwords` absent) this is inert — it never
 * fetches and stays `{ maximized: false, fullScreen: false }` — so callers can
 * gate desktop-only behaviour on `fullScreen` without a separate host check.
 *
 * Main pushes updates via the `window:state-changed` broadcast, which the main
 * process fires on the `maximize` / `unmaximize` / `enter-full-screen` /
 * `leave-full-screen` BrowserWindow events. That broadcast is the single source
 * of truth: toggling fullscreen/maximize from the UI just calls the IPC action
 * and lets the resulting event update every subscriber.
 */
export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({
    maximized: false,
    fullScreen: false,
  });

  useEffect(() => {
    if (!window.tanwords) return;
    let alive = true;
    void callMain<WindowState>("window:state")
      .then((next) => {
        if (alive) setState(next);
      })
      .catch(() => {});
    const unsubscribe = subscribe<WindowState>("window:state-changed", (next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return state;
}
