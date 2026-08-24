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
import { buildCosmeticInjectionJs, COSMETIC_PRELOAD_SOURCE, sourceOriginOf, stripTrustedTypes } from "./browserPanelInjection";
export { COSMETIC_PRELOAD_SOURCE, stripTrustedTypes } from "./browserPanelInjection";
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
export function hardenPanelSession(partition: string) {
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
export function enableMobileEmulation(wc: WebContents): void {
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
/** Ad-block/cosmetics state that must be shared by every manager instance
 *  running on the same session partition — the full-page Browser and the
 *  floating overlay now (deliberately) share `PANEL_PARTITION` so a login on
 *  one carries over to the other, but Electron's `webRequest.onBeforeRequest`
 *  only accepts ONE handler per session: if this stayed per-instance, the
 *  second manager's `enableAdBlock()`/`disableAdBlock()` would silently
 *  clobber the first's listener. Keying by partition instead of by instance
 *  makes registration (and the toggle) naturally idempotent/shared. */
export interface PanelSessionState {
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
export const webContentsPartition = new WeakMap<WebContents, string>();

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

export function recordHistory(state: PanelSessionState, url: string): void {
  if (!url || url === "about:blank") return;
  state.history.push({ url, title: "", visitedAt: Date.now() });
  if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY);
}

export function updateHistoryTitle(state: PanelSessionState, url: string, title: string): void {
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
export async function registerCosmeticPreload(partition: string): Promise<void> {
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

export function disableAdBlock(partition: string): void {
  const state = stateFor(partition);
  // Drop both caches first, unconditionally — the listener below may never
  // have been registered (e.g. a toggle before the first enable landed), but
  // decisions made by an old filter engine/configuration must not survive a
  // re-enable and keep breaking a resource the refreshed rules now allow.
  state.cosmeticsCache.clear();
  state.adBlockCache.clear();
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
export function prewarmCosmetics(partition: string, url: string): void {
  const state = stateFor(partition);
  if (!state.adBlockEnabled || state.cosmeticsCache.has(url)) return;
  void fetchCosmetics(partition, url).then((c) => {
    if (c) rememberCosmetics(state, url, c);
  });
}
