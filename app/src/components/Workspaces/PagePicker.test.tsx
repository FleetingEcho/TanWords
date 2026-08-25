import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useNavStore } from "@/store/navStore";
import { PagePicker } from "./PagePicker";
import { isPageAvailableOnHost } from "@/store/workspaceStore";
import { WORKSPACES_CACHE_KEY, WORKSPACES_DURABLE_KEY } from "@/workspaces/persistence";

// The picker opens over content; native panel block hooks must not blow up in
// jsdom (they just touch a zustand counter, so they're fine).

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

describe("PagePicker", () => {
  it("lists available pages and filters by query", () => {
    render(
      <PagePicker paneId="p1" replacing={false} onClose={() => {}} onPlace={() => {}} />,
    );
    // Dashboard is always available on the test (web-like) host.
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    // Typing narrows the list.
    const input = screen.getByPlaceholderText("Search pages…");
    fireEvent.change(input, { target: { value: "vocab" } });
    expect(screen.getByText("Words")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("presents widgets as compact cards", () => {
    render(
      <PagePicker paneId="p1" replacing={false} onClose={() => {}} onPlace={() => {}} />,
    );
    const card = screen.getByRole("button", { name: "Calendar" });
    expect(card).toHaveClass("flex-col", "rounded-xl", "text-center");
    expect(card.parentElement).toHaveClass("grid");
    expect(card.parentElement).toHaveStyle({ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" });
  });

  it("does not offer Settings because it is not a workspace widget", () => {
    render(
      <PagePicker paneId="p1" replacing={false} onClose={() => {}} onPlace={() => {}} />,
    );

    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("marks host-unavailable pages as disabled with an explanation", () => {
    render(
      <PagePicker paneId="p1" replacing={false} onClose={() => {}} onPlace={() => {}} />,
    );
    // Browser is not available on the web-like test host.
    const browserBtn = screen.getByText("Browser").closest("button")!;
    expect(browserBtn).toBeDisabled();
    // Multiple gated pages share the same disabled message; assert at least one.
    expect(screen.getAllByText("Not available on this device.").length).toBeGreaterThan(0);
  });

  it("offers Move here for a singleton already hosted elsewhere", () => {
    // Place vocabulary (a singleton) in another workspace/pane first.
    const wsId = useWorkspaceStore.getState().create("Other");
    useWorkspaceStore.getState().selectWorkspace(wsId);
    const rootPane = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = rootPane.kind === "pane" ? rootPane.id : "";
    useWorkspaceStore.getState().place(rootPaneId, "vocabulary");

    render(
      <PagePicker paneId="different-pane" replacing={false} onClose={() => {}} onPlace={() => {}} />,
    );
    // Vocabulary shows "Move here" because it's a singleton hosted elsewhere.
    expect(screen.getByText("Move here")).toBeInTheDocument();
  });

  it("calls onPlace and onClose when an available page is chosen", () => {
    const onPlace = vi.fn();
    const onClose = vi.fn();
    render(
      <PagePicker paneId="p1" replacing={false} onClose={onClose} onPlace={onPlace} />,
    );
    fireEvent.click(screen.getByText("Dashboard"));
    expect(onPlace).toHaveBeenCalledWith("dashboard");
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onPlace for a host-unavailable page", () => {
    const onPlace = vi.fn();
    render(
      <PagePicker paneId="p1" replacing={false} onClose={() => {}} onPlace={onPlace} />,
    );
    fireEvent.click(screen.getByText("Browser"));
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("gives the move-here button an accessible label naming the page", () => {
    // Place vocabulary (a singleton) in another pane first.
    const wsId = useWorkspaceStore.getState().create("Other");
    useWorkspaceStore.getState().selectWorkspace(wsId);
    const rootPane = useWorkspaceStore.getState().activeWorkspace()!.root;
    const rootPaneId = rootPane.kind === "pane" ? rootPane.id : "";
    useWorkspaceStore.getState().place(rootPaneId, "vocabulary");

    render(
      <PagePicker paneId="different-pane" replacing={false} onClose={() => {}} onPlace={() => {}} />,
    );
    // The vocabulary row's accessible name describes the move action.
    const moveBtn = screen.getByText("Move here").closest("button")!;
    expect(moveBtn.getAttribute("aria-label")).toContain("Words");
  });
});

describe("isPageAvailableOnHost", () => {
  it("matches the picker's disabled state for gated pages", () => {
    expect(isPageAvailableOnHost("browser" as any)).toBe(false);
    expect(isPageAvailableOnHost("dashboard" as any)).toBe(true);
  });
});
