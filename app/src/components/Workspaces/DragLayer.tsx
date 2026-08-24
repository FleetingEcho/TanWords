import React from "react";
import { useDragState } from "./dragState";
import { getPageDefinition } from "@/pages/pageCatalog";
import { useT } from "@/hooks/useT";

/** A fixed-position preview that follows the pointer while a workspace page
 *  drag is active. Rendered once, at the app root, so it floats above every
 *  pane. Only visible when `useDragState.active` is true (the pointer moved
 *  past the activation threshold); before that, the source's pointerdown is
 *  indistinguishable from a click and no preview is shown.
 *
 *  This is the "drag layer" the plan calls for (§180): a custom overlay
 *  instead of the browser's default drag ghost, so the preview is consistent
 *  across mouse, touch, and pen, and so the drag is announced accessibly. */
export function DragLayer() {
  const active = useDragState((s) => s.active);
  const pageId = useDragState((s) => s.pageId);
  const x = useDragState((s) => s.x);
  const y = useDragState((s) => s.y);
  const t = useT();
  if (!active || !pageId) return null;
  const def = getPageDefinition(pageId);
  const Icon = def?.icon;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-lg border border-primary/40 bg-[hsl(var(--sidebar))] px-3 py-2 text-sm font-medium shadow-xl"
      style={{ left: x + 12, top: y + 12 }}
    >
      {Icon && <Icon className="h-4 w-4 text-primary" />}
      <span>{t(`nav.${pageId}`)}</span>
    </div>
  );
}
