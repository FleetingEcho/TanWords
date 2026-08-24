import { BrowserWindow, session, WebContents, WebContentsView } from "electron";
import { wireDevToolsShortcut } from "./devtools";
import { toIntBounds } from "./browserPanelInjection";
import {
  PANEL_PARTITION,
  PRIVATE_PARTITION,
  PanelBounds,
  BrowserPanelState,
  HistoryEntry,
  PanelSessionState,
  stateFor,
  hardenPanelSession,
  enableMobileEmulation,
  webContentsPartition,
  recordHistory,
  updateHistoryTitle,
  prewarmCosmetics,
  enableAdBlock,
  disableAdBlock,
  registerCosmeticPreload,
} from "./browserPanel";

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
  /** Fixed at creation from the manager's privateMode flag at that moment —
   *  toggling private mode later never changes an already-open tab's
   *  session, only which session *new* tabs get. */
  partition: string;
};

/** How many tabs keep a live renderer process. Every WebContentsView is a
 *  full renderer (~80-150MB resident), and tabs here are deliberately long-
 *  lived — without a cap, a browsing session grows without bound. Beyond this
 *  many, the least-recently-active background tab is discarded: its process is
 *  freed and the page reloads from its URL when the user returns to it. This
 *  is what Chrome's own tab discarding does; the active tab is never a
 *  candidate. */
const MAX_LIVE_TABS = 2;

/** Floor on how often an embedded page's input is reported to the shell. The
 *  only consumer is the auto-lock idle timer, whose shortest interval is ten
 *  minutes. */
const INPUT_EMIT_INTERVAL_MS = 30_000;

export class BrowserPanelManager {
  /** Separate instances run fully independent tab sets — used for the
   *  full-page Browser (`persist:browser-panel`, id prefix `panel`) and the
   *  floating mobile-browser overlay (id prefix `floating`). They now
   *  deliberately share the same session partition (see index.ts) so a login
   *  in one carries over to the other; only the tab lists/native views stay
   *  independent. */
  constructor(
    private partition: string = PANEL_PARTITION,
    private idPrefix: string = "panel",
  ) {}

  private win: BrowserWindow | null = null;
  private tabs = new Map<string, TabRecord>();
  private activeId: string | null = null;
  private attachedId: string | null = null;
  private lastBounds: PanelBounds | null = null;
  private nextId = 1;
  private useSeq = 1;
  private onEvent: ((name: string, payload: unknown) => void) | null = null;
  private lastInputEmit = 0;
  /** Whole-manager toggle — set from `setPrivateMode`, read only at tab
   *  creation. See `TabRecord.partition`'s doc: this never touches
   *  already-open tabs. */
  private privateMode = false;

  /** This manager's slice of the (partition-keyed, possibly shared) ad-block
   *  state — see `PanelSessionState`'s doc for why this is shared rather than
   *  a plain instance field. Always this manager's *normal* partition —
   *  history in particular must resolve here even while privateMode is on,
   *  since `getHistory`/`clearHistory` (below) must never see private tabs. */
  private get state(): PanelSessionState {
    return stateFor(this.partition);
  }

  setPrivateMode(on: boolean): void {
    this.privateMode = on;
  }

  isPrivateMode(): boolean {
    return this.privateMode;
  }

  setBackendGetter(fn: () => Promise<{ port: number; token: string }>) {
    // Both partitions need it — the sidecar RPC itself isn't privacy-
    // sensitive, it's just how either session reaches the ad-block engine.
    stateFor(this.partition).getBackend = fn;
    stateFor(PRIVATE_PARTITION).getBackend = fn;
    // Register the cosmetic preload at startup (before any WebContentsView is
    // created) so every view gets it. registerPreloadScript applies only to
    // newly-created webContents, so registering here — at app init — means the
    // first tab isn't missed.
    void registerCosmeticPreload(this.partition);
    void registerCosmeticPreload(PRIVATE_PARTITION);
  }

  setAdBlockEnabled(enabled: boolean): void {
    for (const partition of [this.partition, PRIVATE_PARTITION]) {
      const state = stateFor(partition);
      // A decision belongs to the blocker configuration that produced it.
      // Keeping it across a toggle can resurrect a stale false-positive when
      // blocking is enabled again, even after the remote lists have refreshed.
      if (state.adBlockEnabled !== enabled) state.adBlockCache.clear();
      state.adBlockEnabled = enabled;
      if (enabled) void enableAdBlock(partition);
      else disableAdBlock(partition);
    }
  }

  setWindow(win: BrowserWindow) {
    this.win = win;
  }

  /** Moves the currently-attached tab's native view to a different window —
   *  the floating overlay's detach-into-its-own-window / re-dock transitions.
   *  Only the active tab's view is ever attached to any window's contentView
   *  (see the module doc), so there is at most one view to move; background
   *  tabs need nothing done to them. Future `attach()`/`show()` calls target
   *  the new window automatically once `this.win` is reassigned. */
  reparentTo(win: BrowserWindow): void {
    if (this.win && this.attachedId) {
      const rec = this.tabs.get(this.attachedId);
      if (rec?.view) this.win.contentView.removeChildView(rec.view);
    }
    this.win = win;
    if (this.attachedId) {
      const rec = this.tabs.get(this.attachedId);
      if (rec?.view) {
        win.contentView.addChildView(rec.view);
        // `lastBounds` is relative to the *old* window's content area — wrong
        // coordinate space here, and applying it could place the view
        // anywhere from slightly off to entirely outside the new window's
        // (possibly differently sized) client area. Fill the new window
        // instead as a sane, always-visible default; the destination
        // renderer's own container measurement (showAt, on mount) corrects
        // this to the real "screen" rect moments later.
        const content = win.getContentBounds();
        rec.view.setBounds({ x: 0, y: 0, width: content.width, height: content.height });
      }
    }
  }

