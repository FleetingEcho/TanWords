import React from "react";
import type { NavPage } from "@/store/navStore";
import { useDragState, DRAG_THRESHOLD_PX } from "./dragState";
import { isPageAvailableOnHost } from "@/store/workspaceStore";
import { getPageDefinition } from "@/pages/pageCatalog";

/** Makes an element a pointer-based drag source for workspace page placement
 *  (mouse + touch + pen), complementing the HTML5 DnD fast path.
 *
 *  On `pointerdown` the source records the page id and start point; window
 *  `pointermove` updates the drag position and flips `active` once the pointer
 *  travels past `DRAG_THRESHOLD_PX` (so a click still navigates). On
 *  `pointerup`, if the drag is active, the hit-test callback fires with the
 *  page id so the caller can drop it on whatever pane is under the pointer.
 *
 *  Returns props to spread onto the source element. The caller also keeps the
 *  HTML5 `usePageDragSource` props for desktop-mouse parity; both paths feed
 *  the same drop-zone logic. */
export function usePointerDragSource(
  pageId: NavPage,
  onDrop: (pageId: NavPage, clientX: number, clientY: number) => void,
) {
  const startRef = React.useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      // The HTML5 Drag and Drop API handles mouse drags (with its own drag
      // image and drop events); the pointer path is for touch and pen, where
      // HTML5 DnD does not fire. Starting a pointer drag for mouse too would
      // double-drop (both paths call place/split), so restrict to non-mouse.
      if (e.pointerType === "mouse") return;
      if (!isPageAvailableOnHost(pageId) || !getPageDefinition(pageId)) return;
      startRef.current = { x: e.clientX, y: e.clientY };
      useDragState.getState().start(pageId, e.clientX, e.clientY);

      const onMove = (ev: PointerEvent) => {
        const s = startRef.current;
        if (!s) return;
        // Activate only once the pointer has travelled past the threshold, so a
        // click on the source navigates rather than starting a drag.
        const dx = ev.clientX - s.x;
        const dy = ev.clientY - s.y;
        const dragging = useDragState.getState().active || dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
        if (!dragging) return;
        useDragState.getState().move(ev.clientX, ev.clientY);
        // Once active, prevent the page underneath from scrolling/selecting
        // during a touch drag.
        ev.preventDefault();
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const st = useDragState.getState();
        startRef.current = null;
        if (st.active) {
          onDrop(pageId, ev.clientX, ev.clientY);
        }
        useDragState.getState().end();
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
    },
    [pageId, onDrop],
  );

  return { onPointerDown };
}

/** Helper: is a pointer drag currently active? Drop zones use this to decide
 *  whether to highlight under the pointer. */
export function useIsPointerDragging(): boolean {
  return useDragState((s) => s.active && s.pageId !== null);
}
