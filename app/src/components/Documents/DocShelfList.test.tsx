import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocShelfList } from "./DocShelfList";
import type { DocumentListItem } from "@/hooks/useDB";
import type { DocListState } from "./hooks/useDocList";
import type { DocActionsState } from "./hooks/useDocActions";

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

describe("DocShelfList context menu", () => {
  it("does not open the shelf background menu from a document row", () => {
    const setShelfMenu = vi.fn();
    const noop = vi.fn();
    const list = {
      docs: [documentItem()], folders: [], loading: false, search: "result",
    } as unknown as DocListState;
    const actions = {
      handleRename: noop, handlePin: noop, handleDuplicate: noop,
      handleDelete: noop, handlePrivacyAction: noop, handleRemoveProtection: noop,
      handleMoveToFolder: noop, handleDeleteFolder: noop,
    } as unknown as DocActionsState;

    render(
      <DocShelfList
        list={list}
        density="comfortable"
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

    fireEvent.contextMenu(screen.getByText("Context-menu regression"));

    expect(setShelfMenu).not.toHaveBeenCalled();
  });
});
