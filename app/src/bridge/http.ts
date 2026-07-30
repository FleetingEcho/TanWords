/** Replaces `@tauri-apps/plugin-http`. The highest-risk bridge module.
 *
 *  Why this can't just be `globalThis.fetch`: the renderer is subject to CORS,
 *  and the AI providers (`providers/openai.ts`, `providers/anthropic.ts`) call
 *  api.openai.com / api.anthropic.com directly with an API key. Tauri's plugin
 *  bypassed CORS by doing the request in Rust. In Electron the equivalent is
 *  `net.fetch` in the main process.
 *
 *  Why it can't be a plain `ipcRenderer.invoke` either: both providers stream.
 *  `providers/openai.ts` pipes the response through `ThinkTagFilter` and yields
 *  tokens as they arrive, so `response.body` must be a live ReadableStream. A
 *  request/response IPC call would buffer the whole completion and the chat UI
 *  would sit blank until the model finished.
 *
 *  Contract with the main process:
 *    call("http:fetch", { id, url, init })  starts the request
 *    on("http:head:<id>")  -> { status, statusText, headers }
 *    on("http:chunk:<id>") -> Uint8Array
 *    on("http:end:<id>")   -> { error?: string }
 *    call("http:abort", { id })            on AbortSignal
 *
 *  Prefer a MessagePort per request if chunk throughput becomes a problem;
 *  the channel-per-id shape above is simpler and is fine for token streams. */

let nextId = 1;

export async function fetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const id = nextId++;
  const bridge = window.tanwords;
  if (!bridge) throw new Error("preload bridge missing");

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
      const offChunk = bridge.on(`http:chunk:${id}`, (chunk: ArrayBuffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      const offEnd = bridge.on(`http:end:${id}`, ({ error }: { error?: string }) => {
        offChunk();
        offEnd();
        error ? controller.error(new Error(error)) : controller.close();
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
