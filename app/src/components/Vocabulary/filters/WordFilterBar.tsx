/** The Words list's two-tier filter bar — replacement for the old collapsed
 *  "Filters ▾" panel (everything hidden one click deep, no readout of the
 *  active query) and the separate status cycle chip (a second UI editing the
 *  same `statuses` state, with a confusing dead "custom" mode).
 *
 *  Tier 1 is always visible: the three high-frequency dimensions — status,
 *  level, starred — plus the sort (previously buried in the panel even
 *  though it's the most-touched control) and a "More" popover holding the
 *  low-frequency dimensions (analysis state, due, source, categories,
 *  updated-range). Every active tier-2 filter renders as a removable token
 *  chip underneath, so the current query is readable at a glance and any
 *  single dimension is one click from being dropped.
 *
 *  Chip counts come from the page query's facets (db_get_words_page) — each
 *  axis's count skips its own constraint, so toggling a chip never zeroes
 *  its own number and the piles you're NOT looking at stay visible.
 *
 *  Everything here is controlled from useVocabWordList; this component holds
 *  no filter state of its own (only popover open flags and the tag search
 *  query). */

import React from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EnrichFilter, WordFilterFacets, WordSortBy, WordStatus, WordTagCount } from "@/hooks/useDB";
import type { LevelValue } from "@/components/shared/LevelDateFilter";
import { WORD_LEVEL_VALUES, WORD_SOURCE_VALUES, WORD_STATUS_VALUES } from "./wordFilterDefs";
import { chipClass, ChipCount, FilterToken, FILTER_SECTION_LABEL } from "./filterBarShared";
import {
  ArrowDownAZ, ArrowUpAZ, CalendarClock, CheckCheck, ChevronDown,
  Circle, CircleDot, SlidersHorizontal, Sparkles, Star, Tag,
} from "lucide-react";

