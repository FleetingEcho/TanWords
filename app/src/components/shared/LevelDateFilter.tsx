import React from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WordSortBy, EnrichFilter, WordStatus } from "@/hooks/useDB";
import { Filter, Star, CheckCheck, Circle, CircleDot, Sparkles, CalendarClock, ArrowDownAZ, ArrowUpAZ, Tag, X, ChevronDown } from "lucide-react";

export type LevelValue = "C2" | "C1" | "B2" | "B1-";
export type LevelFilter = "all" | LevelValue;

const LEVELS: LevelValue[] = ["C2", "C1", "B2", "B1-"];

/** Statuses offered as filter chips — all three learning states. */
const STATUS_VALUES: WordStatus[] = ["learning", "familiar", "mastered"];
/** Known words.source values — labels already exist as vocab.source.* i18n. */
const SOURCE_VALUES = ["manual", "ai", "chat", "batch", "discover", "seed", "knowledge-map", "scene-lab"] as const;

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
  /** ── Vocabulary-only extras ── each section renders only when its handler
   *  is provided, so the shared Sentences panel keeps its compact shape. */
  statuses?: WordStatus[];
  onStatusesChange?: (v: WordStatus[]) => void;
  enrichFilter?: EnrichFilter;
  onEnrichFilterChange?: (v: EnrichFilter) => void;
  dueOnly?: boolean;
  onDueOnlyChange?: (v: boolean) => void;
  source?: string;
  onSourceChange?: (v: string) => void;
  /** Category tag chips — shown when options are provided (Vocabulary). */
  tagOptions?: { tag: string; count: number }[];
  selectedTags?: string[];
  onTagToggle?: (tag: string) => void;
  sortBy?: WordSortBy;
  onSortChange?: (v: WordSortBy) => void;
  /** Ascending/descending toggle for the sorts that support both. */
  sortDesc?: boolean;
  onSortDescToggle?: () => void;
  /** Clears every filter at once — shown (replacing the toggle label) while
   *  anything is active. Wires to clearAllFilters in the list hook. */
  onClearAll?: () => void;
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

/** Filter + sort panel shared by the Vocabulary and Sentences list panels so
 *  both filter the same dimensions the same way. The word-only sections
 *  (status / enrichment / due / source / sort) appear only for panels that
 *  wire them up. */
