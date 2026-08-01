/** The preload surface (`window.tanwords`), typed in one place.
 *
 *  The main window runs with `contextIsolation: true` + `sandbox: true`, so
 *  this object — injected by electron/preload/index.ts — is the *only* channel
 *  between the renderer and Electron. Everything heavy (all 150+ backend
 *  commands) goes straight to the Rust sidecar over HTTP instead, bypassing
 *  main entirely; see ./backend.ts. */

export type TanwordsHost = {
  /** Resolves once the sidecar has handshaken. */
  backend: Promise<{ port: number; token: string }>;
  /** Resolves with the handshake of the current sidecar process. */
  refreshBackend: () => Promise<{ port: number; token: string }>;
  /** Main-process commands: browser panel, dialogs, shell, clipboard, ... */
  call: (channel: string, payload?: unknown) => Promise<any>;
  on: (channel: string, handler: (payload: any) => void) => () => void;
};

declare global {
  interface Window {
    tanwords?: TanwordsHost;
  }
}

/** The preload global, or a thrown error. Every main-process call goes through
 *  here so a missing preload fails loudly and identically everywhere. */
export function host(): TanwordsHost {
  const injected = window.tanwords;
  if (!injected) throw new Error("electron preload is missing (window.tanwords)");
  return injected;
}

/** Invoke a main-process channel. Handlers live in electron/main/ipc.ts. */
export function callMain<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  return host().call(channel, payload) as Promise<T>;
}

export {};
