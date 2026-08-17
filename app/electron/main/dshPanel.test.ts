import { describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ views: [] as Array<Record<string, unknown>> }));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class MockWebContents extends EventEmitter {
    loadURL = vi.fn(async () => {});
    reload = vi.fn();
    setWindowOpenHandler = vi.fn();
    insertCSS = vi.fn(async () => "transparent-css");
    removeInsertedCSS = vi.fn(async () => {});
    executeJavaScript = vi.fn(async () => {});
    isDestroyed = vi.fn(() => false);
    close = vi.fn();
  }
  class WebContentsView {
    webContents = new MockWebContents();
    setBackgroundColor = vi.fn();
    setBounds = vi.fn();
    constructor() {
      stub.views.push(this as unknown as Record<string, unknown>);
    }
  }
  return { BrowserWindow: class {}, WebContentsView };
});

vi.mock("./devtools", () => ({ wireDevToolsShortcut: vi.fn() }));

import { dshBackgroundCss, DshPanel } from "./dshPanel";

/** `show()` on a fresh view (or one whose origin changed) now waits for
 *  `did-stop-loading` before resolving — see dshPanel.ts's `awaitLoadFinished`
 *  doc. The mock webContents never loads anything for real, so tests must
 *  fire that event themselves; grabbing the view has to happen *before*
 *  awaiting `show()`'s own promise (buildView() runs synchronously before
 *  show()'s first `await`, so it's already in `stub.views` by the time this
 *  function's synchronous prefix returns control). */
async function showAndFinishLoad(panel: DshPanel, url: string, bounds: Parameters<DshPanel["show"]>[1]) {
  const pending = panel.show(url, bounds);
  const view = stub.views.at(-1) as {
    webContents: { emit: (name: string) => void };
  };
  view.webContents.emit("did-stop-loading");
  await pending;
  return view;
}

describe("DshPanel background transparency", () => {
  it("adjusts both canvas and sidebar variables in nested DSH theme scopes", () => {
    const css = dshBackgroundCss(40);
    expect(css).toMatch(/:root,\s*:root \*/);
    expect(css).toContain("--dsw-alias-bg-base: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 40%, transparent)");
    expect(css).toContain("--dsw-specific-sidebar-fill: color-mix(in srgb, var(--dsw-static-neutral-bluish-900) 40%, transparent)");
  });

  it("adjusts both the native backing layer and DSH background surfaces", async () => {
    const panel = new DshPanel();
    panel.setWindow({
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      isDestroyed: () => false,
    } as never);

    panel.setBackgroundOpacity(40);
    const view = await showAndFinishLoad(panel, "http://127.0.0.1:3080", { x: 0, y: 0, width: 800, height: 600 }) as unknown as {
      setBackgroundColor: ReturnType<typeof vi.fn>;
      webContents: {
        emit: (name: string) => void;
        insertCSS: ReturnType<typeof vi.fn>;
        removeInsertedCSS: ReturnType<typeof vi.fn>;
      };
    };
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith("#00000000");

    view.webContents.emit("dom-ready");
    await vi.waitFor(() => {
      expect(view.webContents.insertCSS).toHaveBeenCalledWith(dshBackgroundCss(40));
    });

    panel.setBackgroundOpacity(100);
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith("#FFFFFFFF");
    await vi.waitFor(() => {
      expect(view.webContents.removeInsertedCSS).toHaveBeenCalledWith("transparent-css");
    });
  });
});

