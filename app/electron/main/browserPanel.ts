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
export const PANEL_PARTITION = "persist:browser-panel";
/** Private browsing's session — deliberately with no `persist:` prefix, which
 *  makes Electron treat it as in-memory only: nothing here ever touches
 *  disk, and it's gone on app restart. Shared by both managers (see index.ts)
 *  for the same reason PANEL_PARTITION is — one private session across the
 *  full-page Browser and the floating overlay, not two separate ones. */
export const PRIVATE_PARTITION = "browser-panel-private";

/** Arbitrary remote content must not acquire permissions the app itself
 *  never asks for (notifications, media devices, …). Deny by default, on the
 *  panel's session only — the app shell is untouched. */
function hardenPanelSession(partition: string) {
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  normalizePanelIdentity(ses, partition);
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

/** Android Chrome UA for the floating/mobile overlay's tabs — built from the
 *  same Chrome major version as `chromeUserAgent()` so the two never drift
 *  apart on an Electron upgrade. A Pixel profile is used (rather than an
 *  iPhone one) because its UA string is Chromium-only — no Safari/WebKit
 *  version to keep separately in sync. */
export function mobileUserAgent(): string {
  const major = (process.versions.chrome ?? "").split(".")[0] || "0";
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`;
}

/** Client-hint pair for a mobile identity — `Sec-CH-UA-Mobile`/`Sec-CH-UA-
 *  Platform`, rewritten alongside `Sec-CH-UA` (which is brand+version only
 *  and identical between desktop and mobile) for tracked tabs. */
const SEC_CH_UA_MOBILE = "?1";
const SEC_CH_UA_PLATFORM_MOBILE = '"Android"';

/** Tabs running under `enableMobileEmulation` — the floating/mobile overlay
 *  shares its session partition with the full-page (desktop) Browser (see
 *  `PanelSessionState`'s doc), so identity can't be forced at the session
 *  level the way `normalizePanelIdentity` does for desktop: that would flip
 *  the full-page Browser to a mobile UA too. Tracked per-`WebContents`
 *  instead, so `normalizePanelIdentity`'s header rewrite can branch per tab.
 *
 *  This used to be done through the CDP `Emulation` domain (what Chrome
 *  DevTools' own device toolbar uses), which covers more ground —
 *  `navigator.userAgentData` in JS, not just headers — but attaching
 *  `webContents.debugger` at all turned out to cost more than it bought:
 *  Google's own sites are the most aggressive on the web about detecting an
 *  attached debugger and served a blank page instead of a mobile one, and
 *  closing a tab while a CDP session was still attached to it crashed the
 *  app outright. Plain header rewriting doesn't have either problem, at the
 *  cost of `navigator.userAgentData` still reading as the real desktop
 *  platform in JS — immaterial here since content negotiation is a
 *  server-side, header-driven decision. */
const mobileWebContents = new WeakSet<WebContents>();

/** Keyed by partition: two independent panel sessions (the full-page browser
 *  and the floating overlay) each need their own UA/Sec-CH-UA hardening pass. */
const identityNormalizedPartitions = new Set<string>();
function normalizePanelIdentity(ses: Session, partition: string) {
  if (identityNormalizedPartitions.has(partition)) return;
  identityNormalizedPartitions.add(partition);
  // Resolved here rather than at import: `userAgentFallback` reflects the app
  // name, which is only final once main has configured the app object.
  const CHROME_UA = chromeUserAgent();
  const MOBILE_UA = mobileUserAgent();
  const SEC_CH_UA = secChUa();
  ses.setUserAgent(CHROME_UA);
  // Separate from the ad-block listener on purpose: this is not part of
  // blocking and must survive `disableAdBlock()`, which drops *all*
  // onBeforeRequest listeners on this session.
  ses.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
    const isMobile = !!details.webContents && mobileWebContents.has(details.webContents);
    const headers = details.requestHeaders;
    headers["User-Agent"] = isMobile ? MOBILE_UA : CHROME_UA;
    // Only rewrite a hint when Chromium already chose to send it — adding one
    // where Chromium withheld it (non-secure origins) would be its own
    // anomaly.
    if (headers["sec-ch-ua"] !== undefined) headers["sec-ch-ua"] = SEC_CH_UA;
    if (headers["Sec-CH-UA"] !== undefined) headers["Sec-CH-UA"] = SEC_CH_UA;
    if (isMobile) {
      if (headers["sec-ch-ua-mobile"] !== undefined) headers["sec-ch-ua-mobile"] = SEC_CH_UA_MOBILE;
      if (headers["Sec-CH-UA-Mobile"] !== undefined) headers["Sec-CH-UA-Mobile"] = SEC_CH_UA_MOBILE;
      if (headers["sec-ch-ua-platform"] !== undefined) headers["sec-ch-ua-platform"] = SEC_CH_UA_PLATFORM_MOBILE;
      if (headers["Sec-CH-UA-Platform"] !== undefined) headers["Sec-CH-UA-Platform"] = SEC_CH_UA_PLATFORM_MOBILE;
    }
    callback({ requestHeaders: headers });
  });
}

/** Makes one tab's `WebContents` identify as a phone — see `mobileWebContents`'s
 *  doc for why this is header rewriting rather than CDP emulation. Setting
 *  the per-`WebContents` UA (in addition to the session-level header rewrite
 *  above) keeps `navigator.userAgent` in the page's own JS consistent with
 *  what went out on the wire. Synchronous and immediate — unlike the old CDP
 *  version, there's no async setup a navigation could race ahead of. */
function enableMobileEmulation(wc: WebContents): void {
  mobileWebContents.add(wc);
  wc.setUserAgent(mobileUserAgent());
}

/** Ad/tracker blocking for the panel session. The matching engine lives in
 *  the Rust `tanwords` core sidecar (the `adblock_check` RPC, built on
 *  Brave's `adblock` crate); this main process only intercepts requests — an
 *  Electron-only API the sidecar can't reach — and asks the sidecar whether
 *  to block each subresource. Cosmetic hiding is a separate path — see
 *  `registerCosmeticPreload`. Fails open with a short timeout + an LRU cache,
 *  so a slow/down sidecar never stalls a page. */
function panelSession(partition: string) {
  return session.fromPartition(partition);
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

/** Ad-block/cosmetics state that must be shared by every manager instance
 *  running on the same session partition — the full-page Browser and the
 *  floating overlay now (deliberately) share `PANEL_PARTITION` so a login on
 *  one carries over to the other, but Electron's `webRequest.onBeforeRequest`
 *  only accepts ONE handler per session: if this stayed per-instance, the
 *  second manager's `enableAdBlock()`/`disableAdBlock()` would silently
 *  clobber the first's listener. Keying by partition instead of by instance
 *  makes registration (and the toggle) naturally idempotent/shared. */
interface PanelSessionState {
  /** Defaults on; the renderer pushes the persisted preference
   *  (`browser_set_adblock_enabled`) once its settings hydrate. */
  adBlockEnabled: boolean;
  adBlockRegistered: boolean;
  cosmeticPreloadId: string | null;
  /** Returns the sidecar's localhost port + session token. Set from
   *  index.ts once the SidecarSupervisor is created. */
  getBackend: (() => Promise<{ port: number; token: string }>) | null;
  /** Cap on the per-URL decision cache. Ad beacons repeat across a session;
   *  caching avoids a roundtrip per repeat. */
  adBlockCache: Map<string, { block: boolean; redirect?: string }>;
  /** Per-URL cosmetic resources (CSS selectors + injected script), prewarmed
   *  at navigation start so the preload's sync IPC never blocks on a sidecar
   *  roundtrip. */
  cosmeticsCache: Map<string, { stylesheet: string; script: string }>;
  /** Session-only visited-page log, shared across every manager on this
   *  partition for the same reason the rest of this state is partition-keyed
   *  — a visit in the floating overlay belongs to the same browsing history
   *  as one in the full-page Browser. Not persisted: cleared on app restart
   *  by construction (nothing writes it to disk), and `clearHistory()` wipes
   *  it on demand. Oldest-first; `getHistory()` reverses for display. */
  history: HistoryEntry[];
}
export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}
/** Cap on the history log — a long session shouldn't grow this unboundedly. */
const MAX_HISTORY = 500;
const panelSessionStates = new Map<string, PanelSessionState>();
/** Exported for browserPanel.test.ts, which needs to seed/inspect a specific
 *  partition's state directly — not part of the manager's public API. */
export function stateFor(partition: string): PanelSessionState {
  let s = panelSessionStates.get(partition);
  if (!s) {
    s = {
      adBlockEnabled: true,
      adBlockRegistered: false,
      cosmeticPreloadId: null,
      getBackend: null,
      adBlockCache: new Map(),
      cosmeticsCache: new Map(),
      history: [],
    };
    panelSessionStates.set(partition, s);
  }
  return s;
}
const ADBLOCK_CACHE_MAX = 2000;
const ADBLOCK_TIMEOUT_MS = 800;
const COSMETICS_CACHE_MAX = 500;

/** Which partition a given tab's WebContents belongs to — populated in
 *  `buildView()`. Lets the shared `adblock:cosmetics` sync channel (one
 *  `ipcMain.on` handler, fed by every manager's cosmetic preload) resolve the
 *  right partition's state without needing to know which manager instance
 *  the WebContents came from. */
const webContentsPartition = new WeakMap<WebContents, string>();

/** Answers the cosmetic preload's sync `adblock:cosmetics` query for
 *  whichever WebContents sent it — see `registerCosmeticPreload`'s doc for
 *  why this has to run in the isolated-preload/main-world-injection shape it
 *  does. Exported for `ipc.ts`'s single shared `ipcMain.on` handler. */
export function cosmeticsForWebContents(wc: WebContents, url: string): { stylesheet: string; script: string } {
  const partition = webContentsPartition.get(wc);
  if (!partition) return { stylesheet: "", script: "" };
  return cosmeticsFor(partition, url, wc);
}

/** Same as `cosmeticsForWebContents`, but with the partition given directly
 *  rather than resolved from a real tab's WebContents — what
 *  `cosmeticsForWebContents` delegates to, and what browserPanel.test.ts
 *  exercises directly with mock WebContents objects. */
export function cosmeticsFor(partition: string, url: string, wc: WebContents): { stylesheet: string; script: string } {
  const state = stateFor(partition);
  if (!state.adBlockEnabled) return { stylesheet: "", script: "" };
  // Scriptlets (`json-prune`/`set-constant`, per this module's CSP-stripping
  // doc) are written and tested against `www.youtube.com`'s desktop player.
  // Spoofing a mobile UA (see `enableMobileEmulation`) routes YouTube to the
  // entirely different `m.youtube.com` codebase, where the same scriptlet
  // patched the wrong target and recursed into itself (`Uncaught RangeError:
  // Maximum call stack size exceeded` in an injected scriptlet, reported from
  // the floating overlay specifically) — blanking the page. CSS-based
  // cosmetic hiding is unaffected by codebase differences (just selectors),
  // so only scriptlets are dropped for mobile tabs, not the whole feature.
  const stripScript = mobileWebContents.has(wc);
  const hit = state.cosmeticsCache.get(url);
  if (hit) return stripScript ? { stylesheet: hit.stylesheet, script: "" } : hit;
  void fetchCosmetics(partition, url).then((c) => {
    if (!c) return;
    // Re-check the toggle: this resolves a sidecar roundtrip later, and the
    // user may have switched blocking off in between. Without this the late
    // injection still fires, and it refills the cache `disableAdBlock` had
    // just cleared.
    if (!state.adBlockEnabled) return;
    rememberCosmetics(state, url, c);
    // The preload already ran and found nothing; a late executeJavaScript
    // injection still hides elements (CSS), and scriptlets are best-effort.
    const js = buildCosmeticInjectionJs(stripScript ? { stylesheet: c.stylesheet, script: "" } : c);
    if (!js) return;
    // The tab may have been closed or LRU-discarded during the roundtrip.
    // Calling into a destroyed WebContents throws *synchronously*, so the
    // trailing .catch() would never be attached and it would surface as an
    // unhandled rejection in main rather than being swallowed here.
    try {
      if (wc.isDestroyed()) return;
      void wc.executeJavaScript(js, true).catch(() => {});
    } catch {
      // Destroyed between the check and the call.
    }
  });
  return { stylesheet: "", script: "" };
}

async function fetchCosmetics(partition: string, url: string): Promise<{ stylesheet: string; script: string } | null> {
  const state = stateFor(partition);
  if (!state.getBackend) return null;
  try {
    const { port, token } = await state.getBackend();
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

function recordHistory(state: PanelSessionState, url: string): void {
  if (!url || url === "about:blank") return;
  state.history.push({ url, title: "", visitedAt: Date.now() });
  if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY);
}

function updateHistoryTitle(state: PanelSessionState, url: string, title: string): void {
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (state.history[i].url === url) {
      state.history[i].title = title;
      return;
    }
  }
}

function rememberCosmetics(state: PanelSessionState, url: string, c: { stylesheet: string; script: string }) {
  if (state.cosmeticsCache.size >= COSMETICS_CACHE_MAX) {
    const oldest = state.cosmeticsCache.keys().next().value;
    if (oldest) state.cosmeticsCache.delete(oldest);
  }
  state.cosmeticsCache.set(url, c);
}

/** Ad-block/cosmetics/session-hardening helpers below are module-level
 *  functions parametrized by partition — not manager instance methods —
 *  because private browsing means a *single* manager instance now has tabs
 *  spanning two different partitions (its normal one and PRIVATE_PARTITION),
 *  and every one of these operates on partition-scoped state (PanelSessionState)
 *  regardless of which manager/tab triggered it. */

async function askSidecar(partition: string, url: string, sourceUrl: string, resourceType: string): Promise<{ block: boolean; redirect?: string } | null> {
  const state = stateFor(partition);
  if (!state.getBackend) return null;
  try {
    const { port, token } = await state.getBackend();
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

function rememberDecision(state: PanelSessionState, key: string, dec: { block: boolean; redirect?: string }) {
  if (state.adBlockCache.size >= ADBLOCK_CACHE_MAX) {
    const oldest = state.adBlockCache.keys().next().value;
    if (oldest) state.adBlockCache.delete(oldest);
  }
  state.adBlockCache.set(key, dec);
}

/** Writes the cosmetic-injection preload to userData and registers it on the
 *  given partition's session — see the class's old doc (moved here) for why
 *  the preload has to work the way it does. */
async function registerCosmeticPreload(partition: string): Promise<void> {
  const state = stateFor(partition);
  if (state.cosmeticPreloadId) return;
  // `setBackendGetter` (index.ts) calls this at module top-level, before
  // `app.whenReady()` — both `app.getPath` and `session.fromPartition` throw
  // if the app isn't ready yet. Waiting here (a no-op once already ready)
  // means every caller gets a working registration on the first try instead
  // of silently failing and relying on a later `enableAdBlock()` call (the
  // first real tab's) to retry it.
  await app.whenReady();
  const preloadPath = path.join(app.getPath("userData"), "adblock-preload.cjs");
  try {
    await fs.writeFile(preloadPath, COSMETIC_PRELOAD_SOURCE, "utf-8");
    const id = panelSession(partition).registerPreloadScript({ type: "frame", filePath: preloadPath });
    state.cosmeticPreloadId = id;
  } catch (e) {
    console.warn("[browser] cosmetic preload registration failed:", e);
  }
}

/** Exported for browserPanel.test.ts, which drives ad-block decisions
 *  directly against a stub session rather than through a manager instance —
 *  not part of the public module API otherwise. */
export async function enableAdBlock(partition: string): Promise<void> {
  const state = stateFor(partition);
  if (state.adBlockRegistered) return;
  if (!state.adBlockEnabled || !state.getBackend) return;
  void registerCosmeticPreload(partition);
  const ses = panelSession(partition);
  ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
    if (!state.adBlockEnabled || details.resourceType !== "mainFrame") { callback({}); return; }
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
    if (!state.adBlockEnabled) { callback({}); return; }

    const url = details.url;
    const sourceUrl = documentUrlFor(details);
    const key = `${details.resourceType}|${sourceOriginOf(sourceUrl)}|${url}`;
    const cached = state.adBlockCache.get(key);
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
      if (dec) rememberDecision(state, key, dec);
      if (dec?.redirect) callback({ redirectURL: dec.redirect });
      else if (dec?.block) callback({ cancel: true });
      else callback({});
    };
    // Fail-open after a short timeout: a blocker must never stall a page.
    const timer = setTimeout(() => settle(null), ADBLOCK_TIMEOUT_MS);
    askSidecar(partition, url, sourceUrl, details.resourceType)
      .then((dec) => { clearTimeout(timer); settle(dec); })
      .catch(() => { clearTimeout(timer); settle(null); });
  });
  state.adBlockRegistered = true;
}

