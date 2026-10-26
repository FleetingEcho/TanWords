/** Shared atoms for the Words/Sentences two-tier filter bars: chip geometry,
 *  count suffixes, and the tier-2 removable token. Centralised here so both
 *  bars keep the same touch targets and the same "counts respect every other
 *  filter" affordance language without either owning the other. */

import React from "react";
import { useT } from "@/hooks/useT";
import { X } from "lucide-react";
import { compactCount } from "./wordFilterDefs";

/** Tier-1 chip geometry: a real 32px tap target on touch layouts, the old
 *  compact pill on desktop (the whole bar must stay one row at w-80). */
export function chipClass(active: boolean, tone: "primary" | "yellow" = "primary") {
  return `h-8 lg:h-7 px-2.5 rounded-full text-xs lg:text-[11px] font-semibold border transition-colors inline-flex items-center gap-1 ${
    active
      ? tone === "yellow"
        ? "bg-yellow-400/15 text-yellow-600 dark:text-yellow-400 border-yellow-400/60 hover:bg-yellow-400/25"
        : "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
      : "border-border text-muted-foreground hover:border-primary/40 hover:bg-transparent"
  }`;
}

/** Muted count suffix inside a tier-1 chip. `null` = the core predates
 *  facets (stale binary) — render nothing rather than a lying zero. */
export function ChipCount({ n, active }: { n: number | null; active: boolean }) {
  if (n === null) return null;
  return (
    <span className={`text-[9px] font-medium tabular-nums ${active ? "opacity-75" : "text-muted-foreground/60"}`}>
      {compactCount(n)}
    </span>
  );
}

/** One active-filter token in the readout row: the dimension's label, an ×
 *  that drops just this constraint. */
export function FilterToken({ label, icon, onRemove }: { label: string; icon?: React.ReactNode; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 pl-2 pr-1 text-[10px] font-semibold text-primary max-w-48">
      {icon}
      <span className="truncate">{label}</span>
      <button
        onClick={onRemove}
        title={t("vocab.filterBar.removeFilter")}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

/** Section label inside a More-control popover. */
export const FILTER_SECTION_LABEL = "shrink-0 text-[10px] font-medium text-muted-foreground/70 select-none";

/** Slim SelectTrigger styling shared by the bars' selects. */
export const FILTER_SELECT_TRIGGER =
  "h-8 lg:h-7 w-auto rounded-full border-border/60 bg-background px-2.5 text-xs lg:text-[11px] font-semibold text-muted-foreground hover:border-primary/40";
