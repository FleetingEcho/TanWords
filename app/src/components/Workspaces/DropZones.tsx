import React from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { NavPage } from "@/store/navStore";
import { isPageAvailableOnHost } from "@/store/workspaceStore";
import { getPageDefinition } from "@/pages/pageCatalog";
import { useBlockBrowserPanel } from "@/store/browserPanelStore";
import { useBlockDshPanel } from "@/store/dshPanelBlockStore";

/** The five drop zones (center, left, right, top, bottom) shown over a pane
 *  while a page is being dragged onto it. Uses the HTML5 Drag and Drop API so
 *  no drag library is required for v1; the drag layer / touch / accessible
 *  overlay polish is Phase 5.
 *
 *  - Edge zones (left/right/top/bottom) create a 50/50 split.
 *  - Center fills an empty pane or replaces content (the store's `place`
 *    action; a non-empty center drop is a swap).
 *
 *  The dragged page id rides the drag event's `dataTransfer` as the custom
 *  MIME type `application/x-tanwords-page`. */
export const PAGE_DRAG_MIME = "application/x-tanwords-page";
export const PANE_DRAG_MIME = "application/x-tanwords-pane";

export interface DropZonesProps {
  paneId: string;
  hasContent: boolean;
  /** Clear the owning pane's drag state after this nested handler stops event
   * propagation. Without this callback the drop overlay remains mounted. */
  onDropComplete?: () => void;
}

type Zone = "center" | "left" | "right" | "top" | "bottom";

/** Read the dragged page id from a drag event, validating host availability. */
function draggedPage(e: React.DragEvent): { pageId: NavPage; sourcePaneId: string | null } | null {
  const raw = e.dataTransfer.getData(PAGE_DRAG_MIME) as NavPage;
  if (!raw) return null;
  if (!isPageAvailableOnHost(raw)) return null;
  if (!getPageDefinition(raw)) return null;
  return { pageId: raw, sourcePaneId: e.dataTransfer.getData(PANE_DRAG_MIME) || null };
}

export function DropZones({ paneId, hasContent, onDropComplete }: DropZonesProps) {
  const split = useWorkspaceStore((s) => s.split);
  const place = useWorkspaceStore((s) => s.place);
  const movePaneToEdge = useWorkspaceStore((s) => s.movePaneToEdge);
  const swapPanes = useWorkspaceStore((s) => s.swapPanes);
  const [active, setActive] = React.useState<Zone | null>(null);
  // The drop overlay sits above this pane's content, but a native
  // `WebContentsView` (browser/dsh) in *another* pane composites above all
  // HTML regardless of z-index — so it would paint over the overlay. Block
  // both native surfaces for the lifetime of the overlay, the same way a
  // modal does, so the drag overlay stays visible (criterion 8).
  useBlockBrowserPanel();
  useBlockDshPanel();

  const onDrop = (e: React.DragEvent, zone: Zone) => {
    e.preventDefault();
    e.stopPropagation();
    setActive(null);
    onDropComplete?.();
    const dragged = draggedPage(e);
    if (!dragged) return;
    if (dragged.sourcePaneId) {
      if (zone === "center") swapPanes(dragged.sourcePaneId, paneId);
      else movePaneToEdge(dragged.sourcePaneId, paneId, zone);
      return;
    }
    if (zone === "center") {
      place(paneId, dragged.pageId);
    } else {
      // Edge split creates a 50/50 split with the new pane hosting the page.
      split(paneId, zone, dragged.pageId);
    }
  };

  // Only show edge affordances over an occupied pane; an empty pane only needs
  // the center fill.
  const edges: Zone[] = hasContent ? ["left", "right", "top", "bottom"] : [];

  return (
    <div className="absolute inset-0 z-20 pointer-events-auto">
      {/* Center fill/swap zone — always present. */}
      <div
        onDragOver={(e) => {
          if (draggedPage(e)) { e.preventDefault(); setActive("center"); }
        }}
        onDragLeave={() => setActive((a) => (a === "center" ? null : a))}
        onDrop={(e) => onDrop(e, "center")}
        className={`absolute inset-3 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
          active === "center"
            ? "bg-primary/20 text-primary ring-2 ring-primary/50"
            : "bg-background/40 text-muted-foreground ring-1 ring-[hsl(var(--sidebar-border))]/40"
        }`}
      >
        {hasContent ? "Replace" : "Drop here"}
      </div>
      {edges.map((zone) => (
        <div
          key={zone}
          onDragOver={(e) => {
            if (draggedPage(e)) { e.preventDefault(); setActive(zone); }
          }}
          onDragLeave={() => setActive((a) => (a === zone ? null : a))}
          onDrop={(e) => onDrop(e, zone)}
          className={zoneClass(zone as Exclude<Zone, "center">, active === zone)}
        />
      ))}
    </div>
  );
}

function zoneClass(zone: Exclude<Zone, "center">, hot: boolean): string {
  const base = "absolute transition-colors";
  const hotCls = hot ? "bg-primary/30 ring-2 ring-primary/60" : "bg-primary/10 ring-1 ring-primary/30";
  switch (zone) {
    case "left":
      return `${base} ${hotCls} left-0 top-0 bottom-0 w-1/4 rounded-l-lg`;
    case "right":
      return `${base} ${hotCls} right-0 top-0 bottom-0 w-1/4 rounded-r-lg`;
    case "top":
      return `${base} ${hotCls} left-0 right-0 top-0 h-1/4 rounded-t-lg`;
    case "bottom":
      return `${base} ${hotCls} left-0 right-0 bottom-0 h-1/4 rounded-b-lg`;
  }
}

/** Wrap a draggable page source (a sidebar nav item). Sets the drag image and
 *  the page-id payload. */
export function usePageDragSource(pageId: NavPage | null, sourcePaneId?: string) {
  return {
    draggable: !!pageId,
    onDragStart: (e: React.DragEvent) => {
      if (!pageId) return;
      e.dataTransfer.setData(PAGE_DRAG_MIME, pageId);
      if (sourcePaneId) e.dataTransfer.setData(PANE_DRAG_MIME, sourcePaneId);
      e.dataTransfer.effectAllowed = sourcePaneId ? "move" : "copy";
    },
  };
}
