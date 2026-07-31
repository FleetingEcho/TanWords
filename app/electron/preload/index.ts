/** Exposes `window.tanwords` to the renderer. `contextIsolation: true` +
 *  `sandbox: true` on the hosting BrowserWindow (see electron/main/index.ts),
 *  so this is the *only* bridge between the untrusted renderer and Node/
 *  Electron — everything else (all 150+ sidecar commands) goes straight from
 *  the renderer to the Rust sidecar over HTTP, bypassing main entirely. See
 *  app/src/ipc/host.ts for the shape this is written against. */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tanwords", {
  /** Resolves once the sidecar handshake completes. Main's "tanwords:backend"
   *  handler doesn't reply until it has a handshake, so this single invoke()
   *  call naturally blocks a renderer that mounts before the sidecar is
   *  ready (migration plan §8's "startup ordering inverts") — no extra
   *  queuing needed on either side. */
  backend: ipcRenderer.invoke("tanwords:backend"),

  call: (channel: string, payload?: unknown) => ipcRenderer.invoke("tanwords:call", channel, payload),

  /** `src/ipc/events.ts` only ever calls this as `on("event", ({name,
   *  payload}) => ...)` — a single subscription to the one forwarding
   *  channel, receiving the `{name, payload}` envelope main broadcasts
   *  (see `broadcastEvent` in electron/main/index.ts). Generic over the
   *  channel name anyway, in case that changes. */
  on: (channel: string, handler: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => handler(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
});
