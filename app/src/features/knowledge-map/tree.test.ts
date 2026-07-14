import { describe, expect, it } from "vitest";
import type { KnowledgeNode } from "./types";
import { buildChildrenMap, getBreadcrumb } from "./tree";

const node = (id: number, parent_id: number | null, depth: number, sort_order = 0): KnowledgeNode => ({
  id, parent_id, depth, sort_order, map_id: 1, kind: depth ? "category" : "topic",
  label: `node-${id}`, zh: "", level: "", note: "", expanded: false, word_id: null,
});

describe("knowledge map tree", () => {
  it("supports arbitrary depth and preserves sibling order", () => {
    const nodes = [node(1, null, 0), node(2, 1, 1, 2), node(3, 1, 1, 1), node(4, 3, 2), node(5, 4, 3), node(6, 5, 4)];
    const children = buildChildrenMap(nodes);

    expect(children.get(1)?.map((item) => item.id)).toEqual([3, 2]);
    expect(getBreadcrumb(nodes, 6).map((item) => item.id)).toEqual([1, 3, 4, 5, 6]);
  });
});
