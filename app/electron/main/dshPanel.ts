/** A single native `WebContentsView` that displays the DSH Web UI, attached
 *  to the main window only while the DSH page is active — the same pattern the
 *  full-page Browser uses (see BrowserPanelManager), but with no tabs, no
 *  ad-block, and no history: DSH owns its own navigation and session.
 *
 *  Using a top-level `WebContentsView` (rather than an `<iframe>` in the app
 *  renderer) is deliberate: it gives the DSH SPA its own origin
 *  (`http://127.0.0.1:<port>`) so its `localStorage`, service workers, and
 *  WebSocket connections to its host all work natively, and it is immune to
 *  any `X-Frame-Options` / `frame-ancestors` the upstream UI may grow. The view
 *  lives on its own `persist:dsh` session partition so DSH state never bleeds
 *  into the Browser panel or the app shell. */
import { BrowserWindow, WebContentsView } from "electron";
import { wireDevToolsShortcut } from "./devtools";
import { toIntBounds } from "./browserPanelInjection";

export interface DshBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DSH_PARTITION = "persist:dsh";
/** Safety net for `awaitLoadFinished()` — a load that never reaches
 *  `did-stop-loading` (bad network, a wedged host) must not leave the DSH
 *  page stuck behind its own "starting" overlay forever; reveal whatever's
 *  there instead once this elapses. */
const LOAD_WAIT_TIMEOUT_MS = 8000;
/** Adjust DSH's two full-page background surfaces without fading its text,
 * controls, menus, or code blocks. DSH re-declares these variables on nested
 * theme roots, so every scope must receive the override. */
export function dshBackgroundCss(opacity: number): string {
  const percent = Math.min(100, Math.max(0, Math.round(opacity)));
  return `
:root, :root * {
  --dsw-alias-bg-base: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${percent}%, transparent) !important;
  --dsw-specific-sidebar-fill: color-mix(in srgb, var(--dsw-static-neutral-bluish-900) ${percent}%, transparent) !important;
}
html, body, #root {
  background: transparent !important;
  background-color: transparent !important;
}
`;
}

export class DshPanel {
  private win: BrowserWindow | null = null;
  private view: WebContentsView | null = null;
  /** The URL the view is currently pointed at. Updated by SPA navigation
   *  (`did-navigate`) and used on re-show to decide whether the host restarted
   *  on a new port (origin changed → reload) or the user just navigated away
   *  and back (same origin → re-attach without reload). */
  private url: string | null = null;
  private attached = false;
  private lastBounds: DshBounds | null = null;
  private onEvent: ((name: string, payload: unknown) => void) | null = null;
  private backgroundOpacity = 100;
  private pageReady = false;
  private transparencyCssKey: string | null = null;
  private transparencyRevision = 0;
  /** Bumped on every `hide()`/`show()`; lets a pending fade know it's been
   *  superseded (a `show()` arriving mid-fade-out should cancel the pending
   *  detach rather than race it). */
  private opacityRevision = 0;
  /** True between a navigation we're tracking starting and its
   *  `did-stop-loading` — see `awaitLoadFinished()`. Set synchronously the
   *  moment *we* call `loadURL` (not from the `did-start-loading` event,
   *  which fires asynchronously and would otherwise race a same-tick
   *  `awaitLoadFinished()` call into seeing stale "not loading" state). */
  private loading = false;
  private loadWaiters: Array<() => void> = [];

  setWindow(win: BrowserWindow) {
    this.win = win;
  }

  setEventSink(sink: (name: string, payload: unknown) => void) {
    this.onEvent = sink;
  }

  /** Adjust the native backing layer and DSH's own background surfaces. The
   *  preference can change while the view is detached; it is remembered and
   *  applied as soon as the current/new document becomes ready. */
  setBackgroundOpacity(opacity: number): void {
    this.backgroundOpacity = Math.min(100, Math.max(0, Math.round(opacity)));
    this.applyBackgroundTransparency();
  }

