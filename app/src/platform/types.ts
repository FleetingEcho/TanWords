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
  localDocs: boolean;
  mcp: boolean;
  tray: boolean;
  updater: boolean;
  nativeTts: boolean;
}

export const DESKTOP_CAPABILITIES: HostCapabilities = {
  desktop: true,
  auth: false,
  browser: true,
  music: true,
  localDocs: true,
  mcp: true,
  tray: true,
  updater: true,
  nativeTts: true,
};

export const WEB_CAPABILITIES: HostCapabilities = {
  desktop: false,
  auth: true,
  browser: false,
  music: false,
  localDocs: false,
  mcp: false,
  tray: false,
  updater: false,
  nativeTts: false,
};

export function detectHostKind(): HostKind {
  if (typeof window === "undefined") return "test";
  return window.tanwords ? "electron" : "web";
}

export const hostKind = detectHostKind();
export const isDesktopHost = hostKind === "electron";
export const isWebHost = hostKind === "web";
export const hostCapabilities = isDesktopHost ? DESKTOP_CAPABILITIES : WEB_CAPABILITIES;
