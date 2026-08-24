import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useWorkspaceStore, isPageAvailableOnHost } from "@/store/workspaceStore";
import { useNavStore } from "@/store/navStore";
import { WorkspaceScreen } from "./WorkspaceScreen";
import { SplitLayout } from "./SplitLayout";
import type { LayoutNode } from "@/workspaces/model";
import { WORKSPACES_CACHE_KEY, WORKSPACES_DURABLE_KEY } from "@/workspaces/persistence";
import { collectPaneIds } from "@/workspaces/normalization";

// Stub page modules so no real page chunk is fetched during render.
vi.mock("@/components/Dashboard/DashboardPage", () => ({ DashboardPage: () => <div data-testid="dashboard-page">dashboard</div> }));

class FakeDataTransfer {
  private store = new Map<string, string>();
  types: string[] = [];
  effectAllowed = "uninitialized";
  setData(type: string, value: string) {
    this.store.set(type, value);
    this.types = [...this.store.keys()];
  }
  getData(type: string) { return this.store.get(type) ?? ""; }
}

function reset() {
  useWorkspaceStore.setState({
    workspaces: [],
    loaded: true,
    activeWorkspaceId: null,
    focusedPaneId: null,
    selectedPaneId: null,
    editMode: false,
    undoCheckpoint: null,
  });
  useNavStore.setState({ activeWorkspaceId: null, page: "dashboard" });
  localStorage.removeItem(WORKSPACES_CACHE_KEY);
  localStorage.removeItem(`tanwords_${WORKSPACES_DURABLE_KEY}`);
}

beforeEach(reset);

