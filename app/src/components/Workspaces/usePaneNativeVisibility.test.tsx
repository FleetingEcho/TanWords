import { describe, expect, it, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { useBrowserPanelBlockStore } from "@/store/browserPanelStore";
import { useDshPanelBlockStore } from "@/store/dshPanelBlockStore";
import { usePaneNativeVisibility } from "./usePaneNativeVisibility";

function Probe({ pageId, visible }: { pageId: string; visible: boolean }) {
  usePaneNativeVisibility(pageId, visible);
  return <div />;
}

beforeEach(() => {
  useBrowserPanelBlockStore.setState({ blockers: 0 });
  useDshPanelBlockStore.setState({ blockers: 0 });
});

describe("usePaneNativeVisibility", () => {
  it("blocks the browser panel while a browser pane is not visible", () => {
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(0);
    const { rerender } = render(<Probe pageId="browser" visible={false} />);
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(1);
    // Becoming visible releases the block.
    rerender(<Probe pageId="browser" visible={true} />);
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(0);
    // And hidden again re-blocks.
    rerender(<Probe pageId="browser" visible={false} />);
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(1);
    cleanup();
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(0);
  });

  it("blocks the dsh panel while a dsh pane is not visible", () => {
    render(<Probe pageId="dsh" visible={false} />);
    expect(useDshPanelBlockStore.getState().blockers).toBe(1);
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(0);
  });

  it("does not touch the native stores for a plain React page", () => {
    render(<Probe pageId="dashboard" visible={false} />);
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(0);
    expect(useDshPanelBlockStore.getState().blockers).toBe(0);
  });

  it("leaves the native surface visible when the pane is visible", () => {
    render(<Probe pageId="browser" visible={true} />);
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(0);
  });

  it("releases the block on unmount", () => {
    render(<Probe pageId="browser" visible={false} />);
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(1);
    cleanup();
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(0);
  });
});
