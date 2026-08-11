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
import { app, BrowserWindow, session, Session, WebContents, WebContentsView } from "electron";
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
  normalizePanelIdentity(ses);
}

/** Electron's default User-Agent is Chrome's, plus two extra product tokens:
 *  `TanWords/<appVersion>` and `Electron/<electronVersion>`. Those tokens are
 *  a loud "this is not a browser" signal — Google in particular treats an
 *  Electron UA as automation and answers with sign-in walls, interstitial
 *  "verify you're human" checks, and eventually rate limits on the address
 *  behind it. Nothing about the panel *is* automation (it renders a real
 *  Chromium for a human), so presenting the real Chromium underneath is both
 *  accurate and what keeps ordinary browsing from being treated as abuse.
 *
 *  Both halves of the identity have to agree or the mismatch is itself a
 *  signal: the UA string is stripped back to Chrome's, and `Sec-CH-UA` (the
 *  client-hint form of the same claim, which `setUserAgent` does NOT touch —
 *  Chromium builds it from its own brand list, where Electron appears as a
 *  brand) is rewritten to the same Chrome version. The Chrome major comes
 *  from `process.versions.chrome`, so an Electron upgrade carries it along
 *  instead of leaving a stale hardcoded version behind. */
function secChUa(): string {
  const major = (process.versions.chrome ?? "").split(".")[0] || "0";
  return `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not?A_Brand";v="24"`;
}

/** Strips the two Electron-added product tokens back out of the default UA,
 *  leaving the genuine Chrome string underneath. */
export function chromeUserAgent(): string {
  return app.userAgentFallback
    .replace(/ Electron\/\S+/, "")
    .replace(/ [^ /]+\/\d[^ ]* (?=Chrome\/)/, " ");
}

let identityNormalized = false;
function normalizePanelIdentity(ses: Session) {
  if (identityNormalized) return;
  identityNormalized = true;
  // Resolved here rather than at import: `userAgentFallback` reflects the app
  // name, which is only final once main has configured the app object.
  const CHROME_UA = chromeUserAgent();
  const SEC_CH_UA = secChUa();
  ses.setUserAgent(CHROME_UA);
  // Separate from the ad-block listener on purpose: this is not part of
  // blocking and must survive `disableAdBlock()`, which drops *all*
  // onBeforeRequest listeners on this session.
  ses.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
    const headers = details.requestHeaders;
    headers["User-Agent"] = CHROME_UA;
    // Only rewrite the hint when Chromium already chose to send it — adding
    // it where Chromium withheld it (non-secure origins) would be its own
    // anomaly.
    if (headers["sec-ch-ua"] !== undefined) headers["sec-ch-ua"] = SEC_CH_UA;
    if (headers["Sec-CH-UA"] !== undefined) headers["Sec-CH-UA"] = SEC_CH_UA;
    callback({ requestHeaders: headers });
  });
}

/** Ad/tracker blocking for the panel session. The matching engine lives in
 *  the Rust `tanwords` core sidecar (the `adblock_check` RPC, built on
 *  Brave's `adblock` crate); this main process only intercepts requests — an
 *  Electron-only API the sidecar can't reach — and asks the sidecar whether
 *  to block each subresource. Cosmetic hiding is a separate path — see
 *  `registerCosmeticPreload`. Fails open with a short timeout + an LRU cache,
 *  so a slow/down sidecar never stalls a page. */
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

/** The document a request was made from — what the filter engine calls the
 *  source URL, and what every `$third-party` / `$domain=` rule is evaluated
 *  against.
 *
 *  This used to be `details.referrer`, which is the wrong thing and is very
 *  often empty: `Referrer-Policy: strict-origin-when-cross-origin` (the web
 *  default) reduces it to a bare origin, `no-referrer` removes it entirely,
 *  and XHR/fetch/beacon requests frequently carry none at all. With an empty
 *  source the engine sees no party relationship, so `$third-party` rules —
 *  the bulk of EasyList — could not match, and blocking silently degraded to
 *  only the unconditional URL-pattern rules.
 *
 *  `details.frame.url` is the requesting frame's real document URL, which is
 *  what uBO uses. It can be null once a frame has navigated away or been
 *  destroyed (and touching it then throws), so fall back to the tab's
 *  top-level URL, then to the referrer. */