interface Props {
  levels: LevelValue[];
  onLevelsChange: (v: LevelValue[]) => void;
  statuses: WordStatus[];
  onStatusesChange: (v: WordStatus[]) => void;
  starredOnly: boolean;
  onStarredOnlyChange: (v: boolean) => void;
  enrichFilter: EnrichFilter;
  onEnrichFilterChange: (v: EnrichFilter) => void;
  dueOnly: boolean;
  onDueOnlyChange: (v: boolean) => void;
  source: string;
  onSourceChange: (v: string) => void;
  tagOptions: WordTagCount[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  sortBy: WordSortBy;
  onSortChange: (v: WordSortBy) => void;
  sortDesc: boolean;
  onSortDescToggle: () => void;
  onClearAll: () => void;
  /** Live pile sizes from the page query — see the file header. `null` when
   *  the running core binary predates facets: in that mixed state the bar
   *  HIDES all counts instead of displaying misleading zeros. */
  facets: WordFilterFacets | null;
}

/** Status as ONE control (a popover of checkbox rows with live counts) —
 *  absorbs both the old panel's status chips and the cycle-on-click quick
 *  filter. Empty selection = all statuses; the trigger says so instead of
 *  the old cycle chip's "custom" dead state. */
function StatusControl({ statuses, onChange, facets }: {
  statuses: WordStatus[];
  onChange: (v: WordStatus[]) => void;
  facets: WordFilterFacets | null;
}) {
  const t = useT();
  const label =
    statuses.length === 0 ? t("vocab.statusTitle")
    : statuses.length === 1 ? t(`vocab.status.${statuses[0]}`)
    : t("vocab.filterBar.statusSome", { n: statuses.length });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={chipClass(statuses.length > 0)}>
          <CircleDot className="w-3 h-3 shrink-0" />
          {label}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1.5" align="start">
        {WORD_STATUS_VALUES.map((st) => {
          const active = statuses.includes(st);
          return (
            <button
              key={st}
              onClick={() => onChange(active ? statuses.filter((x) => x !== st) : [...statuses, st])}
              className={`w-full flex items-center gap-2 rounded-md px-2 py-2 lg:py-1.5 text-xs text-left transition-colors ${
                active ? "bg-primary/15 text-primary font-semibold" : "hover:bg-muted"
              }`}
            >
              {st === "learning"
                ? <Circle className="w-3 h-3 shrink-0" />
                : st === "familiar"
                  ? <CircleDot className="w-3 h-3 shrink-0" />
                  : <CheckCheck className="w-3 h-3 shrink-0" />}
              <span className="truncate">{t(`vocab.status.${st}`)}</span>
              {facets && (
                <span className={`ml-auto shrink-0 text-[10px] tabular-nums ${active ? "text-primary" : "text-muted-foreground/70"}`}>
                  {facets[st].toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
        <p className="px-2 pt-1.5 pb-0.5 text-[10px] leading-snug text-muted-foreground/70">
          {t("vocab.filterBar.statusHint")}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** The low-frequency dimensions behind one popover, so tier 1 stays a single
 *  scannable row at panel width. The trigger carries the active count (tier-2
 *  filters are the invisible ones otherwise). */
function MoreControl(props: Props & { activeCount: number }) {
  const t = useT();
  const {
    enrichFilter, onEnrichFilterChange,
    source, onSourceChange, tagOptions, selectedTags, onTagToggle,
    dateFrom, dateTo, onDateFromChange, onDateToChange, activeCount,
  } = props;
  const [tagQuery, setTagQuery] = React.useState("");
  const visibleTags = React.useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    return q ? tagOptions.filter((o) => o.tag.toLowerCase().includes(q)) : tagOptions;
  }, [tagOptions, tagQuery]);

  const section = FILTER_SECTION_LABEL;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={chipClass(activeCount > 0)}>
          <SlidersHorizontal className="w-3 h-3 shrink-0" />
          {t("vocab.filterBar.more")}
          {activeCount > 0 && (
            <span className="rounded-full bg-primary-foreground/20 px-1 text-[9px] font-bold tabular-nums">{activeCount}</span>
          )}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2.5 space-y-2.5" align="start">
        {/* Analysis state — a single-choice segment, not two independent
            chips like the old panel (they couldn't both be on anyway). */}
        <div className="space-y-1">
          <span className={section}>{t("vocab.filterBar.analysisLabel")}</span>
          <div className="flex flex-wrap gap-1">
            {(["all", "enriched", "raw"] as EnrichFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => onEnrichFilterChange(v)}
                className={chipClass(enrichFilter === v)}
              >
                {v === "enriched" && <Sparkles className="w-3 h-3" />}
                {v === "all" ? t("vocab.filterBar.allOption")
                  : v === "enriched" ? t("vocab.filterEnriched")
                  : t("vocab.filterNotEnriched")}
              </button>
            ))}
          </div>
        </div>

        {/* (The due-for-review filter used to live here; user feedback
            2026-10-24 removed it along with the rest of the Review feature.
            If a persisted dueOnly survives from before, the active-filter
            token row below still surfaces and clears it.) */}

        {/* Source */}
        <div className="space-y-1">
          <span className={section}>{t("vocab.filterBar.sourceLabel")}</span>
          <div>
            <Select value={source} onValueChange={onSourceChange}>
              <SelectTrigger
                className="h-8 lg:h-7 w-auto min-w-28 rounded-full border-border/60 bg-background px-2.5 text-xs lg:text-[11px] font-semibold text-muted-foreground hover:border-primary/40"
                aria-label={t("vocab.filterBar.sourceLabel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("vocab.source.all")}</SelectItem>
                {WORD_SOURCE_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>{t(`vocab.source.${s}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Category tags — searchable list with counts (same pattern the old
            panel used inside its own popover, just one level shallower). */}
        {tagOptions.length > 0 && (
          <div className="space-y-1">
            <span className={section}>{t("vocab.sort.category")}</span>
            <input
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder={t("vocab.tagSearchPlaceholder")}
              className="w-full h-8 lg:h-7 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {visibleTags.length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">{t("vocab.tagNoMatches")}</p>
              )}
              {visibleTags.map(({ tag, count }) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => onTagToggle(tag)}
                    className={`w-full flex items-center justify-between gap-2 rounded-md px-2 py-2 lg:py-1.5 text-xs text-left transition-colors ${
                      active ? "bg-primary/15 text-primary font-semibold" : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{tag}</span>
                    <span className={`shrink-0 text-[10px] tabular-nums ${active ? "text-primary" : "text-muted-foreground/70"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Updated-range */}
        <div className="space-y-1">
          <span className={section}>{t("vocab.dateLabel")}</span>
          <div>
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(from, to) => { onDateFromChange(from); onDateToChange(to); }}
              placeholder={t("vocab.dateRangePlaceholder")}
              className="h-8 lg:h-7 flex-none w-auto"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function WordFilterBar(props: Props) {
  const t = useT();
  const {
    levels, onLevelsChange, statuses, onStatusesChange,
    starredOnly, onStarredOnlyChange,
    enrichFilter, onEnrichFilterChange, dueOnly, onDueOnlyChange,
    source, onSourceChange, selectedTags, onTagToggle,
    dateFrom, dateTo, onDateFromChange, onDateToChange,
    sortBy, onSortChange, sortDesc, onSortDescToggle,
    onClearAll, facets,
  } = props;

  // Tier-2 = everything a token must surface (those dimensions are invisible
  // in the bar itself). Tier-1 activity stays visible as lit chips, so it
  // needs no tokens — only the Reset affordance cares about it.
  const tier2Count =
    (enrichFilter !== "all" ? 1 : 0) +
    (dueOnly ? 1 : 0) +
    (source !== "all" ? 1 : 0) +
    selectedTags.length +
    (dateFrom || dateTo ? 1 : 0);
  const anyActive = tier2Count > 0 || levels.length > 0 || statuses.length > 0 || starredOnly;

  const levelFacet: Record<LevelValue, number | null> = facets
    ? { C2: facets.levelC2, C1: facets.levelC1, B2: facets.levelB2, "B1-": facets.levelB1Below }
    : { C2: null, C1: null, B2: null, "B1-": null };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusControl statuses={statuses} onChange={onStatusesChange} facets={facets} />

        {/* Levels are short labels — four inline chips beat a dropdown. */}
        {WORD_LEVEL_VALUES.map((lv) => (
          <button
            key={lv}
            onClick={() => onLevelsChange(levels.includes(lv) ? levels.filter((x) => x !== lv) : [...levels, lv])}
            className={chipClass(levels.includes(lv))}
          >
            {lv === "B1-" ? t("vocab.levelB1minus") : lv}
            <ChipCount n={levelFacet[lv]} active={levels.includes(lv)} />
          </button>
        ))}

        <button
          onClick={() => onStarredOnlyChange(!starredOnly)}
          title={t("vocab.filterStarred")}
          className={chipClass(starredOnly, "yellow")}
        >
          <Star className={`w-3 h-3 ${starredOnly ? "fill-yellow-400 text-yellow-400" : ""}`} />
          <ChipCount n={facets ? facets.starred : null} active={starredOnly} />
        </button>

        <MoreControl {...props} activeCount={tier2Count} />

        {/* Sort rides the same row — promoted out of the old panel, with its
            direction toggle glued to the select. */}
        {/* sm-up: pinned to the row's right edge. Phone widths (`flex-wrap`
          * already wraps the chips onto a second line): keep it in the wrap
          * flow, left-aligned with the chips — a lone right-pinned line
          * under the wrapped chips reads as misalignment bug, not layout. */}
        <div className="flex items-center gap-1 sm:ml-auto">
          <Select value={sortBy} onValueChange={(v) => onSortChange(v as WordSortBy)}>
            <SelectTrigger
              className="h-8 lg:h-7 w-auto min-w-24 rounded-full border-border/60 bg-background px-2.5 text-xs lg:text-[11px] font-semibold text-muted-foreground hover:border-primary/40"
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
          <Button
            variant="ghost"
            onClick={onSortDescToggle}
            title={sortDesc ? t("vocab.sort.desc") : t("vocab.sort.asc")}
            className="h-8 w-8 lg:h-7 lg:w-7 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            {sortDesc ? <ArrowDownAZ className="w-3.5 h-3.5" /> : <ArrowUpAZ className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* Active-query readout: every hidden (tier-2) constraint as a token,
          plus the escape hatch. Renders only when something is active so a
          default bar costs zero vertical space. */}
      {anyActive && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {enrichFilter !== "all" && (
            <FilterToken
              icon={<Sparkles className="w-2.5 h-2.5 shrink-0" />}
              label={enrichFilter === "enriched" ? t("vocab.filterEnriched") : t("vocab.filterNotEnriched")}
              onRemove={() => onEnrichFilterChange("all")}
            />
          )}
          {dueOnly && (
            <FilterToken
              icon={<CalendarClock className="w-2.5 h-2.5 shrink-0" />}
              label={t("vocab.filterDue")}
              onRemove={() => onDueOnlyChange(false)}
            />
          )}
          {source !== "all" && (
            <FilterToken label={t(`vocab.source.${source}`)} onRemove={() => onSourceChange("all")} />
          )}
          {selectedTags.map((tag) => (
            <FilterToken
              key={tag}
              icon={<Tag className="w-2.5 h-2.5 shrink-0" />}
              label={tag}
              onRemove={() => onTagToggle(tag)}
            />
          ))}
          {(dateFrom || dateTo) && (
            <FilterToken
              label={`${dateFrom || "…"} → ${dateTo || "…"}`}
              onRemove={() => { onDateFromChange(""); onDateToChange(""); }}
            />
          )}
          <button
            onClick={onClearAll}
            className="h-6 px-2 rounded-full text-[10px] font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            {t("vocab.clearAllFilters")}
          </button>
        </div>
      )}
    </div>
  );
}
