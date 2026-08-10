import type React from "react";
import { Check, Circle, Pause, Play, X } from "lucide-react";
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

/** Hue per status, on the same wheel the tag chips use. Four statuses read
 *  as four things far faster in colour than in shape alone, and shape-only
 *  glyphs at 3x3 (▶ ▮▮ ✓ ✕) were too alike to tell apart at a glance. */
function statusHue(status: DocStatus): number | null {
  switch (status) {
    case "active": return 210;
    case "onhold": return 38;
    case "completed": return 150;
    case "dropped": return 0;
    default: return null;
  }
}

/** A status's colour, or undefined for "none" (which stays inherited-neutral,
 *  since the absence of a status shouldn't shout).
 *
 *  Built with `tagColor.ts`'s formula rather than a Tailwind palette step: the
 *  same hue at `--tag-chip-l` stays legible in light and dark without a
 *  per-theme copy, and §UI.4 bans raw hex/palette colours in this UI. */
export function statusColor(status: DocStatus): string | undefined {
  const hue = statusHue(status);
  return hue === null ? undefined : `hsl(${hue} 55% var(--tag-chip-l, 38%))`;
}

/** The glyph that stands for a status — a row marker before the title, and
 *  the menu item icon in the editor strip. Shape *and* colour: the shapes
 *  alone are the fallback for anyone who can't separate the hues. Pass
 *  `muted` where the surrounding text already carries the colour. */
export function StatusIcon({ status, className = "h-3 w-3", muted = false }: {
  status: DocStatus;
  className?: string;
  muted?: boolean;
}) {
  const style = muted ? undefined : { color: statusColor(status) };
  switch (status) {
    case "active": return <Play className={className} style={style} strokeWidth={2.2} />;
    case "onhold": return <Pause className={className} style={style} strokeWidth={2.2} />;
    case "completed": return <Check className={className} style={style} strokeWidth={2.2} />;
    case "dropped": return <X className={className} style={style} strokeWidth={2.2} />;
    default: return <Circle className={className} strokeWidth={2.2} />;
  }
}