export function documentUrlFor(details: { frame?: { url: string } | null; webContents?: { getURL(): string }; referrer: string }): string {
  try {
    const frameUrl = details.frame?.url;
    if (frameUrl) return frameUrl;
  } catch {
    // Frame already gone — fall through.
  }
  try {
    const topUrl = details.webContents?.getURL();
    if (topUrl) return topUrl;
  } catch {
    // WebContents destroyed mid-flight — fall through.
  }
  return details.referrer || "";
}

/** The cosmetic-injection preload, as source. Runs in the isolated world on
 *  every top frame; its sync IPC is answered from main's prewarmed cache, so
 *  it never blocks on the sidecar.
 *
 *  Exported so its two hard-won behaviours can be tested rather than only
 *  shipped: that it survives a document-start with no `documentElement` yet,
 *  and that a refused scriptlet does not take the stylesheet down with it. */
export const COSMETIC_PRELOAD_SOURCE = `(function(){
  if (window.self !== window.top) return;
  var url = '';
  try { url = location.href; } catch(e) {}
  if (!url) return;
  var c = null;
  try { c = require('electron').ipcRenderer.sendSync('adblock:cosmetics', url); } catch(e) {}
  if (!c || (!c.stylesheet && !c.script)) return;
  // A preload runs at document-start, which on a fresh document is BEFORE the
  // parser has produced <html>: document.documentElement and document.head are
  // both null, and appending to null throws — which used to abort the whole
  // preload, taking the stylesheet down with the script. Inject as soon as a
  // root exists, and if there is none yet, watch for it.
  function inject() {
    var root = document.documentElement || document.head;
    if (!root) return false;
    if (c.stylesheet) {
      try {
        var s = document.createElement('style');
        s.textContent = c.stylesheet + '{display:none!important}';
        root.appendChild(s);
      } catch (e) {}
    }
    // Kept separate from the stylesheet on purpose: scriptlets are the part
    // that can still be refused (a page may enforce Trusted Types before the
    // panel's header pass has relaxed it), and a refusal must not cost us the
    // cosmetic hiding that already succeeded.
    if (c.script) {
      try {
        var sc = document.createElement('script');
        sc.textContent = c.script;
        root.appendChild(sc);
        sc.remove();
      } catch (e) {}
    }
    return true;
  }
  if (!inject()) {
    try {
      var obs = new MutationObserver(function(_m, o) { if (inject()) o.disconnect(); });
      obs.observe(document, { childList: true });
    } catch (e) {}
  }
})();`;

/** Drops only the two Trusted Types directives from one CSP header value,
 *  leaving every other directive (`script-src`, `frame-ancestors`, …) intact.
 *
 *  Why this is needed at all: uBO's ad rules for YouTube are *scriptlets*
 *  (`json-prune` on the player response, `set-constant`), not network rules —
 *  video ads come from the same googlevideo host as the video itself, so
 *  nothing can block them by URL. Scriptlets have to execute in the page's
 *  main world, and the only document-start hook Electron gives an isolated
 *  preload is building a `<script>` element. Under
 *  `require-trusted-types-for 'script'` — which YouTube sends — assigning a
 *  string to `script.textContent` throws, so the scriptlets never ran and
 *  video ads played while banner ads were correctly hidden.
 *
 *  The tradeoff, stated plainly: Trusted Types is the visited site's own
 *  hardening against DOM XSS, and this turns it off for main-frame documents
 *  while blocking is enabled. A real browser extension does not pay this —
 *  it injects into an isolated MAIN world that bypasses Trusted Types
 *  natively — but no Electron API offers that at document-start. It is
 *  narrowed as far as it can be: enforcing CSP headers only (report-only is
 *  left alone since it blocks nothing), main-frame documents only, on the
 *  panel's own partition only, and removed again the moment blocking is
 *  turned off. `script-src` is deliberately left standing — the probe that
 *  found this confirmed YouTube's `script-src` does not refuse the injected
 *  script once Trusted Types is out of the way. */
export function stripTrustedTypes(csp: string): string {
  if (!/trusted-types/i.test(csp)) return csp;
  return csp
    .split(";")
    .filter((directive) => !/^\s*(require-trusted-types-for|trusted-types)\s*(\s|$)/i.test(directive))
    .join(";");
}

/** Origin of a source URL, for the decision cache key: party-ness and
 *  `$domain=` depend on the document's host, not its full path, so keying on
 *  the origin keeps one entry per site rather than one per page. */
