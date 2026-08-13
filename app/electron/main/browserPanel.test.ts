import { describe, expect, it, vi } from "vitest";

/** Holder the tests write to before driving the manager — the electron mock
 *  reads through it, so `session.fromPartition` can be swapped per test. */
const stub = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("electron", () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
  app: {
    userAgentFallback:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) TanWords/1.11.2 Chrome/140.0.0.0 Electron/43.2.0 Safari/537.36",
    getPath: () => "/tmp",
    whenReady: () => Promise.resolve(),
  },
  session: { fromPartition: (p: string) => (stub.session as { fromPartition(p: string): unknown }).fromPartition(p) },
}));

import { BrowserPanelManager, chromeUserAgent, cosmeticsFor, COSMETIC_PRELOAD_SOURCE, documentUrlFor, enableAdBlock, stateFor, stripTrustedTypes } from "./browserPanel";

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

describe("panel identity", () => {
  // Electron's default UA appends `TanWords/<ver>` and `Electron/<ver>` to
  // Chrome's. Both are "this is not a browser" tells that get Google's
  // sign-in and bot interstitials thrown at ordinary browsing, so the panel
  // presents the real Chromium underneath instead.
  it("strips the app and Electron product tokens from the User-Agent", () => {
    expect(chromeUserAgent()).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    );
  });
});

describe("documentUrlFor", () => {
  // The regression this replaced: `details.referrer` was passed as the filter
  // engine's source URL. It is empty for most fetch/XHR/beacon requests, and
  // with no source the engine cannot evaluate `$third-party` or `$domain=` —
  // which is most of EasyList, and all of uBO's YouTube rules.
  it("prefers the requesting frame's document URL", () => {
    expect(documentUrlFor({
      frame: { url: "https://site.test/page" },
      webContents: { getURL: () => "https://site.test/top" },
      referrer: "https://site.test/",
    })).toBe("https://site.test/page");
  });

  it("falls back to the tab's URL when the frame is gone", () => {
    expect(documentUrlFor({
      frame: null,
      webContents: { getURL: () => "https://site.test/top" },
      referrer: "https://site.test/",
    })).toBe("https://site.test/top");
  });

  it("survives a frame that throws on access", () => {
    const details = {
      get frame(): { url: string } { throw new Error("frame destroyed"); },
      webContents: { getURL: () => "https://site.test/top" },
      referrer: "https://site.test/",
    };
    expect(documentUrlFor(details)).toBe("https://site.test/top");
  });

  it("falls back to the referrer, then to empty", () => {
    expect(documentUrlFor({ referrer: "https://site.test/" })).toBe("https://site.test/");
    expect(documentUrlFor({ referrer: "" })).toBe("");
  });
});

type WebRequestListener = (details: Record<string, unknown>, cb: (r: unknown) => void) => void;

