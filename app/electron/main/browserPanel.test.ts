import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
}));

import { BrowserPanelManager } from "./browserPanel";

/** Drives the manager through its private state: `hide()` is only reachable
 *  once a tab is attached, and building that up through the public API would
 *  need a real window and a real renderer process. */
function setup(capturePage: () => Promise<{ toDataURL: () => string }>) {
  const removeChildView = vi.fn();
  const manager = new BrowserPanelManager();
  const internals = manager as unknown as {
    win: unknown;
    tabs: Map<string, unknown>;
    attachedId: string | null;
  };
  internals.win = { contentView: { removeChildView, addChildView: vi.fn() } };
  internals.tabs = new Map([
    ["t1", { id: "t1", view: { webContents: { capturePage } }, url: "", title: "", atHome: false, usedAt: 1 }],
  ]);
  internals.attachedId = "t1";
  return { manager, removeChildView };
}

const neverResolves = () => new Promise<{ toDataURL: () => string }>(() => {});

describe("BrowserPanelManager.hide", () => {
  // The regression: `hide()` used to always await capturePage() *before*
  // detaching, so leaving the browser page while a heavy page was still
  // loading left it composited over the next screen for as long as the capture
  // took — a second or more. Against that version this test never resolves.
  it("detaches immediately when no snapshot was asked for", async () => {
    const capturePage = vi.fn(neverResolves);
    const { manager, removeChildView } = setup(capturePage);

    await expect(manager.hide(false)).resolves.toBeNull();

    expect(removeChildView).toHaveBeenCalledTimes(1);
    expect(capturePage).not.toHaveBeenCalled();
  });

  it("defaults to not capturing, so a caller that forgets cannot reintroduce the stall", async () => {
    const capturePage = vi.fn(neverResolves);
    const { manager, removeChildView } = setup(capturePage);

    await expect(manager.hide()).resolves.toBeNull();

    expect(removeChildView).toHaveBeenCalledTimes(1);
    expect(capturePage).not.toHaveBeenCalled();
  });

  // The modal case still needs the still frame, and paying the capture there is
  // the point — the page has to look like it stepped aside, not vanished.
  it("returns a still frame when one was asked for", async () => {
    const capturePage = vi.fn(async () => ({ toDataURL: () => "data:image/png;base64,AAA" }));
    const { manager, removeChildView } = setup(capturePage);

    await expect(manager.hide(true)).resolves.toBe("data:image/png;base64,AAA");

    expect(capturePage).toHaveBeenCalledTimes(1);
    expect(removeChildView).toHaveBeenCalledTimes(1);
  });

  it("still detaches when the capture fails", async () => {
    const capturePage = vi.fn(async () => { throw new Error("capture failed"); });
    const { manager, removeChildView } = setup(capturePage);

    await expect(manager.hide(true)).resolves.toBeNull();

    expect(removeChildView).toHaveBeenCalledTimes(1);
  });
});

describe("BrowserPanelManager cosmetics", () => {
  function setup() {
    const manager = new BrowserPanelManager();
    const internals = manager as unknown as {
      cosmeticsCache: Map<string, { stylesheet: string; script: string }>;
    };
    internals.cosmeticsCache = new Map();
    return { manager, internals };
  }

  it("serves a prewarmed cache hit synchronously without touching the sidecar", () => {
    const { manager, internals } = setup();
    const wc = { executeJavaScript: vi.fn(async () => {}) };
    const cached = { stylesheet: ".ad{", script: "console.log(1)" };
    internals.cosmeticsCache.set("https://site.test/", cached);

    expect(manager.cosmeticsForSync("https://site.test/", wc as never)).toEqual(cached);
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
  });

  it("fails open on a miss and fills the cache + late-injects asynchronously", async () => {
    const { manager, internals } = setup();
    const wc = { executeJavaScript: vi.fn(async () => {}) };
    // No backend getter → fetchCosmetics returns null → nothing to inject.
    expect(manager.cosmeticsForSync("https://site.test/", wc as never)).toEqual({ stylesheet: "", script: "" });
    await new Promise((r) => setTimeout(r, 20));
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
    expect(internals.cosmeticsCache.size).toBe(0);
  });

  it("late-injects when a miss resolves with cosmetics", async () => {
    const { manager, internals } = setup();
    const wc = { executeJavaScript: vi.fn(async () => {}) };
    (manager as unknown as { getBackend: unknown }).getBackend = async () => ({ port: 1, token: "t" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stylesheet: ".ad{", script: "console.log(1)" }),
    }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    try {
      const miss = manager.cosmeticsForSync("https://site.test/", wc as never);
      expect(miss).toEqual({ stylesheet: "", script: "" });
      await new Promise((r) => setTimeout(r, 30));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(internals.cosmeticsCache.get("https://site.test/")).toEqual({ stylesheet: ".ad{", script: "console.log(1)" });
      expect(wc.executeJavaScript).toHaveBeenCalled();
    } finally {
      delete (globalThis as unknown as { fetch: unknown }).fetch;
    }
  });

  it("clears the cosmetics cache on disable", () => {
    const { manager, internals } = setup();
    internals.cosmeticsCache.set("https://site.test/", { stylesheet: ".ad{", script: "" });
    manager.setAdBlockEnabled(false);
    expect(internals.cosmeticsCache.size).toBe(0);
  });
});
