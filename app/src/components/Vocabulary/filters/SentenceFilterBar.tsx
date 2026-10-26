/** The Sentences list's two-tier filter bar — same architecture as the Words
 *  bar (WordFilterBar/filterBarShared), trimmed to the sentence axes: level
 *  chips, starred, a More popover with the observed-source list and the date
 *  range, sort on the right, and a removable-token readout row. Counts ride
 *  the page query's facets (db_get_sentences_page), each axis self-excluded;
 *  `facets === null` (stale core binary) hides the counts instead of lying.
 *
 *  Controlled from SentenceLibrary; this component holds no filter state. */

import React from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SentenceFacets, SentenceSortBy } from "@/hooks/useDB.sentences";
import type { LevelValue } from "@/components/shared/LevelDateFilter";
import { SENTENCE_LEVEL_VALUES } from "./sentenceFilterDefs";
import { chipClass, ChipCount, FilterToken, FILTER_SECTION_LABEL, FILTER_SELECT_TRIGGER } from "./filterBarShared";
import { ArrowDownAZ, ArrowUpAZ, ChevronDown, Layers, SlidersHorizontal, Star } from "lucide-react";

interface Props {
  levels: LevelValue[];
  onLevelsChange: (v: LevelValue[]) => void;
  starredOnly: boolean;
  onStarredOnlyChange: (v: boolean) => void;
  source: string;
  onSourceChange: (v: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  sortBy: SentenceSortBy;
  onSortChange: (v: SentenceSortBy) => void;
  sortDesc: boolean;
  onSortDescToggle: () => void;
  onClearAll: () => void;
  /** Facets from the page query, or null when the core predates them. */
  facets: SentenceFacets | null;
}

/** Low-frequency axes behind one popover: the observed sources (dynamic —
 *  the column is free-form, so no enum to hard-code) and the updated range. */
function MoreControl({ source, onSourceChange, dateFrom, dateTo, onDateFromChange, onDateToChange, facets, activeCount }: {
  source: string;
  onSourceChange: (v: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  facets: SentenceFacets | null;
  activeCount: number;
}) {
  const t = useT();
  const sources = facets?.sources ?? [];
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
      <PopoverContent className="w-64 p-2.5 space-y-2.5" align="start">
        {/* Source — observed values with live counts; "manual" is the
            server-side fallback for empty/NULL sources. */}
        <div className="space-y-1">
          <span className={FILTER_SECTION_LABEL}>{t("vocab.filterBar.sourceLabel")}</span>
          <div className="space-y-0.5">
            <button
              onClick={() => onSourceChange("all")}
              className={`w-full flex items-center gap-2 rounded-md px-2 py-2 lg:py-1.5 text-xs text-left transition-colors ${
                source === "all" ? "bg-primary/15 text-primary font-semibold" : "hover:bg-muted"
              }`}
            >
              <span className="truncate">{t("vocab.source.all")}</span>
            </button>
            {sources.map(({ source: s, count }) => {
              const active = source === s;
              return (
                <button
                  key={s}
                  onClick={() => onSourceChange(active ? "all" : s)}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-2 lg:py-1.5 text-xs text-left transition-colors ${
                    active ? "bg-primary/15 text-primary font-semibold" : "hover:bg-muted"
                  }`}
                >
                  <span className="truncate">{s}</span>
                  <span className={`ml-auto shrink-0 text-[10px] tabular-nums ${active ? "text-primary" : "text-muted-foreground/70"}`}>
                    {count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Updated-range (never persisted — see sentenceFilterDefs) */}
        <div className="space-y-1">
          <span className={FILTER_SECTION_LABEL}>{t("vocab.dateLabel")}</span>
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

export function SentenceFilterBar(props: Props) {
  const t = useT();
  const {
    levels, onLevelsChange, starredOnly, onStarredOnlyChange,
    source, onSourceChange,
    dateFrom, dateTo, onDateFromChange, onDateToChange,
    sortBy, onSortChange, sortDesc, onSortDescToggle,
    onClearAll, facets,
  } = props;

  const tier2Count = (source !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);
  const anyActive = tier2Count > 0 || levels.length > 0 || starredOnly;

  const levelFacet: Record<LevelValue, number | null> = facets
    ? { C2: facets.levelC2, C1: facets.levelC1, B2: facets.levelB2, "B1-": facets.levelB1Below }
    : { C2: null, C1: null, B2: null, "B1-": null };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Levels are short labels — four inline chips beat a dropdown. */}
        {SENTENCE_LEVEL_VALUES.map((lv) => (
          <button
            key={lv}
            onClick={() => onLevelsChange(levels.includes(lv) ? levels.filter((x) => x !== lv) : [...levels, lv])}
            className={chipClass(levels.includes(lv))}
          >
            <Layers className="w-3 h-3 opacity-50" />
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

        <MoreControl
          source={source} onSourceChange={onSourceChange}
          dateFrom={dateFrom} dateTo={dateTo}
          onDateFromChange={onDateFromChange} onDateToChange={onDateToChange}
          facets={facets} activeCount={tier2Count}
        />

        {/* sm-up: pinned right; phone: flows in the wrap sequence (aligned
          * with the chips' left edge) — see WordFilterBar. */}
        <div className="flex items-center gap-1 sm:ml-auto">
          <Select value={sortBy} onValueChange={(v) => onSortChange(v as SentenceSortBy)}>
            <SelectTrigger className={`${FILTER_SELECT_TRIGGER} min-w-24`} aria-label={t("vocab.sortLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">{t("vocab.sort.recent")}</SelectItem>
              <SelectItem value="alpha">{t("vocab.sort.alpha")}</SelectItem>
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

      {anyActive && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {source !== "all" && (
            <FilterToken label={source} onRemove={() => onSourceChange("all")} />
          )}
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
