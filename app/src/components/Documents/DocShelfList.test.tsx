import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocShelfList } from "./DocShelfList";
import type { DocumentListItem } from "@/hooks/useDB";
import type { DocListState } from "./hooks/useDocList";
import type { DocActionsState } from "./hooks/useDocActions";
import type { DocListDensity } from "./docListDensity";

vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string) => key,
}));

function documentItem(): DocumentListItem {
  return {
    id: 1, title: "Context-menu regression", tags: "[]", pinned: false,
    word_count: 12, created_at: "", updated_at: "", content_text: "Preview",
    protected: false, unlocked: false, archived: false, folder: "",
    task_total: 0, task_done: 0, status: "",
  };
}

function renderShelf({
  doc = documentItem(), search = "result", density = "comfortable", setShelfMenu = vi.fn(),
}: {
  doc?: DocumentListItem;
  search?: string;
  density?: DocListDensity;
  setShelfMenu?: (value: { x: number; y: number } | null) => void;
} = {}) {
  const noop = vi.fn();
  const list = {
    docs: [doc], folders: [], loading: false, search,
  } as unknown as DocListState;
  const actions = {
    handleRename: noop, handlePin: noop, handleDuplicate: noop,
    handleDelete: noop, handlePrivacyAction: noop, handleRemoveProtection: noop,
    handleMoveToFolder: noop, handleDeleteFolder: noop,
  } as unknown as DocActionsState;

  const view = render(
    <DocShelfList
      list={list}
      density={density}
      actions={actions}
      activeId={null}
      onSelect={noop}
      onExport={noop}
      onExportHtml={noop}
      onExportPdf={noop}
      shelfMenu={null}
      setShelfMenu={setShelfMenu}
      onNewDoc={noop}
      onNewDocIn={noop}
      onCreateFolder={noop}
      onRenameFolder={noop}
      onSetFolderLocked={noop}
      selectedIds={new Set()}
      selectionMode={false}
      onToggleSelect={noop}
      onToggleSelectionMode={noop}
    />,
  );
  return { ...view, setShelfMenu };
}

describe("DocShelfList context menu", () => {
  it("does not open the shelf background menu from a document row", () => {
    const setShelfMenu = vi.fn();
    renderShelf({ setShelfMenu });

    fireEvent.contextMenu(screen.getByText("Context-menu regression"));

    expect(setShelfMenu).not.toHaveBeenCalled();
  });
});

describe("DocShelfList search highlights", () => {
  it("renders a contiguous match as one rectangular highlight", () => {
    const doc = { ...documentItem(), title: "mcpserver config" };
    const { container } = renderShelf({ doc, search: "mcpserver" });
    const marks = [...container.querySelectorAll("mark")];

    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("mcpserver");
    expect(marks[0]).not.toHaveClass("rounded-sm");
  });
});

describe("DocShelfList compact alignment", () => {
  it("does not offset the status marker inside a vertically centered row", () => {
    const doc = { ...documentItem(), title: "Pi config", status: "active" as const };
    renderShelf({ doc, search: "", density: "compact" });

    const statusMarker = screen.getByLabelText("doc.statusActive");
    expect(statusMarker.parentElement).toHaveClass("items-center");
    expect(statusMarker).not.toHaveClass("mt-0.5");
  });
});