export function LevelDateFilter({
  levelFilter, onLevelFilterChange, levels, onLevelsChange,
  dateFrom, dateTo, onDateFromChange, onDateToChange,
  starredOnly = false, onStarredOnlyChange,
  statuses, onStatusesChange,
  enrichFilter, onEnrichFilterChange,
  dueOnly, onDueOnlyChange,
  source, onSourceChange,
  tagOptions, selectedTags, onTagToggle,
  sortBy, onSortChange, sortDesc, onSortDescToggle,
  onClearAll,
}: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [tagQuery, setTagQuery] = React.useState("");
  const multi = !!onLevelsChange;
  const selected = levels ?? [];
  const statusSelected = statuses ?? [];
  const tagSelected = selectedTags ?? [];
  const levelCount = multi ? selected.length : levelFilter !== "all" ? 1 : 0;
  const activeCount = levelCount + (dateFrom || dateTo ? 1 : 0) + (starredOnly ? 1 : 0)
    + statusSelected.length + (enrichFilter && enrichFilter !== "all" ? 1 : 0)
    + (dueOnly ? 1 : 0) + (source && source !== "all" ? 1 : 0) + tagSelected.length;

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

  const chipClass = (active: boolean, tone: "primary" | "yellow" = "primary") =>
    `h-auto px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors flex items-center gap-1 ${
      active
        ? tone === "yellow"
          ? "bg-yellow-400/15 text-yellow-600 dark:text-yellow-400 border-yellow-400/60 hover:bg-yellow-400/25"
          : "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
        : "border-border text-muted-foreground hover:border-primary/40 hover:bg-transparent"
    }`;

  const visibleTags = React.useMemo(() => {
    if (!tagOptions) return [];
    const q = tagQuery.trim().toLowerCase();
    return q ? tagOptions.filter((o) => o.tag.toLowerCase().includes(q)) : tagOptions;
  }, [tagOptions, tagQuery]);

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
          {/* sort row first — it's what users touch most often, and it reads
              as a toolbar rather than a filter dimension */}
          {(onSortChange || onSourceChange) && (
            <div className="flex gap-1.5 flex-wrap items-center">
              {onSortChange && (
                <Select value={sortBy ?? "recent"} onValueChange={(v) => onSortChange(v as WordSortBy)}>
                  <SelectTrigger
                    className="h-6 w-auto min-w-24 rounded-full border-border/60 bg-background px-2 text-[10px] font-semibold text-muted-foreground hover:border-primary/40"
                    aria-label={t("vocab.sortLabel")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">{t("vocab.sort.recent")}</SelectItem>
                    <SelectItem value="alpha">{t("vocab.sort.alpha")}</SelectItem>
                    <SelectItem value="freq">{t("vocab.sort.freq")}</SelectItem>
                    <SelectItem value="due">{t("vocab.sort.due")}</SelectItem>
                    <SelectItem value="difficulty">{t("vocab.sort.difficulty")}</SelectItem>
                    <SelectItem value="category">{t("vocab.sort.category")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {onSortChange && onSortDescToggle && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSortDescToggle}
                  className={chipClass(!!sortDesc)}
                  title={sortDesc ? t("vocab.sort.desc") : t("vocab.sort.asc")}
                >
                  {sortDesc ? <ArrowDownAZ className="w-2.5 h-2.5" /> : <ArrowUpAZ className="w-2.5 h-2.5" />}
                </Button>
              )}
              {onSourceChange && (
                <Select value={source ?? "all"} onValueChange={onSourceChange}>
                  <SelectTrigger
                    className="h-6 w-auto min-w-24 rounded-full border-border/60 bg-background px-2 text-[10px] font-semibold text-muted-foreground hover:border-primary/40"
                    aria-label={t("vocab.source.all")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("vocab.source.all")}</SelectItem>
                    {SOURCE_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>{t(`vocab.source.${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* level + starred */}
          <FilterRow label={t("vocab.levelAll")}>
            {(["all", ...LEVELS] as LevelFilter[]).map((lv) => (
              <Button
                key={lv}
                variant="ghost"
                onClick={() => onChipClick(lv)}
                className={chipClass(chipActive(lv))}
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

          {/* learning status */}
          {onStatusesChange && (
            <FilterRow label={t("vocab.statusTitle")}>
              {STATUS_VALUES.map((st) => {
                const active = statusSelected.includes(st);
                return (
                  <Button
                    key={st}
                    variant="ghost"
                    onClick={() =>
                      onStatusesChange(
                        active ? statusSelected.filter((x) => x !== st) : [...statusSelected, st]
                      )
                    }
                    title={t(`vocab.status.${st}`)}
                    className={chipClass(active)}
                  >
                    {st === "learning"
                      ? <Circle className="w-2.5 h-2.5" />
                      : st === "familiar"
                        ? <CircleDot className="w-2.5 h-2.5" />
                        : <CheckCheck className="w-2.5 h-2.5" />}
                    {t(`vocab.status.${st}`)}
                  </Button>
                );
              })}
            </FilterRow>
          )}

          {/* analysis state + due */}
          {(onEnrichFilterChange || onDueOnlyChange) && (
            <FilterRow label={t("vocab.filterEnriched")}>
              {onEnrichFilterChange && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => onEnrichFilterChange(enrichFilter === "enriched" ? "all" : "enriched")}
                    className={chipClass(enrichFilter === "enriched")}
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    {t("vocab.filterEnriched")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => onEnrichFilterChange(enrichFilter === "raw" ? "all" : "raw")}
                    className={chipClass(enrichFilter === "raw")}
                  >
                    {t("vocab.filterNotEnriched")}
                  </Button>
                </>
              )}
              {onDueOnlyChange && (
                <Button
                  variant="ghost"
                  onClick={() => onDueOnlyChange(!dueOnly)}
                  className={chipClass(!!dueOnly)}
                >
                  <CalendarClock className="w-2.5 h-2.5" />
                  {t("vocab.filterDue")}
                </Button>
              )}
            </FilterRow>
          )}

          {/* category tags — capped to a summary chip that opens a popover
              with the full, searchable list. A flat 19-chip row (today's
              real count) is what made the panel feel noisy; the popover
              keeps every tag one click away without the visual flood. */}
          {onTagToggle && tagOptions && tagOptions.length > 0 && (
            <FilterRow label={t("vocab.sort.category")}>
              {tagSelected.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => tagSelected.forEach(onTagToggle)}
                  className="h-auto px-2 py-0.5 rounded-full text-[10px] font-semibold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1"
                  title={t("vocab.clearTags")}
                >
                  <X className="w-2.5 h-2.5" />
                  {t("vocab.clearTags")}
                </Button>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className={`h-auto px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors flex items-center gap-1 ${
                      tagSelected.length > 0
                        ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:bg-transparent"
                    }`}
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {tagSelected.length > 0
                      ? t("vocab.tagsSelected", { n: tagSelected.length })
                      : t("vocab.tagsAll")}
                    <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-60 p-2" align="start">
                  <input
                    value={tagQuery}
                    onChange={(e) => setTagQuery(e.target.value)}
                    placeholder={t("vocab.tagSearchPlaceholder")}
                    className="mb-2 w-full h-7 rounded-md border border-input bg-background px-2 text-[11px] placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="max-h-56 overflow-y-auto space-y-0.5">
                    {visibleTags.length === 0 && (
                      <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">{t("vocab.tagNoMatches")}</p>
                    )}
                    {visibleTags.map(({ tag, count }) => {
                      const active = tagSelected.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => onTagToggle(tag)}
                          className={`w-full flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] text-left transition-colors ${
                            active ? "bg-primary/15 text-primary font-semibold" : "hover:bg-muted"
                          }`}
                        >
                          <span className="truncate">{tag}</span>
                          <span className={`shrink-0 text-[10px] ${active ? "text-primary" : "text-muted-foreground/70"}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </FilterRow>
          )}

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

          {/* clear-all footer — replaces hunting down every active chip */}
          {activeCount > 0 && onClearAll && (
            <div className="pt-1 border-t border-border/60 flex justify-end">
              <Button
                variant="ghost"
                onClick={onClearAll}
                className="h-6 px-2 rounded-full text-[10px] font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
                {t("vocab.clearAllFilters")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