describe("WorkspaceScreen", () => {
  it("renders nothing when no workspace is active", () => {
    const { container } = render(<WorkspaceScreen />);
    expect(container.firstChild).toBeNull();
  });

  it("renders widget cards directly inside a new empty workspace", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    expect(screen.getByText("My ws")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Add a page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.queryByText("Add a page to get started.")).not.toBeInTheDocument();
    expect(screen.queryByText("Add page")).not.toBeInTheDocument();
  });

  it("uses exactly one vertical scroll container while the widget picker is open", () => {
    const id = useWorkspaceStore.getState().create("Picker scroll test");
    useNavStore.getState().openWorkspace(id);
    const { container } = render(<WorkspaceScreen />);

    const pane = container.querySelector("[data-pane-id]")!;
    expect(pane.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
  });

  it("toggles Edit mode and shows reset/undo controls", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    fireEvent.click(screen.getByText("Edit"));
    expect(useWorkspaceStore.getState().editMode).toBe(true);
    // Reset and undo buttons appear in edit mode.
    expect(screen.getByLabelText("Reset layout")).toBeInTheDocument();
    expect(screen.getByLabelText("Undo")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Done"));
    expect(useWorkspaceStore.getState().editMode).toBe(false);
  });

  it("shows a recovery notice when saved workspaces were corrupt, dismissible", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    useWorkspaceStore.setState({ recoveredFromCorrupt: true });
    render(<WorkspaceScreen />);
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(useWorkspaceStore.getState().recoveredFromCorrupt).toBe(false);
  });

  it("confirms before closing a widget, then returns the pane to empty", async () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    // Empty panes expose the cards immediately.
    fireEvent.click(screen.getByText("Dashboard"));
    // Dashboard is now hosted in the pane (lazy stub resolves async).
    await waitFor(() => expect(screen.getByTestId("dashboard-page")).toBeInTheDocument());
    // Close is always available, but removing a populated widget is destructive
    // enough to require an explicit confirmation.
    fireEvent.click(screen.getByLabelText("Close pane"));
    expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Close this widget/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close pane" }));
    // Closing the last pane resets to an inline card picker.
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("renders the workspace title bar at half-height", () => {
    const id = useWorkspaceStore.getState().create("Compact bar");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);

    expect(screen.getByLabelText("Back").parentElement).toHaveClass("h-6");
  });

  it("changes and persists widget blur and background opacity from the toolbar", () => {
    const id = useWorkspaceStore.getState().create("Glass workspace");
    useNavStore.getState().openWorkspace(id);
    const { container } = render(<WorkspaceScreen />);

    fireEvent.click(screen.getByLabelText("Widget appearance"));
    fireEvent.change(screen.getByLabelText("Blur"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "42" } });

    expect(useWorkspaceStore.getState().activeWorkspace()?.appearance).toEqual({ blur: 14, opacity: 42 });
    const pane = container.querySelector<HTMLElement>("[data-pane-id]")!;
    expect(pane).toHaveAttribute("data-widget-blur", "14");
    expect(pane).toHaveAttribute("data-widget-opacity", "42");
    expect(pane).not.toHaveStyle({ opacity: "0.42" });
    const surface = pane.querySelector<HTMLElement>("[data-workspace-widget-surface]")!;
    expect(surface.style.backdropFilter).toBe("blur(14px)");
    expect(surface.style.backgroundColor).toContain("0.42");
    expect(pane.querySelector("[data-workspace-widget-content]")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "0" } });
    expect(pane).not.toHaveStyle({ opacity: "0" });
    expect(pane).toHaveAttribute("data-widget-opacity", "0");
    expect(surface.style.backgroundColor).toContain("0");
  });

  it("replaces a populated pane from its header action", async () => {
    const id = useWorkspaceStore.getState().create("Replace test");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);

    fireEvent.click(screen.getByText("Dashboard"));
    await waitFor(() => expect(screen.getByTestId("dashboard-page")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByLabelText("Replace page"));
    fireEvent.click(screen.getByText("RSS"));

    await waitFor(() => {
      const workspace = useWorkspaceStore.getState().activeWorkspace()!;
      const paneId = [...collectPaneIds(workspace.root)][0];
      expect(findPaneHosting(workspace.root, "feeds")).toBe(paneId);
    });
  });

  it("keeps split controls in the workspace title bar outside edit mode", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    // Place dashboard first.
    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getByLabelText("Split right")).toBeInTheDocument();
    expect(screen.getByLabelText("Split below")).toBeInTheDocument();
    expect(screen.queryByLabelText("Open as full page")).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard").closest('[draggable="true"]')).toBeInTheDocument();
    // Splitting creates an empty pane without moving the selected widget.
    fireEvent.click(screen.getByLabelText("Split right"));
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    const ids = [...collectPaneIds(ws.root)];
    expect(ids.length).toBe(2);
    expect(findPaneHosting(ws.root, "dashboard")).toBeTruthy();
    // The split branch itself must fill the pane area. Without these sizing
    // constraints a row split shrinks to its headers/content, leaving the
    // rest of the workspace background exposed and making the divider's
    // draggable hit area only a few pixels tall.
    const splitContainer = screen.getByRole("separator").parentElement;
    expect(splitContainer).toHaveClass("h-full", "w-full");
  });

  it("supports up to four widgets and disables further splitting", () => {
    const id = useWorkspaceStore.getState().create("Four panes");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);

    fireEvent.click(screen.getByLabelText("Split right"));
    fireEvent.click(screen.getByLabelText("Split below"));
    fireEvent.click(screen.getByLabelText("Split right"));

    expect([...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)]).toHaveLength(4);
    expect(screen.getByLabelText("Split right")).toBeDisabled();
    expect(screen.getByLabelText("Split below")).toBeDisabled();
  });

  it("shows close controls for empty panes when a split can collapse", () => {
    const id = useWorkspaceStore.getState().create("Empty panes");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);

    fireEvent.click(screen.getByLabelText("Split right"));

    expect(screen.getAllByLabelText("Close pane")).toHaveLength(2);
  });

  it("removes the drop overlay after a widget-header drop completes", async () => {
    const id = useWorkspaceStore.getState().create("Drop cleanup");
    useNavStore.getState().openWorkspace(id);
    const { container } = render(<WorkspaceScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    await waitFor(() => expect(screen.getByTestId("dashboard-page")).toBeInTheDocument());

    const dataTransfer = new FakeDataTransfer();
    const title = screen.getByText("Dashboard").closest('[draggable="true"]')!;
    const pane = container.querySelector("[data-pane-id]")!;
    fireEvent.dragStart(title, { dataTransfer });
    fireEvent.dragEnter(pane, { dataTransfer });
    expect(screen.getByText("Replace")).toBeInTheDocument();

    fireEvent.drop(screen.getByText("Replace"), { dataTransfer });

    expect(screen.queryByText("Replace")).not.toBeInTheDocument();
  });
});

