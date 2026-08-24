import { useLayoutEffect } from "react";
import { markStartupReady } from "@/lib/startupReady";

/** Mounted only inside a fully committed startup destination. The splash
 *  reads both the durable dataset flag and this event, so it cannot miss
 *  readiness if this layout effect runs before its passive listener is
 *  attached. Keeping the signal inside Suspense means a lazy route's loading
 *  spinner is never mistaken for the real first screen.
 *
 *  Shared between the application shell (auth/lock branches) and the page
 *  host (the committed destination), so both fire the same readiness event
 *  from one component instead of duplicating the layout effect. */
export function StartupReadySignal() {
  useLayoutEffect(() => {
    markStartupReady();
  }, []);
  return null;
}
