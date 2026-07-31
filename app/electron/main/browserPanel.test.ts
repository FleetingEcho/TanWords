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
