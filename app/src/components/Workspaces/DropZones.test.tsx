import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useNavStore } from "@/store/navStore";
import { useBrowserPanelBlockStore } from "@/store/browserPanelStore";
import { useDshPanelBlockStore } from "@/store/dshPanelBlockStore";
import { DropZones, PAGE_DRAG_MIME, PANE_DRAG_MIME, usePageDragSource } from "./DropZones";
import { collectPaneIds } from "@/workspaces/normalization";
import { panesHostingPage } from "@/workspaces/operations";
import { WORKSPACES_DURABLE_KEY } from "@/workspaces/persistence";

// jsdom doesn't implement DataTransfer; provide a minimal stub that supports
// getData/setData for the custom MIME type the drop zones read.
class FakeDataTransfer {
  private store = new Map<string, string>();
  types: string[] = [];
  effectAllowed = "uninitialized";
  setData(t: string, v: string) { this.store.set(t, String(v)); this.types = [...this.store.keys()]; }
  getData(t: string) { return this.store.get(t) ?? ""; }
}
function dt(pageId?: string, sourcePaneId?: string): FakeDataTransfer {
  const d = new FakeDataTransfer();
  if (pageId) d.setData(PAGE_DRAG_MIME, pageId);
  if (sourcePaneId) d.setData(PANE_DRAG_MIME, sourcePaneId);
  return d;
}

function reset() {
  useWorkspaceStore.setState({ workspaces: [], loaded: true, activeWorkspaceId: null, focusedPaneId: null, selectedPaneId: null, editMode: false, undoCheckpoint: null });
  useNavStore.setState({ activeWorkspaceId: null, page: "dashboard" });
  useBrowserPanelBlockStore.setState({ blockers: 0 });
  useDshPanelBlockStore.setState({ blockers: 0 });
  localStorage.removeItem(`tanwords_${WORKSPACES_DURABLE_KEY}`);
}
beforeEach(reset);

function dragOver(target: Element, dataTransfer: FakeDataTransfer) {
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
}
function drop(target: Element, dataTransfer: FakeDataTransfer) {
  fireEvent.drop(target, { dataTransfer });
}

describe("DropZones", () => {
  it("a center drop on an empty pane places the page", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = rootPane.kind === "pane" ? rootPane.id : "";
    render(<DropZones paneId={rootPaneId} hasContent={false} />);
    const center = screen.getByText("Drop here");
    const d = dt("dashboard");
    dragOver(center.closest("div")!, d);
    drop(center.closest("div")!, d);
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect((ws.root as any).content?.pageId).toBe("dashboard");
  });

  it("a right-edge drop splits the pane", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = rootPane.kind === "pane" ? rootPane.id : "";
    render(<DropZones paneId={rootPaneId} hasContent />);
    // The first edge zone div (left) — find an edge by its role-less div; we
    // drop on the container after dragging over it. Use the 4 edge divs by
    // querying all direct children of the zones wrapper except the center.
    const zonesRoot = screen.getByText("Replace").parentElement!;
    const edgeDivs = Array.from(zonesRoot.children).filter((c) => !c.textContent);
    // right edge is the 2nd edge (left, right, top, bottom).
    const rightEdge = edgeDivs[1];
    const d = dt("vocabulary");
    dragOver(rightEdge, d);
    drop(rightEdge, d);
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect([...collectPaneIds(ws.root)].length).toBe(2);
  });

  it("ignores a drag with no page payload", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = rootPane.kind === "pane" ? rootPane.id : "";
    render(<DropZones paneId={rootPaneId} hasContent={false} />);
    const center = screen.getByText("Drop here");
    drop(center.closest("div")!, dt()); // no payload
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect((ws.root as any).content).toBeNull();
  });

  it("ignores a host-unavailable page", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = rootPane.kind === "pane" ? rootPane.id : "";
    render(<DropZones paneId={rootPaneId} hasContent={false} />);
    const center = screen.getByText("Drop here");
    drop(center.closest("div")!, dt("browser")); // not available on test host
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect((ws.root as any).content).toBeNull();
  });

  it("swaps two existing widgets on a center drop", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootId = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().place(rootId, "dashboard");
    useWorkspaceStore.getState().splitEmpty(rootId, "right");
    const targetId = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)].find((paneId) => paneId !== rootId)!;
    useWorkspaceStore.getState().place(targetId, "chat");
    render(<DropZones paneId={targetId} hasContent />);

    const center = screen.getByText("Replace");
    drop(center, dt("dashboard", rootId));

    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect(panesHostingPage(ws.root, "dashboard")).toEqual([targetId]);
    expect(panesHostingPage(ws.root, "chat")).toEqual([rootId]);
  });
});

describe("DropZones native-panel blocking", () => {
  it("blocks browser/dsh panels while the overlay is mounted and releases on unmount", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = rootPane.kind === "pane" ? rootPane.id : "";
    const { unmount } = render(<DropZones paneId={rootPaneId} hasContent={false} />);
    // The overlay blocks both native surfaces so they can't paint over it.
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(1);
    expect(useDshPanelBlockStore.getState().blockers).toBe(1);
    unmount();
    expect(useBrowserPanelBlockStore.getState().blockers).toBe(0);
    expect(useDshPanelBlockStore.getState().blockers).toBe(0);
  });
});

describe("usePageDragSource", () => {
  it("sets the page id on the drag payload", () => {
    function Probe() {
      const src = usePageDragSource("dashboard");
      return <button data-testid="drag" {...src}>drag</button>;
    }
    render(<Probe />);
    const d = new FakeDataTransfer();
    fireEvent.dragStart(screen.getByTestId("drag"), { dataTransfer: d });
    expect(d.getData(PAGE_DRAG_MIME)).toBe("dashboard");
  });

  it("marks widget-header drags as moves with their source pane", () => {
    function Probe() {
      const src = usePageDragSource("dashboard", "pane-a");
      return <button data-testid="drag" {...src}>drag</button>;
    }
    render(<Probe />);
    const d = new FakeDataTransfer();
    fireEvent.dragStart(screen.getByTestId("drag"), { dataTransfer: d });
    expect(d.getData(PANE_DRAG_MIME)).toBe("pane-a");
    expect(d.effectAllowed).toBe("move");
  });
});
