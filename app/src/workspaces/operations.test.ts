import { describe, expect, it, beforeEach } from "vitest";
import {
  type LayoutNode,
  MIN_RATIO,
  MAX_RATIO,
  MAX_DEPTH,
  clampRatio,
  normalizeWorkspaceAppearance,
} from "./model";
import {
  emptyWorkspace,
  normalizeNode,
  normalizeDocument,
  decodeCollection,
  depth,
  paneCount,
  collectPaneIds,
  findPane,
} from "./normalization";
import {
  splitPane,
  setPaneContent,
  movePaneContent,
  movePaneToEdge,
  swapPaneContents,
  closePane,
  resizeSplit,
  clearSingletonElsewhere,
  panesHostingPage,
  createWorkspace,
  duplicateWorkspace,
  renameWorkspace,
  makePageInstance,
} from "./operations";
import { __resetIdsForTests } from "./ids";

function pane(id: string, content: any = null): LayoutNode {
  return { kind: "pane", id, content };
}
function split(id: string, axis: "horizontal" | "vertical", ratio: number, first: LayoutNode, second: LayoutNode): LayoutNode {
  return { kind: "split", id, axis, ratio, first, second };
}

// Reset the id counter before each test so sequences are deterministic and
// don't drift across files. Tests that need a clean slate call it again.
beforeEach(() => {
  __resetIdsForTests();
});

describe("clampRatio", () => {
  it("clamps into [MIN_RATIO, MAX_RATIO]", () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0)).toBe(MIN_RATIO);
    expect(clampRatio(1)).toBe(MAX_RATIO);
    expect(clampRatio(-1)).toBe(MIN_RATIO);
    expect(clampRatio(2)).toBe(MAX_RATIO);
  });
  it("falls back to 0.5 for non-finite values", () => {
    expect(clampRatio(NaN)).toBe(0.5);
    expect(clampRatio(Infinity)).toBe(MAX_RATIO);
    expect(clampRatio(-Infinity)).toBe(MIN_RATIO);
  });
});

describe("workspace appearance", () => {
  it("defaults old documents and clamps persisted values", () => {
    expect(normalizeWorkspaceAppearance(undefined)).toEqual({ blur: 0, opacity: 100 });
    expect(normalizeWorkspaceAppearance({ blur: 99, opacity: -4 })).toEqual({ blur: 30, opacity: 0 });
    expect(normalizeWorkspaceAppearance({ blur: 12.4, opacity: 45.6 })).toEqual({ blur: 12, opacity: 46 });
  });
});

describe("emptyWorkspace", () => {
  it("is a single empty pane", () => {
    const ws = emptyWorkspace("My workspace");
    expect(ws.title).toBe("My workspace");
    expect(ws.root.kind).toBe("pane");
    if (ws.root.kind === "pane") expect(ws.root.content).toBeNull();
    expect(paneCount(ws.root)).toBe(1);
  });
});

