/** CORS-free HTTP, performed by Electron's `net.fetch` in the main process.
 *
 *  Why not plain `globalThis.fetch`: the renderer is subject to CORS, and the
 *  AI providers (`providers/openai.ts`, `providers/anthropic.ts`) call
 *  api.openai.com / api.anthropic.com directly with an API key.
 *
 *  Why not a plain request/response IPC call: both providers stream.
 *  `providers/openai.ts` pipes the response through `ThinkTagFilter` and yields
 *  tokens as they arrive, so `response.body` must be a live ReadableStream —
 *  buffering the whole completion would leave the chat UI blank until the
 *  model finished.
 *
 *  Contract with the main process (electron/main/ipc.ts):
 *    call("http:fetch", { id, url, init })  starts the request
 *    on("http:head:<id>")  -> { status, statusText, headers }
 *    on("http:chunk:<id>") -> ArrayBuffer
 *    on("http:end:<id>")   -> { error?: string }
 *    call("http:abort", { id })            on AbortSignal
 *
 *  Prefer a MessagePort per request if chunk throughput becomes a problem; the
 *  channel-per-id shape above is simpler and is fine for token streams. */

import { host } from "./host";
import { isDesktopHost } from "@/platform";
import { webAuthFetch } from "@/platform/webClient";

let nextId = 1;

/** Same signature as the DOM `fetch`, so provider code reads unchanged. */
export async function netFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  if (!isDesktopHost) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return webAuthFetch(url, init);
  }

  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const id = nextId++;
  const bridge = host();

  const head = await new Promise<{ status: number; statusText: string; headers: Record<string, string> }>(
    (resolve, reject) => {
      const offHead = bridge.on(`http:head:${id}`, resolve);
      const offEnd = bridge.on(`http:end:${id}`, ({ error }: { error?: string }) => {
        offHead();
        offEnd();
        if (error) reject(new Error(error));
      });
      bridge
        .call("http:fetch", {
          id,
          url,
          init: {
            method: init.method ?? "GET",
            headers: normalizeHeaders(init.headers),
            body: typeof init.body === "string" ? init.body : undefined,
          },
        })
        .catch(reject);
    },
  );

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // The stream can settle without these handlers being told: cancelling
      // the reader, or aborting the request, errors the controller here in the
      // renderer while the bridge keeps delivering whatever main had already
      // sent — including the `http:end` that follows main acknowledging the
      // abort. `enqueue()` and `close()` both throw once that has happened
      // ("Cannot close an errored readable stream"), and because this runs
      // inside a stream callback the throw surfaces as an uncaught error
      // rather than rejecting anything a caller can see.
      let settled = false;
      const offChunk = bridge.on(`http:chunk:${id}`, (chunk: ArrayBuffer) => {
        if (settled) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          settled = true;
        }
      });
      const offEnd = bridge.on(`http:end:${id}`, ({ error }: { error?: string }) => {
        offChunk();
        offEnd();
        if (settled) return;
        settled = true;
        try {
          if (error) controller.error(new Error(error));
          else controller.close();
        } catch {
          // Raced with a cancel/abort that already settled the stream.
        }
      });
    },
    cancel() {
      void bridge.call("http:abort", { id });
    },
  });

  init.signal?.addEventListener("abort", () => void bridge.call("http:abort", { id }));

  return new Response(body, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers,
  });
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers as Record<string, string>;
}