describe("DshPanel hide/show fade", () => {
  it("fades the page out before detaching, and back in on show()", async () => {
    const removeChildView = vi.fn();
    const panel = new DshPanel();
    panel.setWindow({
      contentView: { addChildView: vi.fn(), removeChildView },
      isDestroyed: () => false,
    } as never);

    const view = await showAndFinishLoad(panel, "http://127.0.0.1:3080", { x: 0, y: 0, width: 800, height: 600 }) as unknown as {
      webContents: { emit: (name: string) => void; executeJavaScript: ReturnType<typeof vi.fn> };
    };
    view.webContents.emit("dom-ready"); // pageReady = true, so hide()/show() actually fade

    panel.hide();
    // Detach is deferred until the fade-out finishes — no hard cut.
    expect(removeChildView).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(view.webContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('opacity = "0"'),
        true,
      );
    });
    await vi.waitFor(() => {
      expect(removeChildView).toHaveBeenCalled();
    }, { timeout: 500 });
  });

  it("a show() that lands mid-fade cancels the pending detach instead of re-adding an already-attached view", async () => {
    const addChildView = vi.fn();
    const removeChildView = vi.fn();
    const panel = new DshPanel();
    panel.setWindow({
      contentView: { addChildView, removeChildView },
      isDestroyed: () => false,
    } as never);

    const view = await showAndFinishLoad(panel, "http://127.0.0.1:3080", { x: 0, y: 0, width: 800, height: 600 }) as unknown as {
      webContents: { emit: (name: string) => void };
    };
    view.webContents.emit("dom-ready");

    panel.hide();
    // Not awaited: opacityRevision++ (what actually cancels hide()'s pending
    // removal) happens synchronously before show()'s first `await`, so firing
    // this without waiting is what exercises the "lands mid-fade" race this
    // test is about — awaiting it here would just serialize the two instead.
    void panel.show("http://127.0.0.1:3080", { x: 0, y: 0, width: 800, height: 600 });

    await new Promise((resolve) => setTimeout(resolve, 250)); // past the fade's 140ms window
    expect(removeChildView).not.toHaveBeenCalled();
    expect(addChildView).toHaveBeenCalledTimes(1); // only the original show(), not the interrupting one
  });

  it("lands the content back at full opacity before the view is revealed again, never after", async () => {
    const order: string[] = [];
    const removeChildView = vi.fn(() => order.push("removeChildView"));
    const addChildView = vi.fn(() => order.push("addChildView"));
    const panel = new DshPanel();
    panel.setWindow({
      contentView: { addChildView, removeChildView },
      isDestroyed: () => false,
    } as never);

    const view = await showAndFinishLoad(panel, "http://127.0.0.1:3080", { x: 0, y: 0, width: 800, height: 600 }) as unknown as {
      webContents: { emit: (name: string) => void; executeJavaScript: ReturnType<typeof vi.fn> };
    };
    view.webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('opacity = "1"')) order.push("opacity->1");
    });
    view.webContents.emit("dom-ready");

    panel.hide();
    await vi.waitFor(() => expect(removeChildView).toHaveBeenCalled(), { timeout: 500 });

    order.length = 0; // only the re-show sequence matters from here
    // If this were reversed (attach, then fade back in), the view would be
    // visible for a moment still at opacity:0 — the flash this test guards.
    await panel.show("http://127.0.0.1:3080", { x: 0, y: 0, width: 800, height: 600 });
    expect(order).toEqual(["opacity->1", "addChildView"]);
  });

  it("doesn't reveal a fresh load until it actually finishes loading", async () => {
    const addChildView = vi.fn();
    const panel = new DshPanel();
    panel.setWindow({
      contentView: { addChildView, removeChildView: vi.fn() },
      isDestroyed: () => false,
    } as never);

    const pending = panel.show("http://127.0.0.1:3080", { x: 0, y: 0, width: 800, height: 600 });
    const view = stub.views.at(-1) as { webContents: { emit: (name: string) => void } };

    // Attaching now — while the page is still loading — is exactly the
    // "blank, then DSH's own loading UI, then real content" flash this
    // guards against.
    await Promise.resolve();
    await Promise.resolve();
    expect(addChildView).not.toHaveBeenCalled();

    view.webContents.emit("did-stop-loading");
    await pending;
    expect(addChildView).toHaveBeenCalledOnce();
  });
});
