/** End-to-end test of the updater path with nothing mocked except the preload
 *  global itself — so it exercises the real updaterStore -> ipc/updater ->
 *  ipc/events chain, including the event *names* and payload *shapes* the main
 *  process actually sends (see electron/main/updater.ts's emitEvent calls and
 *  broadcastEvent in electron/main/index.ts).
 *
 *  updaterStore.test.ts mocks @/ipc/updater, so it would not notice if the two
 *  halves of that contract drifted apart. This would. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetForTests } from "./events";

type EventHandler = (payload: any) => void;

/** Stands in for the Electron main process: records channel calls and lets a
 *  test push events back the way `broadcastEvent` does. */
function installFakeHost() {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const handlers = new Set<EventHandler>();
  const responses = new Map<string, (payload: unknown) => unknown>();

  const backend = Promise.reject(new Error("no sidecar in tests"));
  backend.catch(() => {});

  window.tanwords = {
    backend,
    refreshBackend: () => backend,
    call: async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload });
      const responder = responses.get(channel);
      if (!responder) throw new Error(`unexpected channel ${channel}`);
      return responder(payload);
    },
    on: (channel: string, handler: EventHandler) => {
      // ipc/events subscribes to the single "event" forwarding channel.
      if (channel !== "event") return () => {};
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };

  return {
    calls,
    respond: (channel: string, fn: (payload: unknown) => unknown) => responses.set(channel, fn),
    /** Exactly the envelope electron/main/index.ts's broadcastEvent sends. */
    emitFromMain: (name: string, payload: unknown) => {
      for (const h of [...handlers]) h({ name, payload });
    },
  };
}

let host: ReturnType<typeof installFakeHost>;

beforeEach(() => {
  vi.resetModules();
  __resetForTests();
  host = installFakeHost();
});

describe("updater IPC contract", () => {
  it("maps main's UpdateInfoPayload onto the store's available state", async () => {
    host.respond("updater:check", () => ({
      version: "1.2.0",
      date: "2026-07-30T00:00:00Z",
      notes: "release notes here",
    }));

    const { useUpdaterStore } = await import("@/store/updaterStore");
    await useUpdaterStore.getState().checkForUpdate();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("available");
    expect(s.version).toBe("1.2.0");
    // `notes`, not Tauri's `body` — main sends `notes`.
    expect(s.notes).toBe("release notes here");
    expect(host.calls.map((c) => c.channel)).toContain("updater:check");
  });

  it("treats main's null (no feed / up to date) as upToDate", async () => {
    host.respond("updater:check", () => null);
    const { useUpdaterStore } = await import("@/store/updaterStore");
    await useUpdaterStore.getState().checkForUpdate();
    expect(useUpdaterStore.getState().status).toBe("upToDate");
  });

  it("drives progress from the real updater:progress event payload", async () => {
    host.respond("updater:check", () => ({ version: "1.2.0" }));

    const { useUpdaterStore } = await import("@/store/updaterStore");
    await useUpdaterStore.getState().checkForUpdate();
    expect(useUpdaterStore.getState().status).toBe("available");

    // Emit while the download is in flight, the way electron-updater's
    // "download-progress" handler does.
    host.respond("updater:downloadAndInstall", () => {
      host.emitFromMain("updater:progress", { percent: 42.7, transferred: 427, total: 1000 });
      host.emitFromMain("updater:progress", { percent: 100, transferred: 1000, total: 1000 });
      return null;
    });

    await useUpdaterStore.getState().downloadAndInstall();

    const s = useUpdaterStore.getState();
    expect(s.progress).toBe(100);
    expect(s.status).toBe("ready");
  });

  it("unsubscribes from progress once the download settles", async () => {
    host.respond("updater:check", () => ({ version: "1.2.0" }));
    const { useUpdaterStore } = await import("@/store/updaterStore");
    await useUpdaterStore.getState().checkForUpdate();

    host.respond("updater:downloadAndInstall", () => {
      host.emitFromMain("updater:progress", { percent: 50, transferred: 500, total: 1000 });
      return null;
    });
    await useUpdaterStore.getState().downloadAndInstall();
    expect(useUpdaterStore.getState().progress).toBe(50);

    // A late straggler must not move a store that has already landed on ready.
    host.emitFromMain("updater:progress", { percent: 99, transferred: 990, total: 1000 });
    expect(useUpdaterStore.getState().progress).toBe(50);
    expect(useUpdaterStore.getState().status).toBe("ready");
  });

  it("restart goes through the process:relaunch channel", async () => {
    host.respond("process:relaunch", () => null);
    const { useUpdaterStore } = await import("@/store/updaterStore");
    await useUpdaterStore.getState().restart();
    expect(host.calls.map((c) => c.channel)).toContain("process:relaunch");
  });
});
