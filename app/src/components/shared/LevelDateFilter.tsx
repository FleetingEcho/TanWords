import React from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Filter, Star } from "lucide-react";

export type LevelValue = "C2" | "C1" | "B2" | "B1-";
export type LevelFilter = "all" | LevelValue;

const LEVELS: LevelValue[] = ["C2", "C1", "B2", "B1-"];

interface Props {
  /** Single level select (empty/"all" = no level constraint). */
  levelFilter: LevelFilter;
  onLevelFilterChange: (v: LevelFilter) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  /** Starred-only chip — shown when the change handler is provided */
  starredOnly?: boolean;
  onStarredOnlyChange?: (v: boolean) => void;
}

/** One labelled row of the filter panel: a muted caption on the left, the
 *  controls on the right. Keeps the collapsed panel scannable — without the
 *  captions the chip soup reads as one undifferentiated pile. */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 pt-1 w-8 text-[10px] font-medium text-muted-foreground/70 select-none">{label}</span>
      <div className="flex flex-wrap gap-1 min-w-0">{children}</div>
    </div>
  );
}

/** Compact level/starred/date filter for the Sentences list panel. The Words
 *  tab used to share this component (multi-select levels plus half a dozen
 *  extra dimensions); that burden moved to the dedicated two-tier
 *  Vocabulary/filters/WordFilterBar, which is why this is deliberately
 *  single-select and vocabulary-free again. */
export function LevelDateFilter({
  levelFilter, onLevelFilterChange,
  dateFrom, dateTo, onDateFromChange, onDateToChange,
  starredOnly = false, onStarredOnlyChange,
}: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const activeCount = (levelFilter !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) + (starredOnly ? 1 : 0);

  const chipClass = (active: boolean, tone: "primary" | "yellow" = "primary") =>
    `h-auto px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors flex items-center gap-1 ${
      active
        ? tone === "yellow"
          ? "bg-yellow-400/15 text-yellow-600 dark:text-yellow-400 border-yellow-400/60 hover:bg-yellow-400/25"
          : "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
        : "border-border text-muted-foreground hover:border-primary/40 hover:bg-transparent"
    }`;

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Filter className="w-3 h-3" />
        {t("vocab.filters")}
        {activeCount > 0 && <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-bold text-primary">{activeCount}</span>}
        <svg viewBox="0 0 12 12" className={`w-2.5 h-2.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-border/70 bg-muted/30 p-2.5 space-y-2">
          {/* level + starred */}
          <FilterRow label={t("vocab.levelAll")}>
            {(["all", ...LEVELS] as LevelFilter[]).map((lv) => (
              <Button
                key={lv}
                variant="ghost"
                onClick={() => onLevelFilterChange(lv)}
                className={chipClass(levelFilter === lv)}
              >
                {lv === "all" ? t("vocab.levelAll") : lv === "B1-" ? t("vocab.levelB1minus") : lv}
              </Button>
            ))}
            {onStarredOnlyChange && (
              <Button
                variant="ghost"
                onClick={() => onStarredOnlyChange(!starredOnly)}
                className={chipClass(starredOnly, "yellow")}
              >
                <Star className={`w-2.5 h-2.5 ${starredOnly ? "fill-yellow-400 text-yellow-400" : ""}`} />
                {t("vocab.filterStarred")}
              </Button>
            )}
          </FilterRow>

          {/* date range */}
          <FilterRow label={t("vocab.dateLabel")}>
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(from, to) => { onDateFromChange(from); onDateToChange(to); }}
              placeholder={t("vocab.dateRangePlaceholder")}
              className="h-6 flex-none w-auto"
            />
          </FilterRow>
        </div>
      )}
    </div>
  );
}