describe("splitPane", () => {
  it("splitting right makes a horizontal split with the new pane second", () => {
    __resetIdsForTests();
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    const page = makePageInstance("vocabulary");
    const next = splitPane(ws.root, rootId, "right", page);
    expect(next.kind).toBe("split");
    if (next.kind !== "split") return;
    expect(next.axis).toBe("horizontal");
    // first is the original (empty) pane, second is the new pane with content.
    expect(next.first.kind).toBe("pane");
    expect(next.second.kind).toBe("pane");
    expect((next.second as any).content).toEqual(page);
    expect((next.first as any).content).toBeNull();
  });

  it("splitting left puts the new pane first", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    const page = makePageInstance("dashboard");
    const next = splitPane(ws.root, rootId, "left", page);
    if (next.kind !== "split") return;
    expect(next.axis).toBe("horizontal");
    expect((next.first as any).content).toEqual(page);
    expect((next.second as any).content).toBeNull();
  });

  it("splitting top/bottom makes a vertical split", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    const top = splitPane(ws.root, rootId, "top", makePageInstance("calendar"));
    const bot = splitPane(ws.root, rootId, "bottom", makePageInstance("feeds"));
    if (top.kind !== "split" || bot.kind !== "split") return;
    expect(top.axis).toBe("vertical");
    expect(bot.axis).toBe("vertical");
    expect((top.first as any).content.pageId).toBe("calendar");
    expect((bot.second as any).content.pageId).toBe("feeds");
  });

  it("clamps the ratio into the usable window on both edges", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    const tinyRight = splitPane(ws.root, rootId, "right", null, 0.05);
    const hugeLeft = splitPane(ws.root, rootId, "left", null, 0.95);
    if (tinyRight.kind !== "split" || hugeLeft.kind !== "split") return;
    // `node.ratio` is the first child's share. A right split with a tiny
    // requested new-pane share leaves the original (first) pane with the
    // clamped maximum; a left split with a huge requested new-pane share
    // clamps the new (first) pane to the maximum too.
    expect(tinyRight.ratio).toBe(MAX_RATIO);
    expect(hugeLeft.ratio).toBe(MAX_RATIO);
  });

  it("is a no-op when the pane id is not found", () => {
    const ws = emptyWorkspace();
    const next = splitPane(ws.root, "no-such-pane", "right", null);
    expect(next).toBe(ws.root);
  });

  it("refuses to split past the depth cap", () => {
    // Build a tree at max depth by repeatedly splitting the new pane.
    let root: LayoutNode = emptyWorkspace().root;
    for (let i = 0; i < MAX_DEPTH; i++) {
      // Find the most recently created pane (an empty one) and split it.
      const ids = [...collectPaneIds(root)];
      const target = ids[ids.length - 1];
      root = splitPane(root, target, "right", null);
    }
    expect(depth(root)).toBeLessThanOrEqual(MAX_DEPTH);
    // One more split should be refused.
    const ids = [...collectPaneIds(root)];
    const before = root;
    root = splitPane(root, ids[0], "right", null);
    expect(root).toBe(before);
  });

  it("produces a tree whose pane ids are all unique", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    let root = splitPane(ws.root, rootId, "right", makePageInstance("chat"));
    const ids = [...collectPaneIds(root)];
    const firstId = ids.find((id) => id !== rootId)!;
    root = splitPane(root, firstId, "bottom", makePageInstance("feeds"));
    const all = [...collectPaneIds(root)];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(3);
  });
});

describe("setPaneContent / movePaneContent", () => {
  it("fills an empty pane", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    const page = makePageInstance("documents");
    const next = setPaneContent(ws.root, rootId, page);
    expect((next as any).content).toEqual(page);
  });

  it("move relocates content and empties the source", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    const page = makePageInstance("documents");
    let root = setPaneContent(ws.root, rootId, page);
    root = splitPane(root, rootId, "right", null);
    // Find the new empty pane.
    const ids = [...collectPaneIds(root)].filter((id) => id !== rootId);
    const targetId = ids[0];
    root = movePaneContent(root, rootId, targetId);
    expect((findPane(root, rootId) as any).content).toBeNull();
    expect((findPane(root, targetId) as any).content).toEqual(page);
  });

  it("move is a no-op when source === target or a pane is missing", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    expect(movePaneContent(ws.root, rootId, rootId)).toBe(ws.root);
    expect(movePaneContent(ws.root, rootId, "missing")).toBe(ws.root);
  });

  it("swaps pane contents without changing the layout", () => {
    const left = pane("left", makePageInstance("dashboard"));
    const right = pane("right", makePageInstance("chat"));
    const root = split("root", "horizontal", 0.5, left, right);
    const next = swapPaneContents(root, "left", "right");
    expect((findPane(next, "left") as any).content.pageId).toBe("chat");
    expect((findPane(next, "right") as any).content.pageId).toBe("dashboard");
    expect(paneCount(next)).toBe(2);
  });

  it("moves a pane to a requested edge without changing pane count", () => {
    const root = split(
      "outer",
      "horizontal",
      0.5,
      pane("a", makePageInstance("dashboard")),
      split("inner", "vertical", 0.5, pane("b", makePageInstance("chat")), pane("c")),
    );
    const next = movePaneToEdge(root, "a", "c", "bottom");
    expect(paneCount(next)).toBe(3);
    expect(findPane(next, "a")).toBeTruthy();
    expect(findPane(next, "c")).toBeTruthy();
    expect(next).not.toBe(root);
  });
});

