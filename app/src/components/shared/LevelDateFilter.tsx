import React from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Filter } from "lucide-react";

export type LevelFilter = "all" | "C2" | "C1" | "B2" | "B1-";
export type DateField = "created" | "updated";

const LEVEL_CHIPS: LevelFilter[] = ["all", "C2", "C1", "B2", "B1-"];

interface Props {
  levelFilter: LevelFilter;
  onLevelFilterChange: (v: LevelFilter) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  /** Only Vocabulary's list has both a created and an updated timestamp to filter on */
  dateField?: DateField;
  onDateFieldChange?: (v: DateField) => void;
}

/** Level + date-range filter, shared by the Vocabulary and Sentences list panels
 *  so both filter the same two dimensions the same way. */
export function LevelDateFilter({
  levelFilter, onLevelFilterChange, dateFrom, dateTo, onDateFromChange, onDateToChange,
  dateField, onDateFieldChange,
}: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const activeCount = (levelFilter !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);

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
            {LEVEL_CHIPS.map((lv) => (
              <Button
                key={lv}
                variant="ghost"
                onClick={() => onLevelFilterChange(lv)}
                className={`h-auto px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  levelFilter === lv
                    ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:bg-transparent"
                }`}
              >
                {lv === "all" ? t("vocab.levelAll") : lv === "B1-" ? t("vocab.levelB1minus") : lv}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {dateField && onDateFieldChange && (
              <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg shrink-0">
                {(["created", "updated"] as DateField[]).map((f) => (
                  <Button
                    key={f}
                    variant="ghost"
                    onClick={() => onDateFieldChange(f)}
                    className={`h-auto px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors hover:bg-transparent ${
                      dateField === f ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f === "created" ? t("vocab.dateAdded") : t("vocab.dateUpdated")}
                  </Button>
                ))}
              </div>
            )}
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(from, to) => { onDateFromChange(from); onDateToChange(to); }}
              placeholder={t("vocab.dateRangePlaceholder")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
