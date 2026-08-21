/** Runtime host detection and the capability surface exposed to the UI.
 *
 * The Electron renderer gets `window.tanwords` from its preload. The web build
 * has no preload, so the same source tree can choose its backend transport and
 * hide desktop-only features at runtime without a second frontend.
 */

export type HostKind = "electron" | "web" | "test";

export interface HostCapabilities {
  desktop: boolean;
  auth: boolean;
  browser: boolean;
  music: boolean;
  /** Local shell / PTY terminal (desktop only). A sandboxed in-browser shell
   *  for the web build exists (`sandboxPtyTransport.ts`, restty engine only —
   *  see `TerminalWorkspace.tsx` and `TerminalEngineSwitch.tsx`) but is kept
   *  hidden behind this flag — no ssh/real network, not useful enough to
   *  surface. Gates the Tools-page Terminal tool. */
  terminal: boolean;
  /** DeepSeek Harness page (desktop only): spawns the local `dsh --profile
   *  web` host and embeds its Web UI in a native WebContentsView. The web
   *  build can't spawn a local process, so the nav entry is hidden there and
   *  the route falls back to Dashboard. */
  dsh: boolean;
  /** Optional UI lock. Desktop stores it per installation; Web stores a
   *  separate verifier on each authenticated account. */
  appLock: boolean;
  localDocs: boolean;
  mcp: boolean;
  tray: boolean;
  updater: boolean;
  nativeTts: boolean;
  /** Local speech-to-text for the push-to-talk voice assistant. Same reason
   *  as `nativeTts`: the `asr_*` commands only exist in the desktop-feature
   *  build of the Rust sidecar, not the web/server build. */
  nativeAsr: boolean;
}

export const DESKTOP_CAPABILITIES: HostCapabilities = {
  desktop: true,
  auth: false,
  browser: true,
  music: true,
  terminal: true,
  dsh: true,
  appLock: true,
  localDocs: true,
  mcp: true,
  tray: true,
  updater: true,
  nativeTts: true,
  nativeAsr: true,
};

export const WEB_CAPABILITIES: HostCapabilities = {
  desktop: false,
  auth: true,
  // Desktop-only. The web build has no native browser view, so the page could
  // only ever be an iframe fed by a server-side filtering proxy — which means
  // every embedded site sees the server's datacenter address instead of the
  // user's, and treats a whole deployment's traffic as coming from one client.
  // Google/YouTube answer that with sign-in walls and bot interstitials, and
  // sustained proxying risks the address being blocked outright. Browsing
  // belongs on the desktop app, where it goes out over the user's own
  // connection.
  browser: false,
  music: false,
  terminal: false,
  dsh: false,
  appLock: true,
  localDocs: false,
  mcp: false,
  tray: false,
  updater: false,
  nativeTts: false,
  nativeAsr: false,
};

export function detectHostKind(): HostKind {
  if (typeof window === "undefined") return "test";
  return window.tanwords ? "electron" : "web";
}

export const hostKind = detectHostKind();
export const isDesktopHost = hostKind === "electron";
export const isWebHost = hostKind === "web";
export const hostCapabilities = isDesktopHost ? DESKTOP_CAPABILITIES : WEB_CAPABILITIES;