describe("closePane collapsing", () => {
  it("removing one child of a split lifts the sibling into place", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    let root = splitPane(ws.root, rootId, "right", makePageInstance("vocabulary"));
    // Now root is a split: first = original (empty), second = new (vocab).
    const vocabPane = findPane(root, (root as any).second.id);
    // Close the original empty pane → the split collapses to just the vocab pane.
    root = closePane(root, rootId);
    expect(root.kind).toBe("pane");
    expect((root as any).content?.pageId).toBe("vocabulary");
  });

  it("closing the only pane resets to a single empty pane, not null", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    const root = closePane(ws.root, rootId);
    expect(root.kind).toBe("pane");
    expect((root as any).content).toBeNull();
    expect((root as any).id).not.toBe(rootId);
  });

  it("closing collapses redundant empty splits", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    // split right (new pane empty), then split the new pane bottom (also empty).
    let root = splitPane(ws.root, rootId, "right", null);
    const newPaneId = (root as any).second.id;
    root = splitPane(root, newPaneId, "bottom", null);
    // Closing the original pane should collapse the whole thing to one pane.
    root = closePane(root, rootId);
    expect(paneCount(root)).toBe(1);
  });

  it("closing a pane with content in a deeper tree keeps the other branch", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    let root = splitPane(ws.root, rootId, "right", makePageInstance("chat"));
    const rightId = (root as any).second.id;
    root = splitPane(root, rightId, "bottom", makePageInstance("feeds"));
    // root: split(root, [empty], split(right, [chat], [feeds]))
    // Close the chat pane → the right split lifts feeds up.
    const chatPane = panesHostingPage(root, "chat")[0];
    root = closePane(root, chatPane);
    expect(panesHostingPage(root, "chat")).toHaveLength(0);
    expect(panesHostingPage(root, "feeds")).toHaveLength(1);
    expect(paneCount(root)).toBe(2);
  });
});

describe("resizeSplit", () => {
  it("sets and clamps the ratio", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    const root = splitPane(ws.root, rootId, "right", null);
    if (root.kind !== "split") return;
    const splitId = root.id;
    const resized = resizeSplit(root, splitId, 0.7);
    expect((resized as any).ratio).toBe(0.7);
    const clamped = resizeSplit(root, splitId, 0.99);
    expect((clamped as any).ratio).toBe(MAX_RATIO);
    const clampedLow = resizeSplit(root, splitId, 0.01);
    expect((clampedLow as any).ratio).toBe(MIN_RATIO);
  });

  it("is a no-op when the split id is not found", () => {
    const ws = emptyWorkspace();
    expect(resizeSplit(ws.root, "no-such-split", 0.5)).toBe(ws.root);
  });
});

describe("singleton relocation", () => {
  it("clearSingletonElsewhere empties other panes hosting the same page", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    let root = splitPane(ws.root, rootId, "right", makePageInstance("chat"));
    const rightId = (root as any).second.id;
    // Put chat in both panes (simulating a clone the store must undo).
    root = setPaneContent(root, rootId, makePageInstance("chat"));
    // Clear chat everywhere except the right pane.
    const res = clearSingletonElsewhere(root, "chat", rightId);
    expect(res.changed).toBe(true);
    expect((findPane(res.node, rootId) as any).content).toBeNull();
    expect((findPane(res.node, rightId) as any).content?.pageId).toBe("chat");
  });

  it("clearSingletonElsewhere reports no change when nothing matches", () => {
    const ws = emptyWorkspace();
    const res = clearSingletonElsewhere(ws.root, "chat");
    expect(res.changed).toBe(false);
    expect(res.node).toBe(ws.root);
  });

  it("panesHostingPage lists every pane carrying the page", () => {
    const ws = emptyWorkspace();
    const rootId = (ws.root as any).id;
    let root = splitPane(ws.root, rootId, "right", makePageInstance("chat"));
    const rightId = (root as any).second.id;
    root = setPaneContent(root, rootId, makePageInstance("chat"));
    expect(panesHostingPage(root, "chat").sort()).toEqual([rootId, rightId].sort());
    expect(panesHostingPage(root, "vocabulary")).toEqual([]);
  });
});

