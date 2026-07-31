/** Serves the streaming HTTP channels that `src/ipc/net.ts` calls.
 *
 *  The renderer can't reach api.openai.com / api.anthropic.com itself (CORS),
 *  and can't use a plain request/response `invoke` either because the AI
 *  providers stream tokens. So: the request runs here on Electron's `net`
 *  module, and the response is pushed back to the calling webContents as a
 *  head event, then a chunk event per body chunk, then an end event.
 *
 *  Channel shape (must match src/ipc/net.ts):
 *    "http:fetch"      { id, url, init }   -> starts, resolves immediately
 *    "http:head:<id>"  { status, statusText, headers }
 *    "http:chunk:<id>" Uint8Array
 *    "http:end:<id>"   { error?: string }
 *    "http:abort"      { id }
 */
import { net, type WebContents } from "electron";

type FetchArgs = {
  id: number;
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
};

/** In-flight requests, so "http:abort" can cancel one. Keyed per webContents
 *  id as well as request id, since request ids restart at 1 on reload. */
const inFlight = new Map<string, AbortController>();

const key = (sender: WebContents, id: number) => `${sender.id}:${id}`;

export function startFetch(sender: WebContents, args: FetchArgs): void {
  const { id, url, init } = args;
  const controller = new AbortController();
  inFlight.set(key(sender, id), controller);

  // `send` is a no-op guard: a renderer can navigate or close mid-stream, and
  // sending to a destroyed webContents throws.
  const send = (channel: string, payload: unknown) => {
    if (!sender.isDestroyed()) sender.send(channel, payload);
  };

  const finish = (error?: string) => {
    inFlight.delete(key(sender, id));
    send(`http:end:${id}`, error ? { error } : {});
  };

  void (async () => {
    try {
      const response = await net.fetch(url, {
        method: init.method ?? "GET",
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });

      send(`http:head:${id}`, {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.body) {
        finish();
        return;
      }

      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) send(`http:chunk:${id}`, value);
      }
      finish();
    } catch (error) {
      // An abort is the caller's own doing, not a failure to report as one.
      if (controller.signal.aborted) finish();
      else finish(error instanceof Error ? error.message : String(error));
    }
  })();
}

export function abortFetch(sender: WebContents, id: number): void {
  inFlight.get(key(sender, id))?.abort();
}

/** Drop anything still running for a webContents that went away. Takes the id
 *  rather than the object because the caller has usually already lost it —
 *  reading properties off a destroyed WebContents throws. */
export function abortAllFor(senderId: number): void {
  const prefix = `${senderId}:`;
  for (const [k, controller] of inFlight) {
    if (k.startsWith(prefix)) {
      controller.abort();
      inFlight.delete(k);
    }
  }
}
