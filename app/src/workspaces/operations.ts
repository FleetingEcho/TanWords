import {
  type LayoutNode,
  type WorkspaceDocument,
  type PageInstance,
  type SplitAxis,
  MIN_RATIO,
  MAX_RATIO,
  clampRatio,
  MAX_DEPTH,
} from "./model";
import { depth, findPane, collectPaneIds, normalizeNode } from "./normalization";
import { newPaneId, newSplitId, newInstanceId, newWorkspaceId } from "./ids";
import { monotonicIso } from "./time";

/** Pure workspace operations. Each function takes an immutable document (or
 *  node) and returns a *new* normalized document/node — the inputs are never
 *  mutated. The store calls these and handles persistence + undo checkpoints;
 *  callers never touch tree nodes directly.
 *
 *  Edge semantics (the drop zones a pane exposes):
 *    - "left"/"right"  → a *horizontal* split (children side by side); the new
 *      pane becomes the first or second child respectively.
 *    - "top"/"bottom"  → a *vertical* split (children stacked); the new pane
 *      becomes the first or second child respectively.
 *    - "center"       → fill an empty pane, or swap content (the store confirms
 *      a swap; the operation itself just replaces).
 *
 *  Ratios are clamped to [MIN_RATIO, MAX_RATIO] on every split and resize so a
 *  pane is never squeezed below a usable size. */

export type Edge = "left" | "right" | "top" | "bottom" | "center";

/** A fresh page instance for a page. */
export function makePageInstance(pageId: PageInstance["pageId"], params?: PageInstance["params"]): PageInstance {
  return { instanceId: newInstanceId(), pageId, params };
}

