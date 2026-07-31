/** Serves the built renderer from a custom `app://` scheme instead of
 *  `file://` (migration plan §9.1). `file://` gives the page an opaque
 *  origin — localStorage silently no-ops — and breaks
 *  `documentWorkerClient.ts`'s `new Worker(new URL(...), { type: "module" })`.
 *
 *  Must be registered as privileged *before* `app.whenReady()` (that part
 *  happens at import time, at the bottom of this file); the actual request
 *  handler is installed after ready, from `registerAppProtocolHandler`. */
import { app, net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const APP_SCHEME = "app";
/** Fixed host in every `app://` URL we produce — see `rendererEntryUrl`. */
const APP_HOST = "app";

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** The renderer build output (see vite.config.ts's `build.outDir`). */
function rendererDir(): string {
  // Packaged: out/renderer sits next to out/main inside the asar/app dir.
  // Unpackaged: same relative layout, rooted at the project directory.
  return path.join(app.getAppPath(), "out", "renderer");
}

export function rendererEntryUrl(): string {
  return `${APP_SCHEME}://${APP_HOST}/index.html`;
}

export function registerAppProtocolHandler() {
  const root = rendererDir();

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "" || pathname === "/") pathname = "/index.html";

    const filePath = path.normalize(path.join(root, pathname));
    // Reject path traversal outside the renderer output directory.
    if (!filePath.startsWith(root)) {
      return new Response("forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}