describe("SplitLayout divider resizing", () => {
  it.each([
    ["horizontal", "width", "left"],
    ["vertical", "height", "top"],
  ] as const)("keeps a four-pixel gutter centered on a %s divider", (axis, sizeProp, positionProp) => {
    const root: LayoutNode = {
      kind: "split",
      id: `split-gap-${axis}`,
      axis,
      ratio: 0.5,
      first: { kind: "pane", id: `first-gap-${axis}`, content: null },
      second: { kind: "pane", id: `second-gap-${axis}`, content: null },
    };

    render(<SplitLayout node={root} visible />);
    const divider = screen.getByRole("separator");
    const container = divider.parentElement!;
    const first = container.firstElementChild as HTMLElement;
    const dividerLine = divider.firstElementChild!;

    expect(container).toHaveClass("gap-1");
    expect(first.style[sizeProp]).toBe("calc(50% - 2px)");
    expect(divider.style[positionProp]).toBe("50%");
    expect(dividerLine).toHaveClass(
      axis === "horizontal" ? "h-[calc(100%-16px)]" : "w-[calc(100%-16px)]",
    );
  });

  it.each([
    ["right", "horizontal", 750, 400],
    ["bottom", "vertical", 500, 600],
  ] as const)("resizes a %s split by dragging its %s divider", (direction, axis, clientX, clientY) => {
    const id = useWorkspaceStore.getState().create("Resizable");
    const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === id)!;
    const root: LayoutNode = {
      kind: "split",
      id: `split-${direction}`,
      axis,
      ratio: 0.5,
      first: { kind: "pane", id: `first-${direction}`, content: null },
      second: { kind: "pane", id: `second-${direction}`, content: null },
    };
    useWorkspaceStore.setState({
      workspaces: [{ ...workspace, root }],
      activeWorkspaceId: id,
      focusedPaneId: null,
    });

    render(<SplitLayout node={root} visible />);
    const divider = screen.getByRole("separator");
    const container = divider.parentElement as HTMLDivElement;
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(divider, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(divider, "releasePointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 500, clientY: 400 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX, clientY });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX, clientY });

    const resized = useWorkspaceStore.getState().activeWorkspace()!.root;
    expect(resized.kind).toBe("split");
    if (resized.kind !== "split") return;
    expect(resized.ratio).toBe(axis === "horizontal" ? 0.75 : 0.75);
  });
});

describe("SplitLayout focus mode", () => {
  it("renders only the focused pane filling the workspace", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useWorkspaceStore.getState().selectWorkspace(id);
    // Build a split: dashboard in one pane, empty in the other.
    const root = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = root.kind === "pane" ? root.id : "";
    useWorkspaceStore.getState().place(rootPaneId, "dashboard");
    useWorkspaceStore.getState().split(rootPaneId, "right", "chat");
    // Note: chat is a singleton; placing it relocates dashboard. The split
    // still has two panes; one hosts chat, the other is empty.
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    // Focus the pane hosting chat.
    const chatPaneId = findPaneHosting(ws.root, "chat");
    useWorkspaceStore.getState().setFocus(chatPaneId);
    render(<SplitLayout node={ws.root} visible />);
    // Only the focused pane's content renders; the sibling is hidden.
    // The focused pane fills the workspace (no divider rendered in focus mode).
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("focus mode keeps the unfocused pane mounted (hidden) so retained pages survive", () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useWorkspaceStore.getState().selectWorkspace(id);
    // Two panes: dashboard + chat.
    const root = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = root.kind === "pane" ? root.id : "";
    useWorkspaceStore.getState().place(rootPaneId, "dashboard");
    useWorkspaceStore.getState().split(rootPaneId, "right", "chat");
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    const dashPaneId = findPaneHosting(ws.root, "dashboard");
    useWorkspaceStore.getState().setFocus(dashPaneId);
    render(<SplitLayout node={ws.root} visible />);
    // The unfocused (chat) pane is mounted but hidden — its container is in
    // the DOM inside a zero-size `aria-hidden` wrapper, not torn down. This
    // is what keeps a retained/native page alive through focus mode.
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    // The focused pane itself is not hidden.
    expect(document.querySelectorAll('[aria-hidden="true"] [aria-hidden="true"]').length).toBe(0);
  });

  it("maximizes and restores a pane outside edit mode without removing sibling panes", async () => {
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    fireEvent.click(screen.getByText("Dashboard"));
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByLabelText("Split right"));
    fireEvent.click(screen.getByText("Done"));
    expect(screen.getByRole("separator")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Maximize pane" }));
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Restore panes" }));
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().focusedPaneId).toBeNull();
  });
});

function findPaneHosting(node: LayoutNode, pageId: string): string {
  if (node.kind === "pane") {
    return node.content?.pageId === pageId ? node.id : "";
  }
  return findPaneHosting(node.first, pageId) || findPaneHosting(node.second, pageId);
}

/** Force `useIsNarrow` to report a narrow viewport by stubbing matchMedia. */
function setNarrow(narrow: boolean) {
  const matchMedia = (q: string) => ({
    matches: narrow && q.includes("max-width: 767px"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  });
  // jsdom may not define matchMedia; assign it on the window.
  (window as any).matchMedia = (window as any).matchMedia || matchMedia;
  vi.spyOn(window as any, "matchMedia").mockImplementation(matchMedia as any);
}

describe("WorkspaceScreen compact view", () => {
  it("on narrow screens renders one pane at a time with a switcher", () => {
    setNarrow(true);
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    // Place dashboard, then split right with chat — two panes.
    const root = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = root.kind === "pane" ? root.id : "";
    useWorkspaceStore.getState().place(rootPaneId, "dashboard");
    useWorkspaceStore.getState().split(rootPaneId, "right", "chat");
    render(<WorkspaceScreen />);
    // The compact tab strip appears (role=tablist) — every pane is reachable.
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    // The active tab is the visible pane; switching focuses the other pane.
    const activeTab = tabs.find((tb) => tb.getAttribute("aria-selected") === "true")!;
    expect(activeTab).toBeInTheDocument();
    const inactiveTab = tabs.find((tb) => tb.getAttribute("aria-selected") === "false")!;
    fireEvent.click(inactiveTab);
    // Focusing the other pane sets a focusedPaneId pointing at a real pane.
    expect(useWorkspaceStore.getState().focusedPaneId).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("on wide screens renders the split tree (no tab strip)", () => {
    setNarrow(false);
    const id = useWorkspaceStore.getState().create("My ws");
    useNavStore.getState().openWorkspace(id);
    render(<WorkspaceScreen />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
