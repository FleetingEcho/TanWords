import { create } from "zustand";
import type { NavPage } from "@/store/navStore";
import type {
  WorkspaceDocument,
  WorkspaceCollection,
  LayoutNode,
  PageInstance,
  WorkspaceAppearance,
} from "@/workspaces/model";
import { normalizeWorkspaceAppearance } from "@/workspaces/model";
import {
  decodeCollection,
  encodeCollection,
  collectPaneIds,
  findPane,
  paneCount,
} from "@/workspaces/normalization";
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
  applyRoot,
  createWorkspace,
  duplicateWorkspace,
  renameWorkspace,
  makePageInstance,
  normalizeDocumentRoot,
  type Edge,
} from "@/workspaces/operations";
import { getPageDefinition } from "@/pages/pageCatalog";
import { hostCapabilities } from "@/platform";
import {
  cachedWorkspaces,
  cacheWorkspaces,
  loadDurableWorkspaces,
  saveDurableWorkspaces,
  saveDurableWorkspacesDebounced,
} from "@/workspaces/persistence";
import { monotonicIso } from "@/workspaces/time";

/** The workspace store: the deep module's public interface. Callers (sidebar,
 *  picker, pane controls) never touch tree nodes — they call these actions,
 *  which own validation, split math, moves, cleanup, singleton rules, undo,
 *  and persistence.
 *
 *  Persistence follows the existing navigation-layout pattern: a synchronous
 *  localStorage cache gives the first render the right value, and a durable
 *  user-settings row is reconciled after it loads. Structural actions persist
 *  immediately; divider drags debounce. One in-memory structural checkpoint
 *  powers Undo. */

/** A page is available for placement on this host when its capability (if
 *  any) is present. The picker uses this to filter and to explain why a page
 *  is disabled. */
export function isPageAvailableOnHost(pageId: NavPage): boolean {
  const def = getPageDefinition(pageId);
  if (!def) return false;
  if (!def.capability) return true;
  return !!hostCapabilities[def.capability];
}

/** A workspace stays intentionally small enough that every pane remains
 * useful and every divider remains easy to grab. */
export const MAX_WORKSPACE_PANES = 4;

interface WorkspaceState {
  /** The workspace collection, in sidebar display order. */
  workspaces: WorkspaceDocument[];
  /** Whether the durable value has been loaded and reconciled yet. False
   *  until `init()` resolves; the cache is shown in the meantime. */
  loaded: boolean;
  /** The active workspace id, mirrored from navStore so workspace UI reads
   *  one store. Kept in sync by `selectWorkspace`. */
  activeWorkspaceId: string | null;
  /** The pane currently focused within the active workspace (workspace focus
   *  mode), or `null` when no single pane is focused. */
  focusedPaneId: string | null;
  /** Last pane the user interacted with. Workspace-level split controls use
   *  this as their target without forcing the pane into maximize mode. */
  selectedPaneId: string | null;
  /** True while destructive layout actions (replace/close/reset/undo) are
   *  exposed. Dragging and splitting remain available during ordinary use. */
  editMode: boolean;
  /** One structural checkpoint for Undo. Captured before each structural
   *  action; `undo()` restores it. */
  undoCheckpoint: WorkspaceCollection | null;
  /** True once after `init()` if the durable value (or, failing that, the
   *  cache) was present but corrupt and had to be reset to a usable
   *  collection. The UI shows a one-time notice; `acknowledgeRecovery`
   *  clears it so it does not nag across restarts within a session. */
  recoveredFromCorrupt: boolean;

  // ── lifecycle ───────────────────────────────────────────────────────────
  init: () => Promise<void>;
  /** Reconcile a durable collection with the in-memory one. The durable
   *  value wins if it has a newer `updatedAt` or the in-memory state is the
   *  untouched cache. `recovered` records whether the durable value was
   *  corrupt and had to be reset. */
  reconcile: (durable: WorkspaceCollection | null, recovered?: boolean) => void;
  /** Clear the `recoveredFromCorrupt` flag after the user has seen the
   *  notice. */
  acknowledgeRecovery: () => void;

