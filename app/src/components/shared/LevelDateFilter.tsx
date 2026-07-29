import React from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Filter, Star } from "lucide-react";

export type LevelValue = "C2" | "C1" | "B2" | "B1-";
export type LevelFilter = "all" | LevelValue;

const LEVELS: LevelValue[] = ["C2", "C1", "B2", "B1-"];

/** True when a word/sentence level matches one of the selected level chips. */
export function matchesLevels(level: string | null | undefined, selected: LevelValue[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((lv) =>
    lv === "B1-" ? ["B1", "A2", "A1"].includes(level ?? "") : level === lv
  );
}

interface Props {
  /** Single-select mode (Sentences / Patterns) */
  levelFilter?: LevelFilter;
  onLevelFilterChange?: (v: LevelFilter) => void;
  /** Multi-select mode (Vocabulary) — empty array means "all levels" */
  levels?: LevelValue[];
  onLevelsChange?: (v: LevelValue[]) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  /** Starred-only chip — shown when the change handler is provided */
  starredOnly?: boolean;
  onStarredOnlyChange?: (v: boolean) => void;
}

/** Level + date-range filter, shared by the Vocabulary and Sentences list panels
 *  so both filter the same two dimensions the same way. */
export function LevelDateFilter({
  levelFilter, onLevelFilterChange, levels, onLevelsChange,
  dateFrom, dateTo, onDateFromChange, onDateToChange,
  starredOnly = false, onStarredOnlyChange,
}: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const multi = !!onLevelsChange;
  const selected = levels ?? [];
  const levelCount = multi ? selected.length : levelFilter !== "all" ? 1 : 0;
  const activeCount = levelCount + (dateFrom || dateTo ? 1 : 0) + (starredOnly ? 1 : 0);

  const chipActive = (lv: LevelFilter) => {
    if (multi) return lv === "all" ? selected.length === 0 : selected.includes(lv as LevelValue);
    return levelFilter === lv;
  };

  const onChipClick = (lv: LevelFilter) => {
    if (!multi) return onLevelFilterChange?.(lv);
    if (lv === "all") return onLevelsChange!([]);
    const v = lv as LevelValue;
    onLevelsChange!(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

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
        <div className="space-y-2.5 pt-2.5">
          <div className="flex gap-1 flex-wrap">
            {(["all", ...LEVELS] as LevelFilter[]).map((lv) => (
              <Button
                key={lv}
                variant="ghost"
                onClick={() => onChipClick(lv)}
                className={`h-auto px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  chipActive(lv)
                    ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:bg-transparent"
                }`}
              >
                {lv === "all" ? t("vocab.levelAll") : lv === "B1-" ? t("vocab.levelB1minus") : lv}
              </Button>
            ))}
            {onStarredOnlyChange && (
              <Button
                variant="ghost"
                onClick={() => onStarredOnlyChange(!starredOnly)}
                className={`h-auto px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors flex items-center gap-1 ${
                  starredOnly
                    ? "bg-yellow-400/15 text-yellow-600 dark:text-yellow-400 border-yellow-400/60 hover:bg-yellow-400/25"
                    : "border-border text-muted-foreground hover:border-yellow-400/40 hover:bg-transparent"
                }`}
              >
                <Star className={`w-2.5 h-2.5 ${starredOnly ? "fill-yellow-400 text-yellow-400" : ""}`} />
                {t("vocab.filterStarred")}
              </Button>
            )}
          </div>

          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(from, to) => { onDateFromChange(from); onDateToChange(to); }}
            placeholder={t("vocab.dateRangePlaceholder")}
          />
        </div>
      )}
    </div>
  );
}
