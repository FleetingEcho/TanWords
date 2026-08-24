import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useNavStore } from "@/store/navStore";
import { WorkspaceNavSection } from "@/components/Layout/WorkspaceNavSection";
import { isWorkspacesEnabled, setWorkspacesEnabled, WORKSPACES_FLAG_STORAGE_KEY, useWorkspaceFlag } from "@/pages/workspaceFeature";
import { WORKSPACES_DURABLE_KEY } from "@/workspaces/persistence";

// Workspace navigation is desktop-only. This suite exercises its Electron
// behavior explicitly; the complementary web-host gate has its own test.
vi.mock("@/platform", () => ({
  isDesktopHost: true,
  hostCapabilities: { desktop: true },
}));

function reset() {
  useWorkspaceStore.setState({ workspaces: [], loaded: true, activeWorkspaceId: null, focusedPaneId: null, selectedPaneId: null, editMode: false, undoCheckpoint: null });
  useNavStore.setState({ activeWorkspaceId: null, page: "dashboard" });
  localStorage.removeItem(`tanwords_${WORKSPACES_DURABLE_KEY}`);
  localStorage.removeItem(WORKSPACES_FLAG_STORAGE_KEY);
  // The flag now lives in a zustand store; reset its in-memory state too so a
  // previous test's "enabled" does not leak into the next.
  useWorkspaceFlag.setState({ enabled: false });
}
beforeEach(reset);

describe("WorkspaceNavSection", () => {
  it("renders nothing when the feature flag is off", () => {
    setWorkspacesEnabled(false);
    const { container } = render(<WorkspaceNavSection collapsed={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the section and New button when the flag is on", () => {
    setWorkspacesEnabled(true);
    render(<WorkspaceNavSection collapsed={false} />);
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getByLabelText("New workspace")).toBeInTheDocument();
  });

  it("creates and opens a workspace on New", () => {
    setWorkspacesEnabled(true);
    render(<WorkspaceNavSection collapsed={false} />);
    fireEvent.click(screen.getByLabelText("New workspace"));
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(useNavStore.getState().activeWorkspaceId).toBeTruthy();
  });

  it("lists workspaces and opens one on click", () => {
    setWorkspacesEnabled(true);
    const id = useWorkspaceStore.getState().create("Alpha");
    render(<WorkspaceNavSection collapsed={false} />);
    fireEvent.click(screen.getByText("Alpha"));
    expect(useNavStore.getState().activeWorkspaceId).toBe(id);
  });

  it("confirms before deleting a workspace", () => {
    setWorkspacesEnabled(true);
    useWorkspaceStore.getState().create("Alpha");
    render(<WorkspaceNavSection collapsed={false} />);
    fireEvent.click(screen.getByLabelText("Delete"));

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Delete this workspace/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0);
  });

  it("isWorkspacesEnabled reflects the flag", () => {
    setWorkspacesEnabled(true);
    expect(isWorkspacesEnabled()).toBe(true);
    setWorkspacesEnabled(false);
    expect(isWorkspacesEnabled()).toBe(false);
  });

  it("defaults to enabled when no choice is stored", () => {
    // An absent localStorage key means on by default; a user who turns it off
    // persists "0" and that choice survives a reload.
    localStorage.removeItem(WORKSPACES_FLAG_STORAGE_KEY);
    useWorkspaceFlag.setState({ enabled: true }); // mirror the module-load default
    expect(isWorkspacesEnabled()).toBe(true);
    // An explicit "0" is respected.
    localStorage.setItem(WORKSPACES_FLAG_STORAGE_KEY, "0");
    useWorkspaceFlag.setState({ enabled: false });
    expect(isWorkspacesEnabled()).toBe(false);
  });

  it("toggling the flag re-renders the section live (no reload needed)", () => {
    setWorkspacesEnabled(false);
    const { container, rerender } = render(<WorkspaceNavSection collapsed={false} />);
    expect(container.firstChild).toBeNull();
    // Flip the flag — the reactive hook re-renders the section into view.
    setWorkspacesEnabled(true);
    rerender(<WorkspaceNavSection collapsed={false} />);
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    // And flipping it back hides the section again.
    setWorkspacesEnabled(false);
    rerender(<WorkspaceNavSection collapsed={false} />);
    expect(container.firstChild).toBeNull();
  });
});
