import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

import { LocalDocTree } from "./LocalDocTree";

const noop = () => {};

describe("LocalDocTree", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("reveals an already-active file when the tree mounts after search", async () => {
    render(
      <LocalDocTree
        files={[
          { rel_path: "first.md", name: "first.md", modified_ms: 1, size: 1 },
          { rel_path: "deep/folder/selected.md", name: "selected.md", modified_ms: 2, size: 1 },
        ]}
        activePath="deep/folder/selected.md"
        onOpen={noop}
        onDelete={noop}
        onImport={noop}
        onExport={noop}
        onExportHtml={noop}
        onExportPdf={noop}
        onMove={noop}
        onCreateInFolder={noop}
        onCreateFolder={noop}
        onRenameFolder={noop}
        onDeleteFolder={noop}
        selected={new Set()}
        selectionMode={false}
        onToggleSelect={noop}
        onToggleSelectionMode={noop}
        onSelectFolder={noop}
        onImportFolder={noop}
      />,
    );

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
    });
  });
});