  setEventSink(sink: (name: string, payload: unknown) => void) {
    this.onEvent = sink;
  }

  private emit(tabId: string, name: string, value: unknown) {
    this.onEvent?.(name, { tabId, value });
  }

  private createTab(): TabRecord {
    const id = `${this.idPrefix}-${this.nextId++}`;
    const partition = this.privateMode ? PRIVATE_PARTITION : this.partition;
    const rec: TabRecord = { id, view: null, url: "", title: "", atHome: true, usedAt: 0, partition };
    this.tabs.set(id, rec);
    this.buildView(rec);
    return rec;
  }

  /** Builds (or rebuilds, after a discard) the tab's renderer. Split out of
   *  createTab so a discarded tab can be brought back with its listeners and
   *  handlers wired identically. Uses `rec.partition`, not `this.partition` —
   *  a private tab's session must stay separate regardless of which manager
   *  built it (see TabRecord.partition's doc). */
  private buildView(rec: TabRecord): WebContentsView {
    const id = rec.id;
    const partition = rec.partition;
    const isPrivate = partition === PRIVATE_PARTITION;
    hardenPanelSession(partition);
    // Kick off ad blocking if it's on — the engine loads async, so this is a
    // fire-and-forget that registers the webRequest listener once ready.
    if (stateFor(partition).adBlockEnabled) void enableAdBlock(partition);
    const view = new WebContentsView({
      webPreferences: {
        partition,
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
    // Lets the shared `adblock:cosmetics` sync channel resolve this tab's
    // partition without needing to know which manager instance built it.
    webContentsPartition.set(wc, partition);
    // Only the floating/mobile overlay's tabs get phone emulation — the
    // full-page Browser stays desktop, even on the same session partition
    // (see `mobileWebContents`'s doc).
    if (this.idPrefix === "floating") enableMobileEmulation(wc);
    // Prewarm cosmetics for the URL about to load so the preload's sync IPC
    // (which must never block on a sidecar roundtrip) finds a cache hit.
    wc.on("did-start-navigation", (_e, navUrl, _isInPlace, isMainFrame) => {
      if (isMainFrame) prewarmCosmetics(partition, navUrl);
    });
    wc.on("did-navigate", (_e, navUrl) => {
      prewarmCosmetics(partition, navUrl);
    });
    // Its own inspector, not the app shell's — while the embedded page has
    // focus it is the thing you are trying to debug.
    wireDevToolsShortcut(wc);
    wc.on("did-navigate", (_e, url) => {
      rec.url = url;
      this.emit(id, "browser://navigated", url);
      // Only top-level navigations count as a history entry — in-page
      // navigations fire constantly on SPA-heavy sites (e.g. every video on
      // YouTube) and would flood the log with noise a real browser wouldn't
      // show either. Private tabs never record at all — that's the point.
      if (!isPrivate) recordHistory(this.state, url);
    });
    wc.on("did-navigate-in-page", (_e, url) => {
      rec.url = url;
      this.emit(id, "browser://navigated", url);
    });
    wc.on("page-title-updated", (_e, title) => {
      rec.title = title;
      this.emit(id, "browser://title-changed", title);
      // The title usually lands just after did-navigate already recorded the
      // entry with an empty title — backfill it once known.
      if (!isPrivate) updateHistoryTitle(this.state, rec.url, title);
    });
    // An embedded page is a native child view, so anything typed or clicked in
    // it never reaches the app shell's own DOM listeners — without this, an
    // hour of reading in the browser panel looks like an hour of idleness to
    // the auto-lock timer. Throttled hard: `input-event` fires on every mouse
    // move, and the idle timer only needs to know the minute is not empty.
    wc.on("input-event", () => {
      const now = Date.now();
      if (now - this.lastInputEmit < INPUT_EMIT_INTERVAL_MS) return;
      this.lastInputEmit = now;
      this.onEvent?.("user-input", null);
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

  /** Detaches the active view, optionally returning a still-frame of it as a
   *  data URL — the renderer shows that in place of the now-hidden native view
   *  so a modal opening over the browser page reads as "stepped aside", not
   *  "the page vanished" (see useBrowserPanel's `blocked`).
   *
   *  `withSnapshot` is opt-in because `capturePage()` has to be awaited while
   *  the view is still attached, and on a page that is still loading it can
   *  take a second or more — during which the view stays visible. That is a
   *  fair price for the modal case, which needs the frame. It is pure lag when
   *  the browser page is being left entirely: nothing is left mounted to
   *  render the snapshot, so the capture only delays the detach the user is
   *  waiting on. */
  async hide(withSnapshot = false): Promise<string | null> {
    if (!this.win || !this.attachedId) return null;
    const rec = this.tabs.get(this.attachedId);
    this.attachedId = null;
    if (!rec?.view) return null;

    if (!withSnapshot) {
      this.win.contentView.removeChildView(rec.view);
      return null;
    }

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
    // All views live on this instance's partition — clear that session
    // directly. (The previous version collected sessions from *live* views,
    // so it silently cleared nothing once tabs were discarded — and while
    // views still shared the default session, it wiped the app shell's own
    // storage too.)
    await session.fromPartition(this.partition).clearStorageData();
  }

  /** Most-recent-first — the order a history UI wants to display it in. */
  getHistory(): HistoryEntry[] {
    return [...this.state.history].reverse();
  }

  clearHistory(): void {
    this.state.history = [];
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
