/** Native replacement for the old Rust `browser_panel` (Task 4). Each tab is
 *  a `WebContentsView` added as a child of the main window's `contentView` —
 *  no separate `BaseWindow` migration needed, `BrowserWindow.contentView` has
 *  supported child views since Electron 30.
 *
 *  Only the active tab's view is ever attached; switching tabs detaches the
 *  previous one and attaches the next rather than destroying it, so a tab's
 *  page (and scroll position, form state, etc.) survives being backgrounded.
 *  `hide()` detaches with nothing to replace it, for when the browser page
 *  itself is off-screen (nav'd away, or a modal needs to sit above native
 *  content — see useBrowserPanel's `blocked`). */
import { BrowserWindow, WebContentsView } from "electron";

export type BrowserTabState = { id: string; url: string; title: string; atHome: boolean };
export type BrowserPanelState = { tabs: BrowserTabState[]; active: string | null };
export type PanelBounds = { x: number; y: number; width: number; height: number };

type TabRecord = {
  id: string;
  /** Null once the tab has been discarded to reclaim its renderer process.
   *  `url`/`title` survive, so the tab strip is unchanged and the page is
   *  restored on next activation. */
  view: WebContentsView | null;
  url: string;
  title: string;
  atHome: boolean;
  /** Monotonic counter, bumped on activation — drives LRU discard. */
  usedAt: number;
};

/** How many tabs keep a live renderer process. Every WebContentsView is a
 *  full renderer (~80-150MB resident), and tabs here are deliberately long-
 *  lived — without a cap, a browsing session grows without bound. Beyond this
 *  many, the least-recently-active background tab is discarded: its process is
 *  freed and the page reloads from its URL when the user returns to it. This
 *  is what Chrome's own tab discarding does; the active tab is never a
 *  candidate. */
const MAX_LIVE_TABS = 3;

function toIntBounds(b: PanelBounds) {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  };
}

export class BrowserPanelManager {
  private win: BrowserWindow | null = null;
  private tabs = new Map<string, TabRecord>();
  private activeId: string | null = null;
  private attachedId: string | null = null;
  private lastBounds: PanelBounds | null = null;
  private nextId = 1;
  private useSeq = 1;
  private onEvent: ((name: string, payload: unknown) => void) | null = null;

  setWindow(win: BrowserWindow) {
    this.win = win;
  }

  setEventSink(sink: (name: string, payload: unknown) => void) {
    this.onEvent = sink;
  }

  private emit(tabId: string, name: string, value: unknown) {
    this.onEvent?.(name, { tabId, value });
  }

  private createTab(): TabRecord {
    const id = `panel-${this.nextId++}`;
    const rec: TabRecord = { id, view: null, url: "", title: "", atHome: true, usedAt: 0 };
    this.tabs.set(id, rec);
    this.buildView(rec);
    return rec;
  }

