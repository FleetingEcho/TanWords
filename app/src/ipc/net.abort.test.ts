/** Aborting mid-request must reject the caller and reach the main process —
 *  including while the request is still waiting for response headers, which is
 *  where an AI completion spends most of its life. A regression here is
 *  invisible in the UI except as a progress indicator whose cancel button does
 *  nothing (the caller's `finally` never runs), so it gets its own test. */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/platform", () => ({ isDesktopHost: true }));
vi.mock("@/platform/webClient", () => ({ webAuthFetch: async () => new Response("") }));

type EventHandler = (payload: any) => void;

function installFakeHost() {
  const calls: Array<{ channel: string; payload: any }> = [];
  const handlers = new Map<string, Set<EventHandler>>();

  const backend = Promise.reject(new Error("no sidecar in tests"));
  backend.catch(() => {});

  window.tanwords = {
    backend,
    refreshBackend: () => backend,
    // Deliberately never answers http:head — the request hangs exactly the way
    // a slow model does before its first token.
    call: async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload: payload as any });
      return undefined;
    },
    on: (channel: string, handler: EventHandler) => {
      const set = handlers.get(channel) ?? new Set();
      set.add(handler);
      handlers.set(channel, set);
      return () => set.delete(handler);
    },
  } as any;

  return { calls, handlers };
}

let host: ReturnType<typeof installFakeHost>;

beforeEach(() => {
  vi.resetModules();
  host = installFakeHost();
});

describe("netFetch abort", () => {
  it("rejects with AbortError and tells main to abort when cancelled before headers arrive", async () => {
    const { netFetch } = await import("./net");
    const controller = new AbortController();

    const pending = netFetch("https://api.example.com/v1/messages", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });

    // Let the fetch call go out before cancelling.
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(host.calls.map((c) => c.channel)).toContain("http:abort");
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const { netFetch } = await import("./net");
    const controller = new AbortController();
    controller.abort();

    await expect(
      netFetch("https://api.example.com/v1/messages", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(host.calls.map((c) => c.channel)).not.toContain("http:fetch");
  });

  it("still resolves normally when nothing aborts", async () => {
    const { netFetch } = await import("./net");
    const pending = netFetch("https://api.example.com/v1/messages", { method: "POST", body: "{}" });

    await Promise.resolve();
    const id = host.calls.find((c) => c.channel === "http:fetch")!.payload.id;
    for (const h of host.handlers.get(`http:head:${id}`) ?? []) {
      h({ status: 200, statusText: "OK", headers: {} });
    }

    const response = await pending;
    expect(response.status).toBe(200);
  });
});