  // ── selection ───────────────────────────────────────────────────────────
  selectWorkspace: (id: string | null) => void;
  activeWorkspace: () => WorkspaceDocument | null;

  // ── CRUD ────────────────────────────────────────────────────────────────
  create: (title?: string) => string;
  rename: (id: string, title: string) => void;
  duplicate: (id: string, title?: string) => string;
  reorder: (ids: string[]) => void;
  remove: (id: string) => void;
  reset: (id: string) => void;
  /** Update the current workspace's widget glass appearance. Slider changes
   *  cache immediately and debounce the durable database write. */
  setAppearance: (id: string, appearance: WorkspaceAppearance) => void;
  undo: () => void;

  // ── pane operations (all on the active workspace) ───────────────────────
  split: (paneId: string, edge: Exclude<Edge, "center">, pageId: NavPage, params?: PageInstance["params"]) => void;
  splitEmpty: (paneId: string, edge: Exclude<Edge, "center">) => void;
  place: (paneId: string, pageId: NavPage, params?: PageInstance["params"]) => void;
  movePane: (fromPaneId: string, toPaneId: string) => void;
  movePaneToEdge: (fromPaneId: string, toPaneId: string, edge: Exclude<Edge, "center">) => void;
  swapPanes: (firstPaneId: string, secondPaneId: string) => void;
  closePane: (paneId: string) => void;
  resize: (splitId: string, ratio: number) => void;
  setFocus: (paneId: string | null) => void;
  setSelectedPane: (paneId: string | null) => void;
  setEditMode: (on: boolean) => void;

  // ── queries ─────────────────────────────────────────────────────────────
  /** Pane ids hosting a singleton page across *all* workspaces. The picker
   *  uses this to disable an already-hosted singleton and offer "Move here". */
  singletonLocations: (pageId: NavPage) => { workspaceId: string; paneId: string }[];
}

/** Snapshot the collection for an undo checkpoint, then persist. */
function checkpointAndPersist(state: WorkspaceState): {
  undoCheckpoint: WorkspaceCollection;
  workspaces: WorkspaceDocument[];
} {
  return {
    undoCheckpoint: { schemaVersion: 1, workspaces: state.workspaces },
    workspaces: state.workspaces,
  };
}

/** Persist the current collection to both cache (sync) and durable (async),
 *  after first updating the cache so the next render is immediate. */
let structuralRevision = 0;

function persist(
  workspaces: WorkspaceDocument[],
  structural: boolean,
  source: "local" | "database" = "local",
) {
  // A startup database read is asynchronous. Track structural edits made
  // while that read is in flight so its older snapshot cannot overwrite a
  // workspace the user just created/renamed/rearranged.
  if (structural && source === "local") structuralRevision += 1;
  const collection: WorkspaceCollection = { schemaVersion: 1, workspaces };
  cacheWorkspaces(collection);
  if (structural) saveDurableWorkspaces(collection);
  else saveDurableWorkspacesDebounced(collection);
}

/** Apply an operation to the active workspace's root, enforce the singleton
 *  rule across all workspaces, persist, and return the new collection. */
function applyToActive(
  state: WorkspaceState,
  fn: (root: LayoutNode, ws: WorkspaceDocument) => LayoutNode,
  structural: boolean = true,
): Partial<WorkspaceState> {
  const activeId = state.activeWorkspaceId;
  if (!activeId) return {};
  const idx = state.workspaces.findIndex((w) => w.id === activeId);
  if (idx < 0) return {};
  const ws = state.workspaces[idx];
  const newRoot = fn(ws.root, ws);
  const updated = applyRoot(ws, newRoot);
  const workspaces = state.workspaces.slice();
  workspaces[idx] = updated;
  persist(workspaces, structural);
  return { workspaces, undoCheckpoint: structural ? { schemaVersion: 1, workspaces: state.workspaces } : state.undoCheckpoint };
}

/** Enforce the singleton rule: after placing a singleton page in `keepPaneId`
 *  of the active workspace, clear that page from every other pane in every
 *  workspace (including other panes of the same workspace). Returns the new
 *  collection and whether anything changed. */
