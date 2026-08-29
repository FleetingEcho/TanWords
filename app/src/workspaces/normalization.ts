import {
  type LayoutNode,
  type WorkspaceDocument,
  type WorkspaceCollection,
  type PageInstance,
  type SplitAxis,
  WORKSPACE_SCHEMA_VERSION,
  DEFAULT_WORKSPACE_APPEARANCE,
  normalizeWorkspaceAppearance,
  clampRatio,
  MAX_DEPTH,
} from "./model";
import { newPaneId, newSplitId, newInstanceId, newWorkspaceId } from "./ids";
import { monotonicIso } from "./time";
import type { NavPage } from "@/store/navStore";

/** The set of valid NavPage ids. The model cannot import the full navStore
 *  (and shouldn't — it's pure data), so we keep the literal list here in sync
 *  with `NavPage`. The decoder rejects a page instance whose pageId isn't in
 *  this set. Update both when a page is added. */
const VALID_PAGE_IDS: ReadonlySet<string> = new Set<NavPage>([
  "dashboard", "calendar", "feeds", "reading", "music", "vocabulary",
  "documents", "chat", "browser", "terminal", "tools", "dsh", "settings",
]);

/** Depth of a node: a pane is depth 1, a split is 1 + max(child depths). */
export function depth(node: LayoutNode): number {
  if (node.kind === "pane") return 1;
  return 1 + Math.max(depth(node.first), depth(node.second));
}

/** Count the panes in a subtree. Used by the store to enforce "closing the
 *  final pane returns the workspace to one empty pane". */
export function paneCount(node: LayoutNode): number {
  if (node.kind === "pane") return 1;
  return paneCount(node.first) + paneCount(node.second);
}

/** Does this subtree hold any page content at all? Used by the depth cap to
 *  decide which child to keep when a split must be pruned. */
function collectPaneContent(node: LayoutNode): boolean {
  if (node.kind === "pane") return node.content !== null;
  return collectPaneContent(node.first) || collectPaneContent(node.second);
}

/** Collect every pane id in a subtree. Used to detect duplicate ids during
 *  normalization and to find a pane by id. */
export function collectPaneIds(node: LayoutNode, out: Set<string> = new Set()): Set<string> {
  if (node.kind === "pane") {
    out.add(node.id);
  } else {
    collectPaneIds(node.first, out);
    collectPaneIds(node.second, out);
  }
  return out;
}

/** Find a pane node by id. Returns the node or null. */
export function findPane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.kind === "pane") return node.id === paneId ? node : null;
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

/** A fresh empty workspace: one empty pane, no content. The starting point for
 *  every user-created workspace. */
export function emptyWorkspace(title: string = "", id?: string): WorkspaceDocument {
  const now = monotonicIso();
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: id ?? newWorkspaceId(),
    title,
    appearance: { ...DEFAULT_WORKSPACE_APPEARANCE },
    root: { kind: "pane", id: newPaneId(), content: null },
    createdAt: now,
    updatedAt: now,
  };
}

/** Whether a page instance is well-formed: has an instanceId and a valid
 *  pageId. Params are optional and unchecked here (they're page-specific). */
function isValidPageInstance(c: unknown): c is PageInstance {
  if (!c || typeof c !== "object") return false;
  const p = c as Record<string, any>;
  return typeof p.instanceId === "string" && typeof p.pageId === "string" && VALID_PAGE_IDS.has(p.pageId);
}

/** Normalize a single node: regenerate/fix ids, clamp ratios, drop redundant
 *  split branches, cap depth, and ensure every pane has an id. Returns a fresh
 *  tree — the input is never mutated. */
export function normalizeNode(node: unknown, seenIds: Set<string>): LayoutNode {
  if (!node || typeof node !== "object") {
    return { kind: "pane", id: mintFreshId(seenIds, "pane"), content: null };
  }
  const n = node as Record<string, any>;
  if (n.kind === "pane") {
    const id = ensureId(n.id, seenIds, "pane");
    const content = isValidPageInstance(n.content) ? { ...n.content } : null;
    return { kind: "pane", id, content };
  }
  if (n.kind === "split") {
    const axis: SplitAxis = n.axis === "vertical" ? "vertical" : "horizontal";
    const first = normalizeNode(n.first, seenIds);
    const second = normalizeNode(n.second, seenIds);
    const ratio = clampRatio(typeof n.ratio === "number" ? n.ratio : 0.5);
    const id = ensureId(n.id, seenIds, "split");
    // Collapse a redundant split: if both children are empty panes, keep one
    // pane. This is how "close the final pane in a branch" collapses cleanly.
    if (first.kind === "pane" && second.kind === "pane" && !first.content && !second.content) {
      return first;
    }
    // Cap depth: if this split would exceed MAX_DEPTH, replace it with the
    // child that holds the content (already normalized). This prunes
    // over-nested trees from corrupt or hand-edited JSON without losing the
    // populated branch — keeping `first` unconditionally could discard every
    // page instance when the content lives in `second` (e.g. `first` is the
    // empty pane a collapsed branch leaves behind).
    const splitDepth = 1 + Math.max(depth(first), depth(second));
    if (splitDepth > MAX_DEPTH) {
      return collectPaneContent(second) && !collectPaneContent(first) ? second : first;
    }
    return { kind: "split", id, axis, ratio, first, second };
  }
  // Unknown kind — treat as an empty pane.
  return { kind: "pane", id: mintFreshId(seenIds, "pane"), content: null };
}

