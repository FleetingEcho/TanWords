import React from "react";
import type { NavPage } from "@/store/navStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useDragState } from "./dragState";
import { isPageAvailableOnHost } from "@/store/workspaceStore";
import { getPageDefinition } from "@/pages/pageCatalog";

/** Computes which drop zone a pointer is in, given the pane's bounding rect
 *  and the pointer's client coordinates. The center 50% is the fill/swap zone;
 *  the outer bands are the four edges. Returns null if the point is outside
 *  the rect. Pure — extracted so the dispatcher and tests share one rule. */
export function zoneAtPoint(
  rect: DOMRect,
  x: number,
  y: number,
  hasContent: boolean,
): "center" | "left" | "right" | "top" | "bottom" | null {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const relX = (x - rect.left) / rect.width; // 0..1
  const relY = (y - rect.top) / rect.height;
  // An empty pane only has the center fill — edges make no sense without
  // content to split.
  if (!hasContent) return "center";
  const edge = 0.25;
  if (relX < edge) return "left";
  if (relX > 1 - edge) return "right";
  if (relY < edge) return "top";
  if (relY > 1 - edge) return "bottom";
  return "center";
}

/** Mounted once (inside `WorkspaceScreen`) to catch pointer-based drops: when
 *  a pointer drag is active and the user releases, find the pane under the
 *  pointer and apply the split/place for the zone the pointer is in. This is
 *  the touch/pen counterpart to the HTML5 drop handlers in `DropZones`. */
export function PointerDropDispatcher() {
  const split = useWorkspaceStore((s) => s.split);
  const place = useWorkspaceStore((s) => s.place);

  React.useEffect(() => {
    // The listener stays mounted for the workspace's lifetime so a drop is
    // caught even if the pointerup lands in the same tick the drag activated.
    // The handler reads the latest drag state from the store.
    const onUp = (e: PointerEvent) => {
      const st = useDragState.getState();
      if (!st.active || !st.pageId) return;
      const pageId = st.pageId as NavPage;
      if (!isPageAvailableOnHost(pageId) || !getPageDefinition(pageId)) return;
      // Find the pane under the pointer. `elementsFromPoint` is the fast path
      // in real browsers; fall back to hit-testing every [data-pane-id] rect
      // (jsdom lacks elementsFromPoint, and the fallback is cheap for the
      // small number of panes a workspace holds).
      const findPaneAt = (x: number, y: number): HTMLElement | null => {
        if (typeof document.elementsFromPoint === "function") {
          const hit = document.elementsFromPoint(x, y).find((el) => el.closest("[data-pane-id]"));
          const pane = hit?.closest("[data-pane-id]") as HTMLElement | null;
          if (pane) return pane;
        }
        const panes = Array.from(document.querySelectorAll<HTMLElement>("[data-pane-id]"));
        for (const el of panes) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
        }
        return null;
      };
      const paneEl = findPaneAt(e.clientX, e.clientY);
      if (!paneEl) return;
      const paneId = paneEl.getAttribute("data-pane-id");
      if (!paneId) return;
      const rect = paneEl.getBoundingClientRect();
      const hasContent = paneEl.getAttribute("data-pane-content") === "true";
      const zone = zoneAtPoint(rect, e.clientX, e.clientY, hasContent);
      if (!zone) return;
      if (zone === "center") place(paneId, pageId);
      else split(paneId, zone, pageId);
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [split, place]);

  return null;
}
