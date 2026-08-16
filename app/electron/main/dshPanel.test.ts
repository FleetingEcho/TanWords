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
    panel.show("http://127.0.0.1:3080", { x: 0, y: 0, width: 800, height: 600 });

    const view = stub.views.at(-1) as {
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