/** Mint a fresh id of the given kind, or accept an existing id if it is a
 *  string and not already used. Duplicates are regenerated so a corrupt tree
 *  with the same pane id twice can't confuse a find-by-id lookup. */
function ensureId(raw: unknown, seen: Set<string>, kind: "pane" | "split"): string {
  if (typeof raw === "string" && raw && !seen.has(raw)) {
    seen.add(raw);
    return raw;
  }
  return mintFreshId(seen, kind);
}

function mintFreshId(seen: Set<string>, kind: "pane" | "split"): string {
  const id = kind === "pane" ? newPaneId() : newSplitId();
  seen.add(id);
  return id;
}

/** Normalize a whole document: fix the root, timestamps, schema version, and
 *  title. Always returns a document with at least one pane (an empty one if
 *  the root was unparseable). */
export function normalizeDocument(doc: unknown): WorkspaceDocument {
  const seenIds = new Set<string>();
  const now = monotonicIso();
  if (!doc || typeof doc !== "object") {
    return emptyWorkspace();
  }
  const d = doc as Record<string, any>;
  const root = normalizeNode(d.root, seenIds);
  const id = typeof d.id === "string" && d.id ? d.id : newWorkspaceId();
  const title = typeof d.title === "string" ? d.title : "";
  const appearance = normalizeWorkspaceAppearance(d.appearance);
  const createdAt = typeof d.createdAt === "string" ? d.createdAt : now;
  const updatedAt = typeof d.updatedAt === "string" ? d.updatedAt : now;
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id,
    title,
    appearance,
    root,
    createdAt,
    updatedAt,
  };
}

/** Decode and normalize a persisted collection. Falls back to an empty
 *  collection if the input is corrupt, so the app always starts with a usable
 *  (if blank) workspace list. Duplicates of the same workspace id are kept
 *  distinct by regenerating the duplicate's id, so two workspaces never share
 *  an id.
 *
 *  `recovered` is true when the input was malformed enough that some or all of
 *  it was discarded (a non-object root, a non-array workspace list, or a
 *  workspace entry that normalized to the empty fallback). The store surfaces
 *  this so the UI can tell the user their saved workspaces were reset — a
 *  silent reset would look like data loss. */
export function decodeCollection(raw: unknown): { collection: WorkspaceCollection; recovered: boolean } {
  if (!raw || typeof raw !== "object") {
    return { collection: { schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces: [] }, recovered: true };
  }
  const c = raw as Record<string, any>;
  const list = Array.isArray(c.workspaces) ? c.workspaces : [];
  const seenWsIds = new Set<string>();
  const workspaces: WorkspaceDocument[] = [];
  let recovered = !Array.isArray(c.workspaces);
  for (const entry of list) {
    const doc = normalizeDocument(entry);
    // normalizeDocument returns the empty fallback for a malformed entry.
    if (!entry || typeof entry !== "object") recovered = true;
    let id = doc.id;
    if (seenWsIds.has(id)) {
      id = newWorkspaceId();
    }
    seenWsIds.add(id);
    workspaces.push({ ...doc, id });
  }
  return { collection: { schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces }, recovered };
}

/** Encode a collection to a plain object for JSON persistence. */
export function encodeCollection(c: WorkspaceCollection): WorkspaceCollection {
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces: c.workspaces.map((w) => w) };
}

/** Migrate a persisted value of unknown schema version to the current
 *  schema. Today there is only version 1, so anything that decodes to a
 *  valid collection is kept; anything else falls back to empty. When a v2
 *  arrives, branch on `schemaVersion` here. Returns the collection and
 *  whether recovery from corrupt input occurred. */
export function migrate(raw: unknown): { collection: WorkspaceCollection; recovered: boolean } {
  return decodeCollection(raw);
}
