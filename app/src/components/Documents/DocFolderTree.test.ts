import { describe, expect, it, vi } from "vitest";

// Importing the component reaches useT → settingsStore, which subscribes to a
// media query at module scope.
vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

import { buildFolderTree, subtreeDocCount } from "./DocFolderTree";
import type { DocumentListItem } from "@/hooks/useDB";

function doc(id: number, folder: string): DocumentListItem {
  return {
    id, title: `doc ${id}`, tags: "[]", pinned: false, word_count: 0,
    created_at: "", updated_at: "", content_text: "", protected: false,
    unlocked: false, archived: false, folder,
  };
}

describe("buildFolderTree", () => {
  it("keeps a folder that holds no documents", () => {
    const tree = buildFolderTree([], [{ path: "empty", locked: false }]);
    expect([...tree.dirs.keys()]).toEqual(["empty"]);
  });

  it("derives folders from the documents filed in them", () => {
    const tree = buildFolderTree([doc(1, "a/b")], []);
    expect([...tree.dirs.get("a")!.dirs.keys()]).toEqual(["b"]);
  });

  it("leaves unfiled documents at the root", () => {
    const tree = buildFolderTree([doc(1, "")], []);
    expect(tree.docs.map((d) => d.id)).toEqual([1]);
    expect(tree.dirs.size).toBe(0);
  });
});

describe("subtreeDocCount", () => {
  it("counts documents in subfolders too, since a collapsed folder hides them", () => {
    const tree = buildFolderTree(
      [doc(1, "Systems"), doc(2, "Systems"), doc(3, "Systems/deep")],
      [{ path: "Systems/deep", locked: false }],
    );
    expect(subtreeDocCount(tree.dirs.get("Systems")!)).toBe(3);
    expect(subtreeDocCount(tree.dirs.get("Systems")!.dirs.get("deep")!)).toBe(1);
  });

  it("is zero for an empty folder rather than blank", () => {
    const tree = buildFolderTree([], [{ path: "test", locked: false }]);
    expect(subtreeDocCount(tree.dirs.get("test")!)).toBe(0);
  });
});
