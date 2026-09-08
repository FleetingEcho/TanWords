import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DocumentsPage pulls in the editor stack through useDocumentEditor; the mobile
// layout tests only care about which panes/handles are on screen, so stub the
// editor state and swap the heavy children for markers.

vi.mock("./useDocumentEditor", () => ({
  useDocumentEditor: () => ({
    activeId: null,
    doc: null,
    lockedId: null,
    saveStatus: "idle",
    refreshKey: 0,
    loading: false,
    loadDoc: vi.fn(),
    handleNewDoc: vi.fn(),
    handleNewDocIn: vi.fn(),
    handleSave: vi.fn(),
    markDirty: vi.fn(),
    handleTitleChange: vi.fn(),
    handleTagsChange: vi.fn(),
    handleStatusChange: vi.fn(),
    handlePinToggle: vi.fn(),
    registerActiveFlush: vi.fn(),
    registerActiveUpload: vi.fn(),
    flushActiveDocument: vi.fn(),
    unlockDocument: vi.fn(),
    removeLockedProtection: vi.fn(),
  }),
}));

vi.mock("./DocSelector", () => ({
  DocSelector: () => <div data-testid="doc-selector" />,
}));

vi.mock("@/components/shared/ListPanelEdgeHandle", () => ({
  ListPanelEdgeHandle: ({ edge }: { edge: string }) => (
    <button type="button" data-testid="edge-handle" data-edge={edge} />
  ),
}));

vi.mock("@/platform", () => ({
  hostCapabilities: { localDocs: false },
}));

vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string) => key,
}));

import { DocumentsPage } from "./DocumentsPage";

/** Force `useIsNarrow` to report a narrow (or wide) viewport, like WorkspaceScreen.test. */
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
  (window as any).matchMedia = (window as any).matchMedia || matchMedia;
  vi.spyOn(window as any, "matchMedia").mockImplementation(matchMedia as any);
}

describe("DocumentsPage mobile list layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("on a phone the desktop collapse handle is not rendered — the list/editor toggle replaces it", () => {
    setNarrow(true);
    render(<DocumentsPage />);
    expect(screen.getByTestId("doc-selector")).toBeInTheDocument();
    expect(screen.queryByTestId("edge-handle")).not.toBeInTheDocument();
  });

  it("on desktop the collapse handle stays available", () => {
    setNarrow(false);
    render(<DocumentsPage />);
    expect(screen.getByTestId("edge-handle")).toBeInTheDocument();
  });
});
