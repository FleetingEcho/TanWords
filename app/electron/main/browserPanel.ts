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
import { app, BrowserWindow, session, WebContentsView } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { wireDevToolsShortcut } from "./devtools";

export type BrowserTabState = { id: string; url: string; title: string; atHome: boolean };
export type BrowserPanelState = { tabs: BrowserTabState[]; active: string | null };
export type PanelBounds = { x: number; y: number; width: number; height: number };

/** The panel gets its own persistent session, separate from the app shell's
 *  defaultSession: it runs arbitrary remote sites, so its cookies/cache must
 *  never mix with the app UI's storage — and "clear browser data" must not be
 *  able to wipe the shell's localStorage (theme cache, UI prefs), which an
 *  unfiltered clearStorageData() on the shared session used to do. */
const PANEL_PARTITION = "persist:browser-panel";

/** Arbitrary remote content must not acquire permissions the app itself
 *  never asks for (notifications, media devices, …). Deny by default, on the
 *  panel's session only — the app shell is untouched. */
function hardenPanelSession() {
  const ses = session.fromPartition(PANEL_PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

/** Ad/tracker blocking for the panel session. The matching engine lives in
 *  the Rust `tanwords` core sidecar (the `adblock_check` RPC, built on
 *  Brave's `adblock` crate); this main process only intercepts requests — an
 *  Electron-only API the sidecar can't reach — and asks the sidecar whether
 *  to block each subresource. Network-level blocking only (no cosmetic DOM
 *  hiding). Fails open with a short timeout + an LRU cache, so a slow/down
 *  sidecar never stalls a page. */
function panelSession() {
  return session.fromPartition(PANEL_PARTITION);
}

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
const MAX_LIVE_TABS = 2;

/** Floor on how often an embedded page's input is reported to the shell. The
 *  only consumer is the auto-lock idle timer, whose shortest interval is ten
 *  minutes. */
const INPUT_EMIT_INTERVAL_MS = 30_000;

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
  private lastInputEmit = 0;

  /** Ad/tracker blocking, scoped to the panel session. Defaults on; the
   *  renderer pushes the persisted preference (browser_set_adblock_enabled)
   *  once its settings hydrate. The matching engine lives in the Rust
   *  `tanwords` core sidecar (`adblock_check` RPC); this main process only
   *  intercepts requests (an Electron-only API the sidecar can't reach) and
   *  asks the sidecar whether to block each subresource. Fail-open with a
   *  short timeout + an LRU cache, so a slow/down sidecar never stalls a page. */
  private adBlockEnabled = true;
  private adBlockRegistered = false;
  private cosmeticPreloadId: string | null = null;
  /** Returns the sidecar's localhost port + session token. Set from
   *  index.ts once the SidecarSupervisor is created. */
  private getBackend: (() => Promise<{ port: number; token: string }>) | null = null;
  /** Cap on the per-URL decision cache. Ad beacons repeat across a session;
   *  caching avoids a roundtrip per repeat. */
  private adBlockCache = new Map<string, { block: boolean; redirect?: string }>();
  private static ADBLOCK_CACHE_MAX = 2000;
  private static ADBLOCK_TIMEOUT_MS = 800;

  setBackendGetter(fn: () => Promise<{ port: number; token: string }>) {
    this.getBackend = fn;
    // Register the cosmetic preload at startup (before any WebContentsView is
    // created) so every view gets it. registerPreloadScript applies only to
    // newly-created webContents, so registering here — at app init — means the
    // first tab isn't missed.
    void this.registerCosmeticPreload();
  }

  setAdBlockEnabled(enabled: boolean): void {
    this.adBlockEnabled = enabled;
    if (enabled) void this.enableAdBlock();
    else this.disableAdBlock();
  }

  private async askSidecar(url: string, sourceUrl: string, resourceType: string): Promise<{ block: boolean; redirect?: string } | null> {
    if (!this.getBackend) return null;
    try {
      const { port, token } = await this.getBackend();
      const res = await fetch(`http://127.0.0.1:${port}/invoke/adblock_check`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, sourceUrl: sourceUrl || "", resourceType: resourceType || "other" }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { block?: boolean; redirect?: string | null };
      return { block: !!j.block, redirect: j.redirect ?? undefined };
    } catch {
      return null;
    }
  }

  private rememberDecision(url: string, dec: { block: boolean; redirect?: string }) {
    if (this.adBlockCache.size >= BrowserPanelManager.ADBLOCK_CACHE_MAX) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = this.adBlockCache.keys().next().value;
      if (oldest) this.adBlockCache.delete(oldest);
    }
    this.adBlockCache.set(url, dec);
  }

  private async enableAdBlock(): Promise<void> {
    if (this.adBlockRegistered) return;
    if (!this.adBlockEnabled || !this.getBackend) return;
    const ses = panelSession();
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      // Never block a top-level document load — that would blank the tab.
      if (details.resourceType === "mainFrame") { callback({}); return; }
      if (!this.adBlockEnabled) { callback({}); return; }

      const url = details.url;
      const cached = this.adBlockCache.get(url);
      if (cached) {
        if (cached.redirect) callback({ redirectURL: cached.redirect });
        else if (cached.block) callback({ cancel: true });
        else callback({});
        return;
      }

      let settled = false;
      const settle = (dec: { block: boolean; redirect?: string } | null) => {
        if (settled) return;
        settled = true;
        if (dec) this.rememberDecision(url, dec);
        if (dec?.redirect) callback({ redirectURL: dec.redirect });
        else if (dec?.block) callback({ cancel: true });
        else callback({});
      };
      // Fail-open after a short timeout: a blocker must never stall a page.
      const timer = setTimeout(() => settle(null), BrowserPanelManager.ADBLOCK_TIMEOUT_MS);
      this.askSidecar(url, details.referrer, details.resourceType)
        .then((dec) => { clearTimeout(timer); settle(dec); })
        .catch(() => { clearTimeout(timer); settle(null); });
    });
    this.adBlockRegistered = true;
  }

  private disableAdBlock(): void {
    if (!this.adBlockRegistered) return;
    // onBeforeRequest(null) removes *all* listeners for that event on the
    // session — fine here, the panel session has no other onBeforeRequest
    // listener (the app shell's youtubeEmbed handler is on defaultSession).
    panelSession().webRequest.onBeforeRequest(null);
    this.adBlockRegistered = false;
    // Remove the cosmetic preload so newly-built tabs don't get it.
    if (this.cosmeticPreloadId) {
      try { panelSession().unregisterPreloadScript(this.cosmeticPreloadId); } catch {}
      this.cosmeticPreloadId = null;
    }
  }

  /** Writes the self-contained YouTube ad-pruning preload to userData and
   *  registers it on the panel session.
   *
   *  CRITICAL: the panel's WebContentsView has `contextIsolation: true` +
   *  `sandbox: true`, so the preload runs in an ISOLATED world — its `window`
   *  is NOT the page's `window`. Modifying `JSON.parse` or defining properties
   *  on `window` directly would only affect the isolated world, which YouTube's
   *  main-world scripts never see.
   *
   *  The fix: the preload creates a `<script>` element with the json-prune code
   *  as `textContent` and appends it to `document.documentElement`. The script
   *  element's code runs in the PAGE's MAIN world, where YouTube's scripts live.
   *  This is the standard "main-world injection from an isolated preload"
   *  pattern — the script executes synchronously at document-start, before
   *  YouTube's own inline scripts.
   *
   *  Writing to disk is required because `registerPreloadScript` takes a file
   *  path, and the packaged app excludes node_modules. */
  private async registerCosmeticPreload(): Promise<void> {
    if (this.cosmeticPreloadId) return;
    const preloadPath = path.join(app.getPath("userData"), "adblock-preload.cjs");
    // The json-prune code that runs in the PAGE's main world via <script> injection.
    const innerScript = `(function(){'use strict';var K=['adPlacements','playerAds','adParams','adBreakHeartbeatParams','adSignalingParams','adSlots'];function p(o){if(!o||typeof o!=='object')return o;for(var i=0;i<K.length;i++){try{delete o[K[i]]}catch(e){}}if(o.playerResponse&&typeof o.playerResponse==='object'){for(var i=0;i<K.length;i++){try{delete o.playerResponse[K[i]]}catch(e){}}}return o}var _j=JSON.parse;JSON.parse=function(){var r=_j.apply(this,arguments);if(r&&typeof r==='object'&&(r.adPlacements||r.playerAds||r.adSlots)){return p(r)}return r};if(self.Response){var _k=Response.prototype.json;Response.prototype.json=function(){return _k.call(this).then(function(r){if(r&&typeof r==='object'&&(r.adPlacements||r.playerAds||r.adSlots)){return p(r)}return r})}}var s=document.createElement('style');s.textContent='.ad-showing,#masthead-ad,.ytd-ad-slot-renderer,.ytp-ad-overlay-container,.ytp-ad-module,.ytd-banner-promo-renderer,.ytd-search-pyv-renderer,.ytd-promo-video-renderer{display:none!important}';(document.head||document.documentElement).appendChild(s)})();`;
    // The preload itself runs in the isolated world. It checks the hostname,
    // then injects the inner script into the DOM — which runs in the MAIN world.
    const preloadCode = `(function(){var h=location.hostname;if(h.indexOf('youtube.com')===-1&&h.indexOf('youtube-nocookie.com')===-1)return;var s=document.createElement('script');s.textContent=${JSON.stringify(innerScript)};(document.documentElement||document.head).appendChild(s);s.remove()})();`;
    try {
      await fs.writeFile(preloadPath, preloadCode, "utf-8");
      const id = panelSession().registerPreloadScript({ type: "frame", filePath: preloadPath });
      this.cosmeticPreloadId = id;
    } catch (e) {
      console.warn("[browser] cosmetic preload registration failed:", e);
    }
  }

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
    hardenPanelSession();
    // Kick off ad blocking if it's on — the engine loads async, so this is a
    // fire-and-forget that registers the webRequest listener once ready.
    if (this.adBlockEnabled) void this.enableAdBlock();
    const view = new WebContentsView({
      webPreferences: {
        partition: PANEL_PARTITION,
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
    // Its own inspector, not the app shell's — while the embedded page has
    // focus it is the thing you are trying to debug.
    wireDevToolsShortcut(wc);
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
    // All views live on PANEL_PARTITION — clear that session directly. (The
    // previous version collected sessions from *live* views, so it silently
    // cleared nothing once tabs were discarded — and while views still
    // shared the default session, it wiped the app shell's own storage too.)
    await session.fromPartition(PANEL_PARTITION).clearStorageData();
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
