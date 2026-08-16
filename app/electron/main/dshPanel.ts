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

  setWindow(win: BrowserWindow) {
    this.win = win;
  }

  setEventSink(sink: (name: string, payload: unknown) => void) {
    this.onEvent = sink;
  }

  /** Reveal the view at `bounds`, loading `url` on first use or when the host
   *  restarted on a new port (origin changed). A re-show with the same origin
   *  just re-attaches the existing view — no reload, so the DSH SPA's in-page
   *  state (scroll position, open conversation, running task) survives. */
  show(url: string, bounds: DshBounds): void {
    if (!this.win) throw new Error("dsh panel: no window");
    this.lastBounds = bounds;

    if (this.view === null) {
      this.buildView(url);
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
        void this.view.webContents.loadURL(url);
      }
    }

    if (!this.attached) {
      // buildView guarantees this.view is set; the narrowing doesn't carry
      // across the call, so capture it locally.
      const view = this.view;
      if (view) this.win.contentView.addChildView(view);
      this.attached = true;
    }
    this.view?.setBounds(toIntBounds(bounds));
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
    wc.on("did-stop-loading", () => this.onEvent?.("dsh://loading", false));

    // DSH may open auth/model-provider popups; with no second window to
    // manage, navigate this view there (the browser panel's approach). An
    // http(s) link a user middle-clicks still ends up in-page, which is the
    // nearest single-webview equivalent.
    wc.setWindowOpenHandler(({ url: target }) => {
      void wc.loadURL(target);
      return { action: "deny" };
    });

    void wc.loadURL(url);
  }

  setBounds(bounds: DshBounds): void {
    this.lastBounds = bounds;
    if (this.attached && this.view) this.view.setBounds(toIntBounds(bounds));
  }

  /** Detach the view from the window. The view itself (and its session) is kept
   *  alive so a re-show is instant and stateful, and so the DSH agent keeps
   *  running in the background while the user is on another page. */
  hide(): void {
    if (!this.win || !this.attached || !this.view) return;
    // The window may already be tearing down (app quit fires `closed` after
    // the BrowserWindow is destroyed); touching contentView on a destroyed
    // window throws "Object has been destroyed" in the main process. The OS
    // reaps child views with the window anyway, so a destroyed window just
    // drops the bookkeeping here.
    if (!this.win.isDestroyed()) {
      try {
        this.win.contentView.removeChildView(this.view);
      } catch {
        // Destroyed mid-call between isDestroyed() and the access — nothing to
        // do; the view is torn down with the window regardless.
      }
    }
    this.attached = false;
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
  }
}
