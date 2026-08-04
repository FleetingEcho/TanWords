import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

import { LocalDocTree, localDocRowOrder } from "./LocalDocTree";

const noop = () => {};

const files = [
  { rel_path: "notes/rust/a.md", name: "a.md", modified_ms: 1, size: 1 },
  { rel_path: "notes/rust/async/b.md", name: "b.md", modified_ms: 2, size: 1 },
  { rel_path: "top.md", name: "top.md", modified_ms: 3, size: 1 },
];

function renderTree(overrides: Partial<React.ComponentProps<typeof LocalDocTree>> = {}) {
  const props = {
    files,
    activePath: null,
    onOpen: vi.fn(),
    onDelete: noop,
    onImport: noop,
    onExport: noop,
    onExportHtml: noop,
    onExportPdf: noop,
    onMove: noop,
    onCreateInFolder: noop,
    onCreateFolder: noop,
    onRenameFolder: noop,
    onDeleteFolder: noop,
    selected: new Set<string>(),
    selectionMode: false,
    onToggleSelect: vi.fn(),
    onToggleSelectionMode: vi.fn(),
    onSelectFolder: noop,
    onImportFolder: noop,
    ...overrides,
  };
  render(<LocalDocTree {...props} />);
  return props;
}

describe("LocalDocTree selection", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("puts folders before the files beside them, so shift-ranges match what is on screen", () => {
    expect(localDocRowOrder(files)).toEqual([
      "notes/rust/async/b.md",
      "notes/rust/a.md",
      "top.md",
    ]);
  });

  it("shows no checkbox until multi-select is on", () => {
    renderTree();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("ticks a row via its checkbox without opening the file", () => {
    const { onToggleSelect, onOpen } = renderTree({ selectionMode: true });

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("double-clicking a row asks to enter multi-select mode", () => {
    const { onToggleSelectionMode } = renderTree();

    fireEvent.doubleClick(screen.getByText("top"));

    expect(onToggleSelectionMode).toHaveBeenCalledWith("top.md");
  });

  it("ticks instead of opening once multi-select is on", () => {
    const { onOpen, onToggleSelect } = renderTree({ selectionMode: true });

    fireEvent.click(screen.getByText("top"));

    expect(onOpen).not.toHaveBeenCalled();
    expect(onToggleSelect).toHaveBeenCalledWith("top.md", false);
  });

  it("treats a modified click on the row as selection, not as opening it", () => {
    const { onToggleSelect, onOpen } = renderTree();

    fireEvent.click(screen.getByText("top"), { metaKey: true });

    expect(onOpen).not.toHaveBeenCalled();
    expect(onToggleSelect).toHaveBeenCalledWith("top.md", false);
  });

  it("asks for a range when the click is shifted", () => {
    const { onToggleSelect } = renderTree();

    fireEvent.click(screen.getByText("top"), { shiftKey: true });

    expect(onToggleSelect).toHaveBeenCalledWith("top.md", true);
  });

  it("still opens a file on a plain click", () => {
    const { onOpen, onToggleSelect } = renderTree();

    fireEvent.click(screen.getByText("top"));

    expect(onOpen).toHaveBeenCalledWith("top.md");
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it("raises the folder menu on right-click, with the same entries the library has", async () => {
    renderTree();

    fireEvent.contextMenu(screen.getByTitle("notes/rust"));

    // Same vocabulary as DocFolderTree's folder menu — the two trees are meant
    // to be operated the same way.
    for (const label of ["New file here", "New subfolder", "Rename folder", "Remove folder"]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it("marks ticked rows as checked", () => {
    renderTree({ selected: new Set(["top.md"]), selectionMode: true });
    const checked = screen.getAllByRole("checkbox").filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
  });
});