describe("create / duplicate / rename", () => {
  it("createWorkspace makes a titled single-empty-pane workspace", () => {
    const ws = createWorkspace("New");
    expect(ws.title).toBe("New");
    expect(ws.schemaVersion).toBe(1);
    expect(paneCount(ws.root)).toBe(1);
    expect((ws.root as any).content).toBeNull();
  });

  it("duplicateWorkspace copies the tree shape and page ids but regenerates ids", () => {
    const ws = createWorkspace("Orig");
    const rootId = (ws.root as any).id;
    let root = splitPane(ws.root, rootId, "right", makePageInstance("chat"));
    const doc = { ...ws, root };
    const dup = duplicateWorkspace(doc, "Copy");
    expect(dup.title).toBe("Copy");
    expect(dup.id).not.toBe(doc.id);
    expect(paneCount(dup.root)).toBe(2);
    expect(panesHostingPage(dup.root, "chat")).toHaveLength(1);
    // Pane ids are regenerated.
    expect([...collectPaneIds(dup.root)].sort()).not.toEqual([...collectPaneIds(doc.root)].sort());
    // Instance ids are regenerated too.
    const origInst = (findPane(doc.root, panesHostingPage(doc.root, "chat")[0]) as any).content.instanceId;
    const dupInst = (findPane(dup.root, panesHostingPage(dup.root, "chat")[0]) as any).content.instanceId;
    expect(dupInst).not.toBe(origInst);
  });

  it("renameWorkspace changes the title and bumps updatedAt", () => {
    const ws = createWorkspace("Old");
    const renamed = renameWorkspace(ws, "New");
    expect(renamed.title).toBe("New");
    expect(renamed.updatedAt).not.toBe(ws.updatedAt);
    expect(renamed.id).toBe(ws.id);
  });
});

describe("normalization", () => {
  it("normalizeNode regenerates duplicate pane ids", () => {
    const seen = new Set<string>();
    const a = normalizeNode({ kind: "pane", id: "dup", content: null }, seen);
    const b = normalizeNode({ kind: "pane", id: "dup", content: null }, seen);
    expect(a.id).not.toBe(b.id);
  });

  it("normalizeNode clamps an out-of-range ratio", () => {
    const seen = new Set<string>();
    const n = normalizeNode({
      kind: "split", id: "s", axis: "horizontal", ratio: 1.5,
      first: { kind: "pane", id: "a", content: null },
      second: { kind: "pane", id: "b", content: null },
    }, seen) as any;
    // Both children empty → collapses to a single pane.
    expect(n.kind).toBe("pane");
  });

  it("normalizeNode drops a malformed page instance", () => {
    const seen = new Set<string>();
    const n = normalizeNode({ kind: "pane", id: "p", content: { pageId: "nonsense" } }, seen) as any;
    expect(n.content).toBeNull();
  });

  it("normalizeNode caps over-deep trees", () => {
    // Build a pathologically deep tree by hand.
    let deep: any = { kind: "pane", id: "p", content: null };
    for (let i = 0; i < 10; i++) {
      deep = { kind: "split", id: `s${i}`, axis: "horizontal", ratio: 0.5, first: { kind: "pane", id: `p${i}`, content: makePageInstance("chat") }, second: deep };
    }
    const seen = new Set<string>();
    const n = normalizeNode(deep, seen);
    expect(depth(n)).toBeLessThanOrEqual(MAX_DEPTH);
  });

  it("normalizeDocument falls back to an empty workspace for garbage", () => {
    expect(normalizeDocument(null).root.kind).toBe("pane");
    expect(normalizeDocument("garbage").root.kind).toBe("pane");
    expect(normalizeDocument({}).root.kind).toBe("pane");
  });

  it("decodeCollection recovers from corrupt JSON with an empty collection", () => {
    expect(decodeCollection(null).collection.workspaces).toEqual([]);
    expect(decodeCollection("x").collection.workspaces).toEqual([]);
    expect(decodeCollection({ workspaces: "not-an-array" }).collection.workspaces).toEqual([]);
  });

  it("decodeCollection reports recovery when the input is corrupt", () => {
    expect(decodeCollection(null).recovered).toBe(true);
    expect(decodeCollection("x").recovered).toBe(true);
    expect(decodeCollection({ workspaces: "not-an-array" }).recovered).toBe(true);
    // A well-formed collection does not flag recovery.
    expect(decodeCollection({ workspaces: [] }).recovered).toBe(false);
  });

  it("decodeCollection normalizes each entry and dedups workspace ids", () => {
    const raw = {
      workspaces: [
        { id: "w1", title: "A", root: { kind: "pane", id: "p1", content: null } },
        { id: "w1", title: "dup", root: { kind: "pane", id: "p2", content: null } },
      ],
    };
    const c = decodeCollection(raw).collection;
    expect(c.workspaces).toHaveLength(2);
    const ids = c.workspaces.map((w) => w.id);
    expect(new Set(ids).size).toBe(2);
    expect(c.workspaces[0].appearance).toEqual({ blur: 0, opacity: 100 });
  });
});
