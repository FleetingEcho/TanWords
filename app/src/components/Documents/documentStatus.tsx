import type React from "react";
import { Check, Pause, Play, X } from "lucide-react";
import type { DocStatus } from "@/hooks/useDB";

/** The closed set of lifecycle statuses, in display order. Mirrors
 *  `STATUS_VALUES` in core/src/db/documents/crud.rs — "" is "None" and is
 *  deliberately not a selectable entry (the dropdown has an explicit
 *  "No status" choice that maps back to ""). */
export const STATUS_LIST: DocStatus[] = ["active", "onhold", "completed", "dropped"];

/** i18n key for a status's label. "" (none) uses `doc.noStatus`. */
export function statusLabelKey(status: DocStatus): string {
  switch (status) {
    case "active": return "doc.statusActive";
    case "onhold": return "doc.statusOnHold";
    case "completed": return "doc.statusCompleted";
    case "dropped": return "doc.statusDropped";
    default: return "doc.noStatus";
  }
}

/** The glyph that stands for a status — a row marker before the title, and
 *  the menu item icon in the editor strip. Kept small and shape-distinct so
 *  it is scannable at 3x3 without leaning on colour (which would fight the
 *  active/selected tints anyway). Colour, when any, is supplied by the
 *  caller with a semantic token; the glyph itself is neutral. */
export function StatusIcon({ status, className = "h-3 w-3" }: { status: DocStatus; className?: string }) {
  switch (status) {
    case "active": return <Play className={className} strokeWidth={2.2} />;
    case "onhold": return <Pause className={className} strokeWidth={2.2} />;
    case "completed": return <Check className={className} strokeWidth={2.4} />;
    case "dropped": return <X className={className} strokeWidth={2.4} />;
    default: return null;
  }
}