function sourceOriginOf(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).origin;
  } catch {
    return "";
  }
}

function toIntBounds(b: PanelBounds) {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  };
}

/** JS that injects cosmetic resources directly into the page's MAIN world
 *  (webContents.executeJavaScript runs there). Used as the late fallback when
 *  the preload missed its cache hit — CSS hiding still works once it lands,
 *  scriptlets are best-effort. `stylesheet` is a selector list; the caller
 *  wraps it in `{display:none!important}` per the shared convention. */
function buildCosmeticInjectionJs(c: { stylesheet: string; script: string }): string {
  const parts: string[] = [];
  if (c.stylesheet) {
    parts.push(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(c.stylesheet + "{display:none!important}")};(document.head||document.documentElement).appendChild(s)})()`);
  }
  if (c.script) {
    parts.push(c.script);
  }
  return parts.join("\n");
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
  /** Per-URL cosmetic resources (CSS selectors + injected script), prewarmed
   *  at navigation start so the preload's sync IPC never blocks on a sidecar
   *  roundtrip. */
  private cosmeticsCache = new Map<string, { stylesheet: string; script: string }>();
  private static COSMETICS_CACHE_MAX = 500;

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

  private rememberDecision(key: string, dec: { block: boolean; redirect?: string }) {
    if (this.adBlockCache.size >= BrowserPanelManager.ADBLOCK_CACHE_MAX) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = this.adBlockCache.keys().next().value;
      if (oldest) this.adBlockCache.delete(oldest);
    }
    this.adBlockCache.set(key, dec);
  }

  private async enableAdBlock(): Promise<void> {
    if (this.adBlockRegistered) return;
    if (!this.adBlockEnabled || !this.getBackend) return;
    void this.registerCosmeticPreload();
    const ses = panelSession();
    ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
      if (!this.adBlockEnabled || details.resourceType !== "mainFrame") { callback({}); return; }
      const headers = details.responseHeaders;
      if (!headers) { callback({}); return; }
      let touched = false;
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() !== "content-security-policy") continue;
        const values = headers[name];
        if (!Array.isArray(values)) continue;
        headers[name] = values.map((v) => stripTrustedTypes(v));
        touched = true;
      }
      callback(touched ? { responseHeaders: headers } : {});
    });
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      // Never block a top-level document load — that would blank the tab.
      if (details.resourceType === "mainFrame") { callback({}); return; }
      if (!this.adBlockEnabled) { callback({}); return; }

      const url = details.url;
      const sourceUrl = documentUrlFor(details);
      // The engine's answer is a function of all three inputs, not the URL
      // alone: the same script is third-party on one page and first-party on
      // another, and `$domain=`/`$third-party` rules turn on exactly that.
      // Keying on the URL alone let the first page to request a resource
      // decide it for every other page in the session.
      const key = `${details.resourceType} ${sourceOriginOf(sourceUrl)} ${url}`;
      const cached = this.adBlockCache.get(key);
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
        if (dec) this.rememberDecision(key, dec);
        if (dec?.redirect) callback({ redirectURL: dec.redirect });
        else if (dec?.block) callback({ cancel: true });
        else callback({});
      };
      // Fail-open after a short timeout: a blocker must never stall a page.
      const timer = setTimeout(() => settle(null), BrowserPanelManager.ADBLOCK_TIMEOUT_MS);
      this.askSidecar(url, sourceUrl, details.resourceType)
        .then((dec) => { clearTimeout(timer); settle(dec); })
        .catch(() => { clearTimeout(timer); settle(null); });
    });
    this.adBlockRegistered = true;
  }

  private disableAdBlock(): void {
    // Drop the cosmetics prewarm cache first, unconditionally — the listener
    // below may never have been registered (e.g. a toggle before the first
    // enable landed), but stale cosmetics must not survive a re-enable.
    this.cosmeticsCache.clear();
    if (!this.adBlockRegistered) return;
    // onBeforeRequest(null) removes *all* listeners for that event on the
    // session — fine here, the panel session has no other onBeforeRequest
    // listener (the app shell's youtubeEmbed handler is on defaultSession).
    panelSession().webRequest.onBeforeRequest(null);
    // Same for the CSP pass: with blocking off there are no scriptlets to
    // inject, so the site's Trusted Types enforcement goes straight back.
    panelSession().webRequest.onHeadersReceived(null);
    this.adBlockRegistered = false;
    // Remove the cosmetic preload so newly-built tabs don't get it.
    if (this.cosmeticPreloadId) {
      try { panelSession().unregisterPreloadScript(this.cosmeticPreloadId); } catch {}
      this.cosmeticPreloadId = null;
    }
  }

  /** Answer the preload's sync `adblock:cosmetics` query from the prewarmed
   *  cache. Never blocks on the sidecar: a miss returns empty immediately
   *  (fail-open) and kicks off an async fetch + late injection. */
  cosmeticsForSync(url: string, wc: WebContents): { stylesheet: string; script: string } {
    const hit = this.cosmeticsCache.get(url);
    if (hit) return hit;
    void this.fetchCosmetics(url).then((c) => {
      if (!c) return;
      this.rememberCosmetics(url, c);
      // The preload already ran and found nothing; a late executeJavaScript
      // injection still hides elements (CSS), and scriptlets are best-effort.
      const js = buildCosmeticInjectionJs(c);
      if (js) void wc.executeJavaScript(js, true).catch(() => {});
    });
    return { stylesheet: "", script: "" };
  }

  private async fetchCosmetics(url: string): Promise<{ stylesheet: string; script: string } | null> {
    if (!this.getBackend) return null;
    try {
      const { port, token } = await this.getBackend();
      const res = await fetch(`http://127.0.0.1:${port}/invoke/adblock_cosmetics`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { stylesheet?: string; script?: string };
      return { stylesheet: j.stylesheet ?? "", script: j.script ?? "" };
    } catch {
      return null;
    }
  }

  private rememberCosmetics(url: string, c: { stylesheet: string; script: string }) {
    if (this.cosmeticsCache.size >= BrowserPanelManager.COSMETICS_CACHE_MAX) {
      const oldest = this.cosmeticsCache.keys().next().value;
      if (oldest) this.cosmeticsCache.delete(oldest);
    }
    this.cosmeticsCache.set(url, c);
  }

  /** Prewarm cosmetics for an about-to-load URL so the preload's sync IPC
   *  (which must never block) finds a hit. Fires on main-frame navigations. */
  private prewarmCosmetics(url: string): void {
    if (!this.adBlockEnabled || this.cosmeticsCache.has(url)) return;
    void this.fetchCosmetics(url).then((c) => {
      if (c) this.rememberCosmetics(url, c);
    });
  }

  /** Writes the cosmetic-injection preload to userData and registers it on
   *  the panel session.
   *
   *  CRITICAL: the panel's WebContentsView has `contextIsolation: true` +
   *  `sandbox: true`, so the preload runs in an ISOLATED world — its `window`
   *  is NOT the page's `window`. Directly modifying `JSON.parse` or defining
   *  properties on `window` would only affect the isolated world.
   *
   *  The fix: the preload asks main for the engine's cosmetics (sendSync —
   *  answered from a prewarmed cache, never a sidecar roundtrip), then
   *  creates a `<style>` (CSS is DOM-shared, applies in every world) and a
   *  `<script>` element whose `textContent` carries the injected script. The
   *  script element's code runs in the PAGE's MAIN world, where YouTube's
   *  scripts live — the standard "main-world injection from an isolated
   *  preload" pattern, executing at document-start before page scripts.
   *
   *  Top frame only: subframe cosmetics are a separate concern (uBO injects
   *  per-frame), and per-frame sync IPC would get chatty. Ad iframes are
   *  usually network-blocked anyway.
   *
   *  Writing to disk is required because `registerPreloadScript` takes a file
   *  path, and the packaged app excludes node_modules. */
  private async registerCosmeticPreload(): Promise<void> {
    if (this.cosmeticPreloadId) return;
    const preloadPath = path.join(app.getPath("userData"), "adblock-preload.cjs");
    try {
      await fs.writeFile(preloadPath, COSMETIC_PRELOAD_SOURCE, "utf-8");
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
    // Prewarm cosmetics for the URL about to load so the preload's sync IPC
    // (which must never block on a sidecar roundtrip) finds a cache hit.
    wc.on("did-start-navigation", (_e, navUrl, _isInPlace, isMainFrame) => {
      if (isMainFrame) this.prewarmCosmetics(navUrl);
    });
    wc.on("did-navigate", (_e, navUrl) => {
      this.prewarmCosmetics(navUrl);
    });
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