  private applyBackgroundTransparency(): void {
    const view = this.view;
    if (!view) return;
    view.setBackgroundColor(this.backgroundOpacity < 100 ? "#00000000" : "#FFFFFFFF");

    const revision = ++this.transparencyRevision;
    const wc = view.webContents;
    const previous = this.transparencyCssKey;
    this.transparencyCssKey = null;
    if (previous) void wc.removeInsertedCSS(previous).catch(() => {});
    if (this.backgroundOpacity >= 100 || !this.pageReady) return;

    const css = dshBackgroundCss(this.backgroundOpacity);
    void wc.insertCSS(css).then((key) => {
      // A quick on→off toggle or a navigation may finish this insertion after
      // a newer state has won. Remove the stale sheet instead of letting it
      // resurrect transparency.
      if (
        revision !== this.transparencyRevision ||
        this.backgroundOpacity >= 100 ||
        this.view !== view ||
        !this.pageReady
      ) {
        void wc.removeInsertedCSS(key).catch(() => {});
        return;
      }
      this.transparencyCssKey = key;
    }).catch(() => {});
  }

  /** Reveal the view at `bounds`, loading `url` on first use or when the host
   *  restarted on a new port (origin changed). A re-show with the same origin
   *  just re-attaches the existing view — no reload, so the DSH SPA's in-page
   *  state (scroll position, open conversation, running task) survives.
   *
   *  Async so it can *wait* for the content to land back at full opacity
   *  before making the view visible again — see `setContentOpacityInstant`'s
   *  doc for why that ordering matters — and, on a fresh load, for the load
   *  to actually finish (`awaitLoadFinished()`) before the view is ever
   *  revealed at all: attaching it mid-load means the user watches blank →
   *  DSH's own loading UI → real content play out live, which reads as a
   *  flash/flicker even though nothing is actually wrong. `ipc.ts`'s
   *  `dsh_show` handler awaits this. */
  async show(url: string, bounds: DshBounds): Promise<void> {
    if (!this.win) throw new Error("dsh panel: no window");
    this.lastBounds = bounds;

    let freshLoad = false;
    if (this.view === null) {
      this.buildView(url);
      freshLoad = true;
    } else {
      // Re-attach path. Only reload when the *origin* (host:port) changed —
      // that's the host-restarted-on-a-new-port case. A path or hash difference
      // is the DSH SPA's own client-side navigation (or a redirect on the
      // initial load), and reloading it would blank the page and throw away the
      // user's in-page state every time they navigated away and back. Compare
      // origins, not full URL strings.
      const current = this.url;
      const originChanged = !current || new URL(url).origin !== new URL(current).origin;
      if (originChanged) {
        this.url = url;
        this.loading = true;
        void this.view.webContents.loadURL(url);
        freshLoad = true;
      }
    }
    // A plain re-show (same origin, no reload) needs none of this — the page
    // finished loading whenever it originally did, possibly minutes ago
    // while the view sat hidden, and is just being made visible again.
    if (freshLoad) await this.awaitLoadFinished();

    // Cancel any fade-out a pending hide() left in flight — its deferred
    // removeChildView checks this same counter and will no-op once it sees
    // it's stale, so the view we're about to reveal never gets yanked out
    // from under us.
    this.opacityRevision++;

    const view = this.view;
    // Unconditional, not just on a fresh reattach: a show() can also land
    // while hide()'s fade-out is still mid-flight (the view never actually
    // left, only opacityRevision above canceled the pending removal) —
    // content could be sitting at any partial opacity in that case, and this
    // is what snaps it back. Awaited *before* the view is (re)attached below,
    // so it's never revealed still carrying whatever opacity hide() last left
    // it at.
    if (view) await this.setContentOpacityInstant(view, 1);

    if (!this.attached) {
      if (view) this.win.contentView.addChildView(view);
      this.attached = true;
    }
    this.view?.setBounds(toIntBounds(bounds));
  }