function disableAdBlock(partition: string): void {
  const state = stateFor(partition);
  // Drop the cosmetics prewarm cache first, unconditionally — the listener
  // below may never have been registered (e.g. a toggle before the first
  // enable landed), but stale cosmetics must not survive a re-enable.
  state.cosmeticsCache.clear();
  if (!state.adBlockRegistered) return;
  // onBeforeRequest(null) removes *all* listeners for that event on the
  // session — fine here, the panel session has no other onBeforeRequest
  // listener (the app shell's youtubeEmbed handler is on defaultSession).
  panelSession(partition).webRequest.onBeforeRequest(null);
  panelSession(partition).webRequest.onHeadersReceived(null);
  state.adBlockRegistered = false;
  if (state.cosmeticPreloadId) {
    try { panelSession(partition).unregisterPreloadScript(state.cosmeticPreloadId); } catch {}
    state.cosmeticPreloadId = null;
  }
}

/** Prewarm cosmetics for an about-to-load URL so the preload's sync IPC
 *  (which must never block) finds a hit. Fires on main-frame navigations. */
function prewarmCosmetics(partition: string, url: string): void {
  const state = stateFor(partition);
  if (!state.adBlockEnabled || state.cosmeticsCache.has(url)) return;
  void fetchCosmetics(partition, url).then((c) => {
    if (c) rememberCosmetics(state, url, c);
  });
}

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
      stateFor(partition).adBlockEnabled = enabled;
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