  /** Builds (or rebuilds, after a discard) the tab's renderer. Split out of
   *  createTab so a discarded tab can be brought back with its listeners and
   *  handlers wired identically. */
  private buildView(rec: TabRecord): WebContentsView {
    const id = rec.id;
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Chromium's default, made explicit: a detached/background tab has its
        // timers and rAF throttled rather than continuing to burn CPU behind
        // the app UI.
        backgroundThrottling: true,
      },
    });
    rec.view = view;

    const wc = view.webContents;
    wc.on("did-navigate", (_e, url) => {
      rec.url = url;
      this.emit(id, "browser://navigated", url);
    });
    wc.on("did-navigate-in-page", (_e, url) => {
      rec.url = url;
      this.emit(id, "browser://navigated", url);
    });
    wc.on("page-title-updated", (_e, title) => {
      rec.title = title;
      this.emit(id, "browser://title-changed", title);
    });
    wc.on("did-start-loading", () => this.emit(id, "browser://loading", true));
    wc.on("did-stop-loading", () => this.emit(id, "browser://loading", false));
    // Popups/target=_blank: no second window to manage, just navigate this
    // tab's own view there — the closest single-webview equivalent.
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url);
      return { action: "deny" };
    });

    return view;
  }

  /** The tab's live view, rebuilt and reloaded if it had been discarded. */
  private liveView(rec: TabRecord): WebContentsView {
    if (rec.view) return rec.view;
    const view = this.buildView(rec);
    if (rec.url) void view.webContents.loadURL(rec.url);
    return view;
  }

  /** Frees the renderer processes of background tabs beyond MAX_LIVE_TABS,
   *  least-recently-active first. The active tab is never discarded. */
  private discardStaleTabs() {
    const live = [...this.tabs.values()].filter((t) => t.view && t.id !== this.activeId);
    const overBy = live.length + 1 - MAX_LIVE_TABS;
    if (overBy <= 0) return;
    live.sort((a, b) => a.usedAt - b.usedAt);
    for (const rec of live.slice(0, overBy)) {
      if (this.attachedId === rec.id) continue;
      const view = rec.view;
      rec.view = null;
      view?.webContents.close();
    }
  }

  private attach(rec: TabRecord) {
    if (!this.win) throw new Error("browser panel: no window");
    if (this.attachedId === rec.id) return;
    if (this.attachedId) {
      const prev = this.tabs.get(this.attachedId);
      if (prev?.view) this.win.contentView.removeChildView(prev.view);
    }
    this.win.contentView.addChildView(this.liveView(rec));
    this.attachedId = rec.id;
    if (this.lastBounds) rec.view?.setBounds(toIntBounds(this.lastBounds));
  }

  show(tabId: string | null, bounds: PanelBounds, url: string | null): string {
    const rec = (tabId && this.tabs.get(tabId)) || this.createTab();
    rec.usedAt = this.useSeq++;
    this.attach(rec);
    this.activeId = rec.id;
    rec.atHome = false;
    this.setBounds(bounds);
    if (url) void rec.view?.webContents.loadURL(url);
    // After the new active tab is settled, so it is never its own victim.
    this.discardStaleTabs();
    return rec.id;
  }

  setBounds(bounds: PanelBounds) {
    this.lastBounds = bounds;
    if (!this.attachedId) return;
    const rec = this.tabs.get(this.attachedId);
    rec?.view?.setBounds(toIntBounds(bounds));
  }

  /** Detaches the active view and returns a still-frame of it as a data URL
   *  (or null if there was nothing attached, or the capture failed) — the
   *  renderer shows this in place of the now-hidden native view so a modal
   *  opening over the browser page reads as "stepped aside", not "the page
   *  vanished" (see useBrowserPanel's `blocked`). */
  async hide(): Promise<string | null> {
    if (!this.win || !this.attachedId) return null;
    const rec = this.tabs.get(this.attachedId);
    this.attachedId = null;
    if (!rec) return null;

    if (!rec.view) return null;
    let snapshot: string | null = null;
    try {
      snapshot = (await rec.view.webContents.capturePage()).toDataURL();
    } catch {
      // Best-effort — a failed capture just means no placeholder.
    }
    this.win.contentView.removeChildView(rec.view);
    return snapshot;
  }

  getState(): BrowserPanelState {
    return {
      tabs: [...this.tabs.values()].map(({ id, url, title, atHome }) => ({ id, url, title, atHome })),
      active: this.activeId,
    };
  }

  goHome(tabId: string) {
    const rec = this.tabs.get(tabId);
    if (!rec) return;
    rec.atHome = true;
    rec.url = "";
    rec.title = "";
    // A discarded tab sent home has nothing to restore — leave it discarded
    // rather than spending a process to render about:blank.
    void rec.view?.webContents.loadURL("about:blank");
  }

  closeTab(tabId: string) {
    const rec = this.tabs.get(tabId);
    if (!rec) return;
    if (this.attachedId === tabId && rec.view) {
      this.win?.contentView.removeChildView(rec.view);
      this.attachedId = null;
    }
    if (this.activeId === tabId) this.activeId = null;
    this.tabs.delete(tabId);
    rec.view?.webContents.close();
  }

  reload(tabId: string) {
    const rec = this.tabs.get(tabId);
    // Reloading a discarded tab is exactly what restoring it does.
    if (rec) this.liveView(rec).webContents.reload();
  }

  goBack(tabId: string) {
    const wc = this.tabs.get(tabId)?.view?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(tabId: string) {
    const wc = this.tabs.get(tabId)?.view?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  async clearData(): Promise<void> {
    const sessions = new Set(
      [...this.tabs.values()].flatMap((t) => (t.view ? [t.view.webContents.session] : [])),
    );
    await Promise.all([...sessions].map((s) => s.clearStorageData()));
  }

  /** The window (and every child view still attached to it) is gone —
   *  drop all state rather than hold onto now-destroyed WebContentsViews.
   *  Only reachable on macOS, where the app survives its last window closing. */
  reset() {
    this.win = null;
    this.tabs.clear();
    this.activeId = null;
    this.attachedId = null;
  }
}
