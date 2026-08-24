import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useNavStore } from "@/store/navStore";
import { WorkspaceScreen } from "./WorkspaceScreen";
import { useDragState } from "./dragState";
import { collectPaneIds } from "@/workspaces/normalization";
import { WORKSPACES_DURABLE_KEY } from "@/workspaces/persistence";

// Stub the dashboard page chunk so the lazy host resolves synchronously-ish.
vi.mock("@/components/Dashboard/DashboardPage", () => ({ DashboardPage: () => <div data-testid="dashboard-page">dashboard</div> }));

function reset() {
  useWorkspaceStore.setState({ workspaces: [], loaded: true, activeWorkspaceId: null, focusedPaneId: null, selectedPaneId: null, editMode: false, undoCheckpoint: null, recoveredFromCorrupt: false });
  useNavStore.setState({ activeWorkspaceId: null, page: "dashboard" });
  useDragState.setState({ pageId: null, x: 0, y: 0, active: false });
  localStorage.removeItem(`tanwords_${WORKSPACES_DURABLE_KEY}`);
}
beforeEach(reset);

/** Simulate a pointer drag that ends over the centre of a pane element, in a
 *  given fractional band (edge), to exercise the dispatcher's zone math. */
function dropAt(paneEl: HTMLElement, fracX: number, fracY: number, pageId = "chat") {
  const r = paneEl.getBoundingClientRect();
  const x = r.left + r.width * fracX;
  const y = r.top + r.height * fracY;
  useDragState.getState().start(pageId as any, x, y);
  useDragState.setState({ active: true });
  // The dispatcher listens on window pointerup.
  fireEvent.pointerUp(window, { clientX: x, clientY: y });
}

/** jsdom does not lay out, so `getBoundingClientRect` returns zeros and the
 *  dispatcher's edge math can't run. Give pane elements a deterministic rect. */
function stubPaneRect(paneEl: HTMLElement, l = 0, t = 0, w = 200, h = 200) {
  const rect = { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON: () => "" } as DOMRect;
  vi.spyOn(paneEl, "getBoundingClientRect").mockReturnValue(rect);
}

describe("PointerDropDispatcher integration", () => {
  it("a center pointer drop fills an empty pane", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    const pane = document.querySelector("[data-pane-id]") as HTMLElement;
    expect(pane).not.toBeNull();
    dropAt(pane, 0.5, 0.5, "dashboard");
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect((ws.root as any).content?.pageId).toBe("dashboard");
  });

  it("a right-edge pointer drop splits the pane", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    // Place dashboard first so the pane has content (edge zones apply).
    const pane = document.querySelector("[data-pane-id]") as HTMLElement;
    stubPaneRect(pane);
    dropAt(pane, 0.5, 0.5, "dashboard");
    const ws1 = useWorkspaceStore.getState().activeWorkspace()!;
    const rootPaneId = (ws1.root as any).id;
    expect((ws1.root as any).content?.pageId).toBe("dashboard");
    // Now drop chat on the right edge (fracX > 0.75).
    const pane2 = document.querySelector(`[data-pane-id="${rootPaneId}"]`) as HTMLElement;
    expect(pane2).not.toBeNull();
    stubPaneRect(pane2);
    dropAt(pane2, 0.9, 0.5, "chat");
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect([...collectPaneIds(ws.root)].length).toBe(2);
  });

  it("ignores a drop when no pane is under the pointer", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    // Drop far outside any pane.
    useDragState.getState().start("dashboard", -1000, -1000);
    useDragState.setState({ active: true });
    fireEvent.pointerUp(window, { clientX: -1000, clientY: -1000 });
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect((ws.root as any).content).toBeNull();
  });
});