describe("BrowserPanelManager ad blocking", () => {
  // adBlockRegistered/getBackend now live in partition-keyed state shared
  // across manager instances (see PanelSessionState) — each test needs its
  // own partition, or the second test would find enableAdBlock() already a
  // no-op from the first test's registration.
  let blockingSeq = 0;

  /** Registers the real onBeforeRequest listener against a stub session and
   *  hands it back, so the decision path can be driven directly. */
  async function setupBlocking(sidecar: (body: unknown) => { block?: boolean; redirect?: string | null }) {
    const partition = `test-blocking-${++blockingSeq}`;
    stateFor(partition).getBackend = async () => ({ port: 1, token: "t" });

    let listener: WebRequestListener | null = null;
    let headersListener: WebRequestListener | null = null;
    stub.session = {
      fromPartition: () => ({
        webRequest: {
          onBeforeRequest: (_f: unknown, fn: WebRequestListener) => { listener = fn; },
          onHeadersReceived: (_f: unknown, fn: WebRequestListener) => { headersListener = fn; },
        },
        registerPreloadScript: () => "preload-1",
      }),
    };

    const calls: Array<Record<string, unknown>> = [];
    (globalThis as unknown as { fetch: unknown }).fetch = async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(body);
      return { ok: true, json: async () => sidecar(body) };
    };

    await enableAdBlock(partition);
    const ask = (details: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => listener!(details, resolve as (r: unknown) => void));
    const askHeaders = (details: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => headersListener!(details, resolve as (r: unknown) => void));
    return { ask, askHeaders, calls };
  }

  const details = (over: Record<string, unknown> = {}) => ({
    url: "https://cdn.test/widget.js",
    resourceType: "script",
    referrer: "",
    frame: { url: "https://publisher.test/article" },
    ...over,
  });

  it("passes the frame's document URL to the engine, not the empty referrer", async () => {
    const { ask, calls } = await setupBlocking(() => ({ block: true }));
    try {
      await expect(ask(details())).resolves.toEqual({ cancel: true });
      expect(calls[0].sourceUrl).toBe("https://publisher.test/article");
    } finally {
      delete (globalThis as unknown as { fetch: unknown }).fetch;
    }
  });

  // The engine's answer depends on the source document and resource type as
  // much as the URL: the same script is third-party on one site and
  // first-party on another. Keying the cache on the URL alone let whichever
  // page asked first decide it for every other page in the session.
  it("does not reuse one site's decision for another site", async () => {
    const { ask, calls } = await setupBlocking((body) =>
      ({ block: String((body as Record<string, unknown>).sourceUrl).startsWith("https://publisher.test") }));
    try {
      await expect(ask(details())).resolves.toEqual({ cancel: true });
      await expect(ask(details({ frame: { url: "https://cdn.test/own-page" } }))).resolves.toEqual({});
      expect(calls).toHaveLength(2);
      // Same site + type again: served from cache, no second roundtrip.
      await expect(ask(details())).resolves.toEqual({ cancel: true });
      expect(calls).toHaveLength(2);
    } finally {
      delete (globalThis as unknown as { fetch: unknown }).fetch;
    }
  });

  it("relaxes Trusted Types on documents only, leaving subresources alone", async () => {
    const { askHeaders } = await setupBlocking(() => ({ block: false }));
    try {
      const csp = ["script-src 'self'; require-trusted-types-for 'script'"];
      await expect(askHeaders({
        resourceType: "mainFrame",
        responseHeaders: { "content-security-policy": [...csp] },
      })).resolves.toEqual({
        responseHeaders: { "content-security-policy": ["script-src 'self'"] },
      });
      // A subresource is never injected into, so its policy is not touched.
      await expect(askHeaders({
        resourceType: "script",
        responseHeaders: { "content-security-policy": [...csp] },
      })).resolves.toEqual({});
    } finally {
      delete (globalThis as unknown as { fetch: unknown }).fetch;
    }
  });

  it("never blocks a top-level document load", async () => {
    const { ask, calls } = await setupBlocking(() => ({ block: true }));
    try {
      await expect(ask(details({ resourceType: "mainFrame" }))).resolves.toEqual({});
      expect(calls).toHaveLength(0);
    } finally {
      delete (globalThis as unknown as { fetch: unknown }).fetch;
    }
  });
});

describe("stripTrustedTypes", () => {
  // YouTube sends `require-trusted-types-for 'script'`, which makes assigning
  // a string to `script.textContent` throw — so uBO's scriptlets (the only
  // thing that stops video ads, since they share googlevideo with the video
  // itself) never executed. Only those two directives come out.
  it("removes the Trusted Types directives and nothing else", () => {
    const csp = "script-src 'self' 'nonce-abc'; require-trusted-types-for 'script'; trusted-types foo bar; frame-ancestors 'none'";
    const out = stripTrustedTypes(csp);
    expect(out).not.toMatch(/trusted-types/i);
    expect(out).toContain("script-src 'self' 'nonce-abc'");
    expect(out).toContain("frame-ancestors 'none'");
  });

  it("leaves a policy without Trusted Types untouched", () => {
    const csp = "default-src 'self'; img-src *";
    expect(stripTrustedTypes(csp)).toBe(csp);
  });

  // `trusted-types-shim` or any directive merely containing the substring is
  // a different directive and must survive.
  it("matches whole directive names only", () => {
    expect(stripTrustedTypes("x-trusted-types-report 1; require-trusted-types-for 'script'"))
      .toBe("x-trusted-types-report 1");
  });
});