/** Immutably replace a pane by id within a tree, returning a new tree. */
function replacePane(node: LayoutNode, paneId: string, make: (pane: LayoutNode) => LayoutNode): LayoutNode {
  if (node.kind === "pane") {
    return node.id === paneId ? make(node) : node;
  }
  const first = replacePane(node.first, paneId, make);
  const second = replacePane(node.second, paneId, make);
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

/** Whether two axes are the same. Used to merge adjacent splits along the same
 *  axis when a close collapses a branch. */
function sameAxis(a: SplitAxis, b: SplitAxis): boolean {
  return a === b;
}

/** Split a pane along an edge, inserting a new pane beside it. Returns the new
 *  root, or the original root if the pane wasn't found or the depth cap would
 *  be exceeded.
 *
 *  - `page`: the content to place in the *new* pane. The target pane keeps its
 *    content. Pass `null` to split into an empty pane.
 *  - `ratio`: the first child's share after the split (defaults to 0.5). For
 *    a "left"/"top" edge the new pane is first, so its share is `ratio`; for a
 *    "right"/"bottom" edge the new pane is second, so its share is `1 - ratio`.
 */
export function splitPane(
  root: LayoutNode,
  paneId: string,
  edge: Exclude<Edge, "center">,
  page: PageInstance | null,
  ratio: number = 0.5,
): LayoutNode {
  const target = findPane(root, paneId);
  if (!target) return root;
  // Depth cap: a split adds one level above the target pane.
  if (depth(root) >= MAX_DEPTH) return root;
  const r = clampRatio(ratio);
  const axis: SplitAxis = edge === "left" || edge === "right" ? "horizontal" : "vertical";
  const newPane: LayoutNode = { kind: "pane", id: newPaneId(), content: page };
  let first: LayoutNode;
  let second: LayoutNode;
  let firstRatio: number;
  if (edge === "left" || edge === "top") {
    first = newPane;
    second = target;
    firstRatio = r;
  } else {
    first = target;
    second = newPane;
    firstRatio = 1 - r;
  }
  const split: LayoutNode = {
    kind: "split",
    id: newSplitId(),
    axis,
    ratio: clampRatio(firstRatio),
    first,
    second,
  };
  return replacePane(root, paneId, () => split);
}

/** Place content into an empty pane, or replace a pane's content (a swap). For
 *  the "center" drop zone. Returns the new root, or the original if the pane
 *  wasn't found. */
export function setPaneContent(
  root: LayoutNode,
  paneId: string,
  page: PageInstance | null,
): LayoutNode {
  if (!findPane(root, paneId)) return root;
  return replacePane(root, paneId, (pane) => ({ ...pane, content: page }));
}

/** Move a pane's content to a target pane, relocating it. The source pane
 *  becomes empty. Returns the new root, or the original if either pane wasn't
 *  found, source === target, or the source had no content to move. */
export function movePaneContent(
  root: LayoutNode,
  fromPaneId: string,
  toPaneId: string,
): LayoutNode {
  if (fromPaneId === toPaneId) return root;
  const from = findPane(root, fromPaneId);
  if (!from || from.kind !== "pane" || !from.content) return root;
  if (!findPane(root, toPaneId)) return root;
  const content = from.content;
  let next = setPaneContent(root, toPaneId, content);
  next = setPaneContent(next, fromPaneId, null);
  return next;
}

/** Swap two panes' contents without changing the split tree. This is the
 * center-drop meaning for dragging an existing widget onto another widget. */
export function swapPaneContents(root: LayoutNode, firstPaneId: string, secondPaneId: string): LayoutNode {
  if (firstPaneId === secondPaneId) return root;
  const first = findPane(root, firstPaneId);
  const second = findPane(root, secondPaneId);
  if (!first || first.kind !== "pane" || !second || second.kind !== "pane") return root;
  let next = setPaneContent(root, firstPaneId, second.content);
  next = setPaneContent(next, secondPaneId, first.content);
  return next;
}

/** Move an existing pane beside another pane while keeping its id and content.
 * The source is removed from its old branch (which collapses), then inserted
 * on the requested edge of the target. Pane count is unchanged. */
export function movePaneToEdge(
  root: LayoutNode,
  sourcePaneId: string,
  targetPaneId: string,
  edge: Exclude<Edge, "center">,
): LayoutNode {
  if (sourcePaneId === targetPaneId) return root;
  const source = findPane(root, sourcePaneId);
  if (!source || source.kind !== "pane") return root;
  const withoutSource = removePane(root, sourcePaneId);
  if (!withoutSource || !findPane(withoutSource, targetPaneId)) return root;
  const axis: SplitAxis = edge === "left" || edge === "right" ? "horizontal" : "vertical";
  const target = findPane(withoutSource, targetPaneId)!;
  const first = edge === "left" || edge === "top" ? source : target;
  const second = edge === "left" || edge === "top" ? target : source;
  const split: LayoutNode = {
    kind: "split",
    id: newSplitId(),
    axis,
    ratio: 0.5,
    first,
    second,
  };
  return replacePane(withoutSource, targetPaneId, () => split);
}

/** Remove a pane from the tree. Its parent split collapses: the surviving
 *  sibling is lifted into the parent's place. If the root itself is the pane
 *  being removed (or the tree would become empty), the tree resets to a single
 *  empty pane — a workspace always has at least one pane. */
export function closePane(root: LayoutNode, paneId: string): LayoutNode {
  const survivor = removePane(root, paneId);
  if (survivor === null) {
    // The root pane itself was removed (or the whole tree collapsed): reset to
    // a single empty pane so the workspace is never left paneless.
    return { kind: "pane", id: newPaneId(), content: null };
  }
  return collapseRedundant(survivor);
}

/** Recursive removal helper. Returns the node that should replace the input,
 *  or `null` when the input itself was the removed pane (so the parent lifts
 *  its sibling). A split never returns null — at least one child always
 *  survives, and a fully-empty split collapses to a single pane. */
function removePane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.kind === "pane") {
    return node.id === paneId ? null : node;
  }
  const first = removePane(node.first, paneId);
  const second = removePane(node.second, paneId);
  // First child gone → lift the second.
  if (first === null) return second;
  // Second child gone → lift the first.
  if (second === null) return first;
  // Neither changed → keep the split as-is (reference-equal when untouched).
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

/** Collapse splits where both children are empty panes into a single empty
 *  pane, and lift a child that is the only meaningful content. This is what
 *  makes a close cleanly shrink the tree instead of leaving empty husks. */