function enforceSingletonEverywhere(
  workspaces: WorkspaceDocument[],
  activeId: string,
  keepPaneId: string,
  pageId: NavPage,
): WorkspaceDocument[] {
  const def = getPageDefinition(pageId);
  if (!def || def.multiplicity !== "singleton") return workspaces;
  let changed = false;
  const next: WorkspaceDocument[] = workspaces.map((ws) => {
    // The active workspace's keep-pane is exempt; every other pane (in every
    // workspace, including this one) that hosts the same singleton is emptied.
    const except = ws.id === activeId ? keepPaneId : undefined;
    const res = clearSingletonElsewhere(ws.root, pageId, except);
    if (!res.changed) return ws;
    changed = true;
    return applyRoot(ws, res.node);
  });
  return changed ? next : workspaces;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: cachedWorkspaces().collection.workspaces,
  loaded: false,
  activeWorkspaceId: null,
  focusedPaneId: null,
  selectedPaneId: null,
  editMode: false,
  undoCheckpoint: null,
  recoveredFromCorrupt: false,

  init: async () => {
    if (get().loaded) return;
    const revisionAtStart = structuralRevision;
    const { collection, recovered } = await loadDurableWorkspaces();
    if (structuralRevision !== revisionAtStart) {
      // The user edited the cached collection while the database read was in
      // flight. Keep that newer state and write it back; applying `collection`
      // here would resurrect the stale pre-edit snapshot.
      persist(get().workspaces, true);
      set({ loaded: true });
      return;
    }
    get().reconcile(collection, recovered);
    set({ loaded: true });
  },

  reconcile: (durable, recovered = false) => {
    if (!durable) {
      // Nothing persisted durably yet — keep the cache, but mark loaded so the
      // first structural action persists from here.
      return;
    }
    // Durable wins: it is the authoritative cross-device value. Re-derive
    // from it so a corrupt cache never sticks. The cache is refreshed so the
    // next render is consistent.
    const workspaces = durable.workspaces.map(normalizeDocumentRoot);
    persist(workspaces, true, "database");
    set({ workspaces, recoveredFromCorrupt: recovered });
  },

  acknowledgeRecovery: () => set({ recoveredFromCorrupt: false }),

  selectWorkspace: (id) => {
    const workspace = id ? get().workspaces.find((candidate) => candidate.id === id) : null;
    const selectedPaneId = workspace ? [...collectPaneIds(workspace.root)][0] ?? null : null;
    set({ activeWorkspaceId: id, focusedPaneId: null, selectedPaneId, editMode: false });
  },

  activeWorkspace: () => {
    const { workspaces, activeWorkspaceId } = get();
    if (!activeWorkspaceId) return null;
    return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  },

  create: (title) => {
    const ws = createWorkspace(title || "");
    const workspaces = [...get().workspaces, ws];
    persist(workspaces, true);
    set({
      workspaces,
      undoCheckpoint: { schemaVersion: 1, workspaces: get().workspaces },
      activeWorkspaceId: ws.id,
      focusedPaneId: null,
      selectedPaneId: ws.root.kind === "pane" ? ws.root.id : null,
      editMode: false,
    });
    return ws.id;
  },

  rename: (id, title) => {
    const workspaces = get().workspaces.map((w) => (w.id === id ? renameWorkspace(w, title) : w));
    persist(workspaces, true);
    set({
      workspaces,
      undoCheckpoint: { schemaVersion: 1, workspaces: get().workspaces },
    });
  },

  duplicate: (id, title) => {
    const src = get().workspaces.find((w) => w.id === id);
    if (!src) return "";
    // Singleton instances in the copy are dropped: they would violate the
    // one-instance rule alongside the original. The tree shape is preserved.
    const copy = duplicateWorkspace(src, title);
    let copyRoot = copy.root;
    const singletonPages = new Set<NavPage>();
    for (const w of get().workspaces) {
      for (const pid of collectPaneIds(w.root)) {
        const p = findPane(w.root, pid);
        if (p && p.kind === "pane" && p.content) {
          const def = getPageDefinition(p.content.pageId);
          if (def && def.multiplicity === "singleton") singletonPages.add(p.content.pageId);
        }
      }
    }
    for (const sp of singletonPages) {
      copyRoot = clearSingletonElsewhere(copyRoot, sp).node;
    }
    const dup = { ...copy, root: copyRoot };
    const workspaces = [...get().workspaces, dup];
    persist(workspaces, true);
    set({
      workspaces,
      undoCheckpoint: { schemaVersion: 1, workspaces: get().workspaces },
    });
    return dup.id;
  },

  reorder: (ids) => {
    const byId = new Map(get().workspaces.map((w) => [w.id, w]));
    const workspaces = ids.map((id) => byId.get(id)).filter((w): w is WorkspaceDocument => !!w);
    // Any workspaces not in `ids` keep their relative order at the end.
    for (const w of get().workspaces) if (!ids.includes(w.id)) workspaces.push(w);
    persist(workspaces, true);
    set({
      workspaces,
      undoCheckpoint: { schemaVersion: 1, workspaces: get().workspaces },
    });
  },

  remove: (id) => {
    const workspaces = get().workspaces.filter((w) => w.id !== id);
    persist(workspaces, true);
    set((s) => ({
      workspaces,
      undoCheckpoint: { schemaVersion: 1, workspaces: s.workspaces },
      activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
    }));
  },

  reset: (id) => {
    const ws = get().workspaces.find((w) => w.id === id);
    if (!ws) return;
    const fresh = createWorkspace(ws.title);
    const workspaces = get().workspaces.map((w) => (w.id === id ? {
      ...fresh,
      id: w.id,
      createdAt: w.createdAt,
      appearance: normalizeWorkspaceAppearance(w.appearance),
    } : w));
    persist(workspaces, true);
    set({
      workspaces,
      undoCheckpoint: { schemaVersion: 1, workspaces: get().workspaces },
      focusedPaneId: null,
    });
  },

  setAppearance: (id, appearance) => {
    const normalized = normalizeWorkspaceAppearance(appearance);
    const workspaces = get().workspaces.map((workspace) => workspace.id === id
      ? { ...workspace, appearance: normalized, updatedAt: monotonicIso() }
      : workspace);
    persist(workspaces, false);
    set({ workspaces });
  },

  undo: () => {
    const cp = get().undoCheckpoint;
    if (!cp) return;
    persist(cp.workspaces, true);
    set({ workspaces: cp.workspaces, undoCheckpoint: null, focusedPaneId: null });
  },

  split: (paneId, edge, pageId, params) => {
    if (!isPageAvailableOnHost(pageId)) return;
    const activeId = get().activeWorkspaceId;
    if (!activeId) return;
    const current = get().activeWorkspace();
    if (!current || paneCount(current.root) >= MAX_WORKSPACE_PANES) return;
    const instance = makePageInstance(pageId, params);
    const partial = applyToActive(get(), (root) => splitPane(root, paneId, edge, instance), true);
    if (!partial.workspaces) return;
    // Enforce singleton across all workspaces, keeping the new pane.
    const newPaneId = (() => {
      // The new pane is the one we just inserted; find it by the instance.
      const ws = partial.workspaces!.find((w) => w.id === activeId)!;
      return panesHostingPage(ws.root, pageId).find((pid) => pid !== paneId) ?? paneId;
    })();
    const workspaces = enforceSingletonEverywhere(partial.workspaces, activeId, newPaneId, pageId);
    persist(workspaces, true);
    set({ workspaces, undoCheckpoint: partial.undoCheckpoint });
  },

  splitEmpty: (paneId, edge) => {
    const activeId = get().activeWorkspaceId;
    const current = get().activeWorkspace();
    if (!activeId || !current || paneCount(current.root) >= MAX_WORKSPACE_PANES) return;
    const previousIds = new Set(collectPaneIds(current.root));
    const partial = applyToActive(get(), (root) => splitPane(root, paneId, edge, null), true);
    if (!partial.workspaces) return;
    const next = partial.workspaces.find((workspace) => workspace.id === activeId);
    const selectedPaneId = next
      ? [...collectPaneIds(next.root)].find((id) => !previousIds.has(id)) ?? paneId
      : paneId;
    persist(partial.workspaces, true);
    set({
      workspaces: partial.workspaces,
      undoCheckpoint: partial.undoCheckpoint,
      selectedPaneId,
    });
  },

  place: (paneId, pageId, params) => {
    if (!isPageAvailableOnHost(pageId)) return;
    const activeId = get().activeWorkspaceId;
    if (!activeId) return;
    const instance = makePageInstance(pageId, params);
    const partial = applyToActive(get(), (root) => setPaneContent(root, paneId, instance), true);
    if (!partial.workspaces) return;
    const workspaces = enforceSingletonEverywhere(partial.workspaces, activeId, paneId, pageId);
    persist(workspaces, true);
    set({ workspaces, undoCheckpoint: partial.undoCheckpoint });
  },

  movePane: (fromPaneId, toPaneId) => {
    const partial = applyToActive(get(), (root) => movePaneContent(root, fromPaneId, toPaneId), true);
    if (!partial.workspaces) return;
    set({ workspaces: partial.workspaces, undoCheckpoint: partial.undoCheckpoint });
  },

  movePaneToEdge: (fromPaneId, toPaneId, edge) => {
    const partial = applyToActive(get(), (root) => movePaneToEdge(root, fromPaneId, toPaneId, edge), true);
    if (!partial.workspaces) return;
    persist(partial.workspaces, true);
    set({
      workspaces: partial.workspaces,
      undoCheckpoint: partial.undoCheckpoint,
      selectedPaneId: fromPaneId,
    });
  },

  swapPanes: (firstPaneId, secondPaneId) => {
    const partial = applyToActive(get(), (root) => swapPaneContents(root, firstPaneId, secondPaneId), true);
    if (!partial.workspaces) return;
    persist(partial.workspaces, true);
    set({
      workspaces: partial.workspaces,
      undoCheckpoint: partial.undoCheckpoint,
      selectedPaneId: secondPaneId,
    });
  },

  closePane: (paneId) => {
    const partial = applyToActive(get(), (root) => closePane(root, paneId), true);
    if (!partial.workspaces) return;
    const activeId = get().activeWorkspaceId;
    if (!activeId) { set({ workspaces: partial.workspaces, undoCheckpoint: partial.undoCheckpoint }); return; }
    const ws = partial.workspaces.find((w) => w.id === activeId);
    // Closing the last pane resets to one empty pane (closePane guarantees
    // this), so the workspace is never paneless. Clear focus if it pointed
    // at the closed pane.
    const focusedPaneId = ws && paneCount(ws.root) <= 1 ? null : get().focusedPaneId === paneId ? null : get().focusedPaneId;
    const selectedPaneId = get().selectedPaneId === paneId
      ? (ws ? [...collectPaneIds(ws.root)][0] ?? null : null)
      : get().selectedPaneId;
    persist(partial.workspaces, true);
    set({ workspaces: partial.workspaces, undoCheckpoint: partial.undoCheckpoint, focusedPaneId, selectedPaneId });
  },

  resize: (splitId, ratio) => {
    // Debounced: divider drags fire many times per gesture.
    const partial = applyToActive(get(), (root) => resizeSplit(root, splitId, ratio), false);
    if (!partial.workspaces) return;
    set({ workspaces: partial.workspaces });
  },

  setFocus: (paneId) => set({ focusedPaneId: paneId }),

  setSelectedPane: (paneId) => set({ selectedPaneId: paneId }),

  setEditMode: (on) => set({ editMode: on }),

  singletonLocations: (pageId) => {
    const out: { workspaceId: string; paneId: string }[] = [];
    for (const ws of get().workspaces) {
      for (const paneId of panesHostingPage(ws.root, pageId)) {
        out.push({ workspaceId: ws.id, paneId });
      }
    }
    return out;
  },
}));

/** Encode the current collection for external consumers (e.g. export, tests). */
export function encodeCurrentCollection(): WorkspaceCollection {
  return encodeCollection({ schemaVersion: 1, workspaces: useWorkspaceStore.getState().workspaces });
}