describe("cosmetic preload source", () => {
  /** Evaluates the real preload string against a stub document, the way it
   *  runs in the isolated world. */
  function run(doc: Record<string, unknown>, cosmetics: unknown, observers: Array<(o: { disconnect(): void }) => void>) {
    const fakeRequire = () => ({ ipcRenderer: { sendSync: () => cosmetics } });
    const win = { self: 1, top: 1 };
    const MutationObserverStub = class {
      constructor(private cb: (m: unknown, o: { disconnect(): void }) => void) {}
      observe() { observers.push((o) => this.cb(null, o)); }
      disconnect() {}
    };
    new Function("window", "document", "location", "require", "MutationObserver", COSMETIC_PRELOAD_SOURCE)(
      win, doc, { href: "https://site.test/" }, fakeRequire, MutationObserverStub,
    );
  }

  function stubDoc(hasRoot: boolean) {
    const appended: Array<{ tag: string; text: string }> = [];
    const doc = {
      documentElement: hasRoot ? { appendChild: (n: { tag: string; text: string }) => appended.push(n) } : null,
      head: null,
      createElement: (tag: string) => ({ tag, text: "", set textContent(v: string) { this.text = v; }, get textContent() { return this.text; }, remove() {} }),
    };
    return { doc, appended };
  }

  // The regression: at document-start `documentElement` and `head` are both
  // null, so `(documentElement || head).appendChild(...)` threw and aborted
  // the whole preload — no scriptlets and no CSS hiding, on every site.
  it("does not throw when the document has no root yet, and injects once it appears", () => {
    const observers: Array<(o: { disconnect(): void }) => void> = [];
    const { doc, appended } = stubDoc(false);
    expect(() => run(doc as never, { stylesheet: ".ad", script: "x=1" }, observers)).not.toThrow();
    expect(appended).toHaveLength(0);
    expect(observers).toHaveLength(1);

    // The parser produces <html>; the observer fires and injection lands.
    (doc as { documentElement: unknown }).documentElement = { appendChild: (n: never) => appended.push(n) };
    let disconnected = false;
    observers[0]({ disconnect: () => { disconnected = true; } });
    expect(appended.map((n) => n.tag)).toEqual(["style", "script"]);
    expect(disconnected).toBe(true);
  });

  it("injects immediately when a root already exists", () => {
    const observers: Array<(o: { disconnect(): void }) => void> = [];
    const { doc, appended } = stubDoc(true);
    run(doc as never, { stylesheet: ".ad", script: "x=1" }, observers);
    expect(appended.map((n) => n.tag)).toEqual(["style", "script"]);
    expect(appended[0].text).toBe(".ad{display:none!important}");
    expect(observers).toHaveLength(0);
  });

  // A page that still enforces Trusted Types makes the script assignment
  // throw. The stylesheet was appended before that point and must survive.
  it("keeps the stylesheet when the scriptlet is refused", () => {
    const observers: Array<(o: { disconnect(): void }) => void> = [];
    const appended: Array<{ tag: string }> = [];
    const doc = {
      documentElement: { appendChild: (n: { tag: string }) => appended.push(n) },
      head: null,
      createElement: (tag: string) => ({
        tag,
        set textContent(v: string) { if (tag === "script") throw new TypeError("requires 'TrustedScript' assignment"); void v; },
        remove() {},
      }),
    };
    expect(() => run(doc as never, { stylesheet: ".ad", script: "x=1" }, observers)).not.toThrow();
    expect(appended.map((n) => n.tag)).toEqual(["style"]);
  });
});