function collapseRedundant(node: LayoutNode): LayoutNode {
  if (node.kind === "pane") return node;
  const first = collapseRedundant(node.first);
  const second = collapseRedundant(node.second);
  if (first.kind === "pane" && second.kind === "pane" && !first.content && !second.content) {
    return first;
  }
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

/** Resize a split by setting its first-child ratio. Clamped to the usable
 *  window. Returns the new root, or the original if the split wasn't found. */
export function resizeSplit(
  root: LayoutNode,
  splitId: string,
  ratio: number,
): LayoutNode {
  const update = (node: LayoutNode): LayoutNode => {
    if (node.kind === "pane") return node;
    const first = update(node.first);
    const second = update(node.second);
    if (node.id === splitId) {
      return { ...node, ratio: clampRatio(ratio), first, second };
    }
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  };
  return update(root);
}

/** Relocate every pane carrying a given singleton page id to `null`, except
 *  the one whose pane id is `exceptPaneId` (if provided). The store uses this
 *  to enforce the cross-workspace singleton rule: when a singleton is placed
 *  in one pane, any other pane hosting the same page is emptied. Returns the
 *  new root and whether any pane was changed. */
export function clearSingletonElsewhere(
  root: LayoutNode,
  pageId: PageInstance["pageId"],
  exceptPaneId?: string,
): { node: LayoutNode; changed: boolean } {
  let changed = false;
  const update = (node: LayoutNode): LayoutNode => {
    if (node.kind === "pane") {
      if (node.content && node.content.pageId === pageId && node.id !== exceptPaneId) {
        changed = true;
        return { ...node, content: null };
      }
      return node;
    }
    const first = update(node.first);
    const second = update(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  };
  const node = update(root);
  return { node, changed };
}

/** Every pane id that currently hosts a given singleton page id, across the
 *  tree. The store checks this before a placement to decide relocate-vs-clone
 *  and to disable an already-hosted singleton in the picker. */
export function panesHostingPage(root: LayoutNode, pageId: PageInstance["pageId"]): string[] {
  const out: string[] = [];
  const walk = (node: LayoutNode) => {
    if (node.kind === "pane") {
      if (node.content && node.content.pageId === pageId) out.push(node.id);
    } else {
      walk(node.first);
      walk(node.second);
    }
  };
  walk(root);
  return out;
}

/** Replace a document's root with a new node and bump `updatedAt`. The store
 *  uses this to apply an operation result to a document. */
export function applyRoot(doc: WorkspaceDocument, root: LayoutNode): WorkspaceDocument {
  return { ...doc, root, updatedAt: monotonicIso() };
}

/** Re-derive a document from its raw root through normalization (id fixups,
 *  ratio clamps, redundant-branch collapse). The store calls this after
 *  loading from persistence. */
export function normalizeDocumentRoot(doc: WorkspaceDocument): WorkspaceDocument {
  const seen = new Set<string>();
  const root = normalizeNode(doc.root, seen);
  return applyRoot(doc, root);
}

/** Create a brand-new empty workspace document with the given title. */
export function createWorkspace(title: string = ""): WorkspaceDocument {
  const now = monotonicIso();
  return {
    schemaVersion: 1,
    id: newWorkspaceId(),
    title,
    root: { kind: "pane", id: newPaneId(), content: null },
    createdAt: now,
    updatedAt: now,
  };
}

/** Duplicate a workspace: a new id and timestamps, but the same layout tree
 *  (with regenerated pane/instance ids so the copy is independent). Singleton
 *  instances are *not* preserved across the duplicate — the store re-homes
 *  them — but the tree shape and page placements are copied. */
export function duplicateWorkspace(doc: WorkspaceDocument, title?: string): WorkspaceDocument {
  const seen = new Set<string>();
  const root = cloneTree(doc.root, seen);
  const now = monotonicIso();
  return {
    schemaVersion: doc.schemaVersion,
    id: newWorkspaceId(),
    title: title ?? doc.title,
    root,
    createdAt: now,
    updatedAt: now,
  };
}

/** Deep-clone a tree, regenerating every pane/split id and every instance id
 *  so the duplicate is fully independent of the original. */
function cloneTree(node: LayoutNode, seen: Set<string>): LayoutNode {
  if (node.kind === "pane") {
    const id = newPaneId();
    seen.add(id);
    return {
      kind: "pane",
      id,
      content: node.content ? { ...node.content, instanceId: newInstanceId() } : null,
    };
  }
  const id = newSplitId();
  seen.add(id);
  return {
    kind: "split",
    id,
    axis: node.axis,
    ratio: clampRatio(node.ratio),
    first: cloneTree(node.first, seen),
    second: cloneTree(node.second, seen),
  };
}

/** Rename a workspace. Pure: returns a new document with the new title and a
 *  bumped `updatedAt`. */
export function renameWorkspace(doc: WorkspaceDocument, title: string): WorkspaceDocument {
  return { ...doc, title, updatedAt: monotonicIso() };
}

/** Re-expose a couple of model helpers for tests/consumers that want them
 *  alongside the operations. */
export { MIN_RATIO, MAX_RATIO, collectPaneIds, depth };
