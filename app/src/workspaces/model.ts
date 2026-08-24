import type { NavPage } from "@/store/navStore";

/** The workspace layout model: a recursive binary split tree.
 *
 *  The tree maps directly to edge drops (split a pane on its left/right/top/
 *  bottom edge), serializes cleanly to JSON, and makes divider resizing local
 *  to one branch. Callers never construct or mutate tree nodes directly; they
 *  go through the operations module, which returns a *normalized* document.
 *
 *  IDs are strings. Pane ids and instance ids are distinct namespaces so a move
 *  never accidentally collides a pane id with an instance id. The operations
 *  module mints both; persistence just round-trips them. */

export const WORKSPACE_SCHEMA_VERSION = 1;

export interface WorkspaceAppearance {
  /** Backdrop blur behind each widget surface, in CSS pixels. */
  blur: number;
  /** Widget background tint opacity, from fully transparent to opaque. */
  opacity: number;
}

export const DEFAULT_WORKSPACE_APPEARANCE: WorkspaceAppearance = { blur: 0, opacity: 100 };

export function normalizeWorkspaceAppearance(value: unknown): WorkspaceAppearance {
  const candidate = value && typeof value === "object" ? value as Partial<WorkspaceAppearance> : {};
  const blur = typeof candidate.blur === "number" && Number.isFinite(candidate.blur)
    ? Math.min(30, Math.max(0, Math.round(candidate.blur)))
    : DEFAULT_WORKSPACE_APPEARANCE.blur;
  const opacity = typeof candidate.opacity === "number" && Number.isFinite(candidate.opacity)
    ? Math.min(100, Math.max(0, Math.round(candidate.opacity)))
    : DEFAULT_WORKSPACE_APPEARANCE.opacity;
  return { blur, opacity };
}

/** A hosted page instance inside a pane. Singleton pages are relocated rather
 *  than cloned, so at most one pane in the whole document (across all
 *  workspaces) carries a given singleton page — that cross-document rule is
 *  enforced by the store, not by the model, because it needs to see every
 *  workspace at once. */
export interface PageInstance {
  instanceId: string;
  pageId: NavPage;
  params?: Record<string, string | number | boolean | null>;
}

export type SplitAxis = "horizontal" | "vertical";

export type LayoutNode =
  | { kind: "pane"; id: string; content: PageInstance | null }
  | {
      kind: "split";
      id: string;
      axis: SplitAxis;
      /** Normalized share of the *first* child, in [MIN_RATIO, MAX_RATIO].
       *  `second` gets the rest. Clamped on every operation so a split never
       *  collapses a pane below its usable size. */
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

export interface WorkspaceDocument {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  id: string;
  title: string;
  /** Optional only for compatibility with workspaces saved before appearance
   *  controls existed; decoding and every new document fill in the default. */
  appearance?: WorkspaceAppearance;
  root: LayoutNode;
  createdAt: string;
  updatedAt: string;
}

/** The persisted collection. One entry per user-created workspace, in the
 *  sidebar's display order. The store owns the order; persistence just
 *  round-trips it. */
export interface WorkspaceCollection {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  workspaces: WorkspaceDocument[];
}

/** Ratio bounds. A 20%–80% window keeps both halves usable; the operations
 *  module clamps every split and resize into it. */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

/** Maximum nesting depth of the split tree (a single pane is depth 1). Caps
 *  deeply nested unusable layouts — the plan's non-goal — while still allowing
 *  a rich desktop arrangement. */
export const MAX_DEPTH = 6;

/** Clamp a ratio into the usable window. NaN falls back to 0.5 (a neutral
 *  split); ±Infinity clamp to the respective bound (an unbounded resize
 *  snaps to the edge rather than to the middle). */
export function clampRatio(ratio: number): number {
  if (Number.isNaN(ratio)) return 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}