describe("BrowserPanelManager cosmetics", () => {
  // Cosmetics state is keyed by session partition (shared across every
  // manager instance on that partition — see PanelSessionState's doc) rather
  // than living on the manager instance, so each test gets its own unique
  // partition to stay isolated from the others.
  let seq = 0;
  function setup() {
    const partition = `test-partition-${++seq}`;
    const manager = new BrowserPanelManager(partition);
    const state = stateFor(partition);
    return { manager, partition, state };
  }

  it("serves a prewarmed cache hit synchronously without touching the sidecar", () => {
    const { partition, state } = setup();
    const wc = { executeJavaScript: vi.fn(async () => {}) };
    const cached = { stylesheet: ".ad{", script: "console.log(1)" };
    state.cosmeticsCache.set("https://site.test/", cached);

    expect(cosmeticsFor(partition, "https://site.test/", wc as never)).toEqual(cached);
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
  });

  it("fails open on a miss and fills the cache + late-injects asynchronously", async () => {
    const { partition, state } = setup();
    const wc = { executeJavaScript: vi.fn(async () => {}) };
    // No backend getter → fetchCosmetics returns null → nothing to inject.
    expect(cosmeticsFor(partition, "https://site.test/", wc as never)).toEqual({ stylesheet: "", script: "" });
    await new Promise((r) => setTimeout(r, 20));
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
    expect(state.cosmeticsCache.size).toBe(0);
  });

  it("late-injects when a miss resolves with cosmetics", async () => {
    const { partition, state } = setup();
    const wc = { executeJavaScript: vi.fn(async () => {}), isDestroyed: () => false };
    state.getBackend = async () => ({ port: 1, token: "t" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stylesheet: ".ad{", script: "console.log(1)" }),
    }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    try {
      const miss = cosmeticsFor(partition, "https://site.test/", wc as never);
      expect(miss).toEqual({ stylesheet: "", script: "" });
      await new Promise((r) => setTimeout(r, 30));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(state.cosmeticsCache.get("https://site.test/")).toEqual({ stylesheet: ".ad{", script: "console.log(1)" });
      expect(wc.executeJavaScript).toHaveBeenCalled();
    } finally {
      delete (globalThis as unknown as { fetch: unknown }).fetch;
    }
  });

  it("does not inject a late result once blocking has been switched off", async () => {
    const { manager, partition, state } = setup();
    const wc = { executeJavaScript: vi.fn(async () => {}), isDestroyed: () => false };
    state.getBackend = async () => ({ port: 1, token: "t" });
    state.adBlockEnabled = true;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stylesheet: ".ad{", script: "console.log(1)" }),
    }));

    try {
      cosmeticsFor(partition, "https://site.test/", wc as never);
      // The user toggles the shield off while the sidecar roundtrip is in flight.
      manager.setAdBlockEnabled(false);
      await new Promise((r) => setTimeout(r, 30));
      expect(wc.executeJavaScript).not.toHaveBeenCalled();
      expect(state.cosmeticsCache.size).toBe(0);
    } finally {
      delete (globalThis as unknown as { fetch: unknown }).fetch;
    }
  });

  it("survives the tab being destroyed mid-roundtrip", async () => {
    const { partition, state } = setup();
    const wc = {
      isDestroyed: () => true,
      executeJavaScript: () => { throw new Error("Object has been destroyed"); },
    };
    state.getBackend = async () => ({ port: 1, token: "t" });
    state.adBlockEnabled = true;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stylesheet: ".ad{", script: "console.log(1)" }),
    }));
    const onRejection = vi.fn();
    process.on("unhandledRejection", onRejection);
    try {
      cosmeticsFor(partition, "https://site.test/", wc as never);
      await new Promise((r) => setTimeout(r, 40));
      expect(onRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onRejection);
      delete (globalThis as unknown as { fetch: unknown }).fetch;
    }
  });

  it("returns nothing at all while blocking is off", () => {
    const { partition, state } = setup();
    state.cosmeticsCache.set("https://site.test/", { stylesheet: ".ad{", script: "x" });
    state.adBlockEnabled = false;
    expect(cosmeticsFor(partition, "https://site.test/", { isDestroyed: () => false } as never))
      .toEqual({ stylesheet: "", script: "" });
  });

  it("clears the cosmetics cache on disable", () => {
    const { manager, state } = setup();
    state.cosmeticsCache.set("https://site.test/", { stylesheet: ".ad{", script: "" });
    manager.setAdBlockEnabled(false);
    expect(state.cosmeticsCache.size).toBe(0);
  });
});