  /** Fades the DSH page's own opacity via an injected inline style/transition
   *  so hide() reads as a quick fade-out instead of a hard cut — a toolbar
   *  popover/dialog opening over the page shouldn't make it disappear with a
   *  flicker. Runs entirely inside the DSH document (main can't animate a
   *  `WebContentsView`'s own opacity), and via `executeJavaScript` rather than
   *  a `<script>` tag, so DSH's own CSP can't block it. No-ops before the page
   *  has painted anything — nothing to fade yet, and fading a still-loading
   *  page would just flash the loading state. Only ever used for hide()'s
   *  fade *out* — show() uses the instant, un-animated setter below instead
   *  (see its doc for why animating the fade *in* is the wrong move). */
  private async fadeContentOpacity(view: WebContentsView, to: 0 | 1): Promise<void> {
    if (!this.pageReady) return;
    const wc = view.webContents;
    if (wc.isDestroyed()) return;
    try {
      await wc.executeJavaScript(
        `document.documentElement.style.transition = "opacity 140ms ease"; document.documentElement.style.opacity = "${to}";`,
        true,
      );
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 140));
  }

  /** Sets the DSH page's opacity immediately, no transition — used by show()
   *  right before the view is (re)attached. Deliberately NOT animated: an
   *  animated fade-*in* here would mean the view becomes visible (attached)
   *  before the async `executeJavaScript` round-trip that starts the
   *  animation has even landed, so for that gap it would be visibly showing
   *  whatever opacity hide()'s fade-out last left it at (0, most of the
   *  time) — a blank flash of whatever's behind DSH, right as the page is
   *  supposed to be reappearing. Awaiting this *before* attaching means the
   *  view is never revealed mid-transition; it just appears already at full
   *  opacity. */
  private async setContentOpacityInstant(view: WebContentsView, value: 0 | 1): Promise<void> {
    if (!this.pageReady) return;
    const wc = view.webContents;
    if (wc.isDestroyed()) return;
    try {
      await wc.executeJavaScript(
        `document.documentElement.style.transition = ""; document.documentElement.style.opacity = "${value}";`,
        true,
      );
    } catch {
      // Best-effort — a lost race here just means the content stays at
      // whatever opacity it was already at, not a functional break.
    }
  }

  /** Resolves once the load `show()` just triggered actually finishes
   *  (`did-stop-loading`), or after `LOAD_WAIT_TIMEOUT_MS` if it never does. */
  private awaitLoadFinished(): Promise<void> {
    if (!this.loading) return Promise.resolve();
    return new Promise((resolve) => {
      const settle = () => {
        clearTimeout(timer);
        const idx = this.loadWaiters.indexOf(settle);
        if (idx !== -1) this.loadWaiters.splice(idx, 1);
        resolve();
      };
      const timer = setTimeout(settle, LOAD_WAIT_TIMEOUT_MS);
      this.loadWaiters.push(settle);
    });
  }

  private buildView(url: string): void {
    const view = new WebContentsView({
      webPreferences: {
        partition: DSH_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // DSH is an *agent* UI, not a browser tab: it runs long tasks and keeps
        // a WebSocket heartbeat to its host. The browser panel throttles
        // detached views to save CPU, but throttling here would stall an
        // in-progress agent run the moment the user navigates to another page
        // — exactly the "keep running in the background" behavior we want to
        // preserve. Keep this view at full timer/rAF speed while hidden.
        backgroundThrottling: false,
      },
    });
    this.view = view;
    this.url = url;

    const wc = view.webContents;
    view.setBackgroundColor(this.backgroundOpacity < 100 ? "#00000000" : "#FFFFFFFF");
    // Its own inspector while the DSH surface has focus — same convention as the
    // browser panel.
    wireDevToolsShortcut(wc);

    wc.on("did-navigate", (_e, navUrl) => {
      this.url = navUrl;
      this.onEvent?.("dsh://navigated", navUrl);
    });
    wc.on("did-navigate-in-page", (_e, navUrl) => {
      this.url = navUrl;
      this.onEvent?.("dsh://navigated", navUrl);
    });
    wc.on("page-title-updated", (_e, title) => this.onEvent?.("dsh://title-changed", title));
    wc.on("did-start-loading", () => this.onEvent?.("dsh://loading", true));
    wc.on("did-stop-loading", () => {
      this.loading = false;
      // Flush by copy: a waiter's own cleanup (in awaitLoadFinished) splices
      // `loadWaiters`, which would skip entries if we iterated the live array.
      for (const resolve of this.loadWaiters.splice(0)) resolve();
      this.onEvent?.("dsh://loading", false);
    });
    wc.on("did-start-navigation", (_e, _url, isInPlace, isMainFrame) => {
      if (isInPlace || !isMainFrame) return;
      this.pageReady = false;
      this.transparencyCssKey = null;
      this.transparencyRevision += 1;
    });
    wc.on("dom-ready", () => {
      this.pageReady = true;
      this.applyBackgroundTransparency();
    });

    // A renderer crash (OOM, GPU fault, …) leaves the view showing a blank
    // frame forever — nothing else here reloads it. The `dsh` host process is
    // untouched by this (it isn't a child of this webContents), so any
    // in-progress task is still running; only the display needs to reconnect.
    // Recreate the frame at the same URL and tell the renderer so it can show
    // a brief "reconnecting" state.
    wc.on("render-process-gone", (_e, details) => {
      if (details.reason === "clean-exit") return;
      this.pageReady = false;
      this.onEvent?.("dsh://crashed", details.reason);
      if (!wc.isDestroyed()) void wc.loadURL(this.url ?? url);
    });

    // DSH may open auth/model-provider popups; with no second window to
    // manage, navigate this view there (the browser panel's approach). An
    // http(s) link a user middle-clicks still ends up in-page, which is the
    // nearest single-webview equivalent.
    wc.setWindowOpenHandler(({ url: target }) => {
      void wc.loadURL(target);
      return { action: "deny" };
    });

    this.loading = true;
    void wc.loadURL(url);
  }

  setBounds(bounds: DshBounds): void {
    this.lastBounds = bounds;
    if (this.attached && this.view) this.view.setBounds(toIntBounds(bounds));
  }

  /** Detach the view from the window. The view itself (and its session) is kept
   *  alive so a re-show is instant and stateful, and so the DSH agent keeps
   *  running in the background while the user is on another page.
   *
   *  Fades the page out first rather than yanking it away mid-frame — a
   *  toolbar popover opening over the page shouldn't read as a hard flicker.
   *  `attached` stays true for the duration of the fade (the view is still a
   *  genuine child of the window right up until the deferred removal below),
   *  so a `show()` that lands mid-fade sees an accurate state and just
   *  cancels the pending removal instead of trying to re-add an already-
   *  attached view. */
  hide(): void {
    if (!this.win || !this.attached || !this.view) return;
    const view = this.view;
    const win = this.win;
    const revision = ++this.opacityRevision;
    void this.fadeContentOpacity(view, 0).then(() => {
      if (revision !== this.opacityRevision) return; // superseded by a later show()/hide()
      // The window may already be tearing down (app quit fires `closed` after
      // the BrowserWindow is destroyed); touching contentView on a destroyed
      // window throws "Object has been destroyed" in the main process. The OS
      // reaps child views with the window anyway, so a destroyed window just
      // drops the bookkeeping here.
      if (!win.isDestroyed()) {
        try {
          win.contentView.removeChildView(view);
        } catch {
          // Destroyed mid-call between isDestroyed() and the access — nothing
          // to do; the view is torn down with the window regardless.
        }
      }
      this.attached = false;
    });
  }

  /** Reload the current page (or load a new URL if given). Used by the
   *  renderer's reload button. */
  reload(url?: string): void {
    if (!this.view) return;
    if (url && url !== this.url) {
      this.url = url;
      void this.view.webContents.loadURL(url);
    } else {
      this.view.webContents.reload();
    }
  }

  /** The window (and its child views) is gone — drop everything rather than
   *  hold a now-destroyed WebContentsView. Only reachable on macOS, where the
   *  app survives its last window closing; on a real quit the BrowserWindow is
   *  already destroyed by the time `closed` fires, so this must not touch the
   *  window (see hide()'s destroyed-window guard). */
  reset(): void {
    // Don't call hide(): contentView access on the destroyed window is what
    // throws. The window reaps its child views itself; we only clean up our
    // own references and the view's webContents if it still exists.
    this.attached = false;
    const view = this.view;
    if (view) {
      const wc = view.webContents;
      if (!wc.isDestroyed()) {
        try {
          wc.close();
        } catch {
          // Destroyed mid-call — nothing to do.
        }
      }
    }
    this.view = null;
    this.win = null;
    this.url = null;
    this.pageReady = false;
    this.transparencyCssKey = null;
    this.transparencyRevision += 1;
  }
}
