import { create } from "zustand";
import type { NavPage } from "@/store/navStore";

/** Global drag state for workspace page placement.
 *
 *  The HTML5 Drag and Drop API does not fire on touch devices, so the sidebar
 *  page sources also drive a pointer-events drag (mouse + touch + pen): on
 *  pointerdown the source records the page id; once the pointer moves past a
 *  small threshold a drag is "active" and a `<DragLayer>` overlay follows the
 *  pointer, while each pane's drop zones highlight under the pointer and
 *  accept the drop on pointerup. The HTML5 path stays as a desktop-mouse
 *  fast path; this pointer path adds touch and a custom preview.
 *
 *  A single zustand atom holds the in-flight drag so any component (the
 *  source, the drag layer, every pane's drop zones) reads the same state
 *  without prop threading. */
interface DragState {
  /** The page being dragged, or null when no drag is in flight. */
  pageId: NavPage | null;
  /** The pointer's last client coordinates, updated on every pointermove. The
   *  drag layer reads these to position the preview. */
  x: number;
  y: number;
  /** True once the pointer has moved past the activation threshold, so a
   *  tap/click on a sidebar item does not start a drag. */
  active: boolean;
  start: (pageId: NavPage, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: () => void;
}

export const useDragState = create<DragState>((set) => ({
  pageId: null,
  x: 0,
  y: 0,
  active: false,
  start: (pageId, x, y) => set({ pageId, x, y, active: false }),
  move: (x, y) => set((s) => (s.pageId ? { x, y, active: true } : s)),
  end: () => set({ pageId: null, x: 0, y: 0, active: false }),
}));

/** Activation threshold in CSS pixels. A pointer must travel this far from
 *  its start before the drag becomes active, so a click on a sidebar item
 *  navigates rather than drags. */
export const DRAG_THRESHOLD_PX = 6;
