import { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { isDesktopHost } from "@/platform";
import { backendOrigin } from "@/ipc/backend";
import { isStartupReady, STARTUP_READY_EVENT } from "@/lib/startupReady";
import { SpecimenBackdrop, WordmarkEntry } from "./authVisuals";

/** The floor on how long the wordmark stays up. Long enough to read the gloss,
 *  short enough that it never feels like waiting — and a floor rather than a
 *  duration because the splash also has to outlast the backend. */
const HOLD_MS = 500;

/** Cap on waiting for the sidecar. Past this the splash leaves regardless: a
 *  backend that never came up should surface as the app's own error state, not
 *  as a wordmark that never goes away. */
const BACKEND_WAIT_CAP_MS = 15_000;

/** The third door, after the web sign-in gate and the desktop lock screen —
 *  same dictionary-entry language (see authVisuals), so a cold launch opens
 *  onto something recognisably this product rather than an empty canvas.
 *
 *  It is also what makes the window showable early. The shell used to stay
 *  hidden until the sidecar answered, so a slow backend was simply dead air;
 *  now the window opens on Chromium's first paint and this covers the gap.
 *  That means the splash leaves on two conditions, not one: the wordmark has
 *  been up long enough to read, *and* the backend can answer a query. Whichever
 *  is later decides — so a fast launch is a beat, and a slow one is a launch
 *  screen instead of a frozen, half-empty app.
 *
 *  Rendered above App, not instead of it: everything underneath mounts and does
 *  its startup work while this covers it. It mounts once per process — the
 *  React root is created once — and unmounts itself for good when the exit
 *  animation ends, so nothing here stays resident for the session. */
export function SplashScreen() {
  const t = useT();
  const [held, setHeld] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [done, setDone] = useState(false);

  const leaving = held && backendReady && shellReady;

  // Never gate the splash's *content* on a one-shot window event. The previous
  // implementation first rendered this full-screen background empty, then
  // waited for `window-shown`; ready-to-show could broadcast before React's
  // effect subscribed, producing exactly 16 seconds of apparent black screen
  // until the fallback ran. The first React frame now always has a wordmark.
  useEffect(() => {
    const timer = window.setTimeout(() => setHeld(true), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // The backend handshake alone is not enough: the lock probe and the first
  // lazy route may still be resolving underneath. Wait for App to confirm that
  // the actual destination (lock screen, login, or page) has committed before
  // fading this cover. The dataset closes the layout-effect/passive-effect race
  // where the signal can be emitted before this listener attaches.
  useEffect(() => {
    const settle = () => setShellReady(true);
    if (isStartupReady()) {
      settle();
      return;
    }
    window.addEventListener(STARTUP_READY_EVENT, settle, { once: true });
    return () => window.removeEventListener(STARTUP_READY_EVENT, settle);
  }, []);

  // Asked for, not listened for: with a local database the handshake lands in
  // under 20ms, long before this component could subscribe to an event about
  // it. `backendOrigin` resolves off the same preload invoke the rest of the
  // app uses, so a handshake that already happened resolves immediately.
  useEffect(() => {
    const startedAt = performance.now();
    if (!isDesktopHost) {
      // No sidecar to wait for, and asking would block until sign-in.
      setBackendReady(true);
      return;
    }
    let cancelled = false;
    const settle = () => {
      if (cancelled) return;
      console.log(`[startup] renderer-backend-ready +${Math.round(performance.now() - startedAt)}ms`);
      setBackendReady(true);
    };
    void backendOrigin().then(settle, settle);
    const cap = window.setTimeout(settle, BACKEND_WAIT_CAP_MS);
    return () => { cancelled = true; window.clearTimeout(cap); };
  }, []);

  if (done) return null;

  return (
    <div
      aria-hidden="true"
      // Animations inside bubble up here too — the wordmark's entrance, the
      // rule's sweep — and any of them could land while `leaving` is true.
      // Only this element's own fade-out means the splash is finished.
      onAnimationEnd={(event) => {
        if (!leaving || event.target !== event.currentTarget) return;
        console.log(`[startup] splash-dismissed +${Math.round(performance.now())}ms`);
        setDone(true);
      }}
	      className={`${isDesktopHost ? "app-drag-region " : ""}fixed inset-0 z-300 overflow-hidden bg-background ${
	        leaving
              // tw-animate-css defaults exit animations to fill-mode:none.
              // Without forwards, the fully transparent cover snaps back to
              // opacity:1 for one frame before React processes setDone(true),
              // producing the loading-screen flash after LockScreen is visible.
              ? "animate-out fade-out duration-[450ms] ease-out [animation-fill-mode:forwards]"
              : "animate-in fade-in duration-200"
      }`}
    >
      <SpecimenBackdrop />

      <div className="relative mx-auto flex h-full w-full max-w-5xl items-center px-6 sm:px-10">
        <div
          className={`animate-in fade-in slide-in-from-bottom-3 duration-700 motion-reduce:animate-none ${
	            leaving
                ? "animate-out fade-out slide-out-to-bottom-2 duration-[350ms] ease-out [animation-fill-mode:forwards]"
                : ""
          }`}
        >
          <WordmarkEntry gloss={t("auth.gloss")} />

          {/* The one thing that moves: the same primary rule that sweeps
            * under a focused field, drawn across the hold. It gives the
            * wait a shape — the screen is filling, not stalled.
            *
            * Once drawn, it breathes rather than stopping dead, because on
            * a slow backend there is more waiting to do and a frozen rule
            * would read as a hang. Both are declared up front, the pulse
            * simply delayed until the sweep is done — adding it later would
            * restart the sweep along with it, collapsing the drawn rule. */}
          <span
            className="mt-8 block h-px w-full max-w-md origin-left bg-primary/60 motion-reduce:hidden"
            style={{
              animation:
                `tanwords-splash-rule ${HOLD_MS}ms cubic-bezier(.22,.61,.36,1) forwards,` +
                ` tanwords-splash-rule-wait 1.6s ${HOLD_MS}ms ease-in-out infinite`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
