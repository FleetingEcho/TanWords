import React from "react";
import { WordListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { SparkIcon } from "@/components/ui/icons";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PencilIcon, ChatBubbleLeftIcon, RectangleStackIcon, LightBulbIcon, StarIcon } from "@heroicons/react/24/outline";

type LevelFilter = "all" | "C2" | "C1" | "B2" | "B1-";
type SortBy = "recent" | "freq" | "alpha";
type DateField = "created" | "updated";

const LEVEL_CHIPS: LevelFilter[] = ["all", "C2", "C1", "B2", "B1-"];

/** Small origin marker so "where did this word come from" is visible at a glance */
const SOURCE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  manual: PencilIcon,
  ai: SparkIcon,
  chat: ChatBubbleLeftIcon,
  batch: RectangleStackIcon,
  discover: LightBulbIcon,
  seed: StarIcon,
};

interface Props {
  words: WordListItem[];
  selectedId: number | null;
  search: string;
  sortBy: SortBy;
  levelFilter: LevelFilter;
  sourceFilter: string;
  sources: string[];
  page: number;
  pageSize: number;
  /** The searched term isn't in the vocabulary — offer an AI dictionary lookup */
  showAiLookup: boolean;
  lookupActive: boolean;
  dateField: DateField;
  dateFrom: string;
  dateTo: string;
  onSearchChange: (v: string) => void;
  onSortChange: (v: SortBy) => void;
  onFilterChange: (v: LevelFilter) => void;
  onSourceFilterChange: (v: string) => void;
  onDateFieldChange: (v: DateField) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onSelect: (w: WordListItem) => void;
  onPageChange: (p: number) => void;
  onDoubleClick: (word: string) => void;
  onAiLookup: (q: string) => void;
  onOpenGenerate: () => void;
}

export function WordListPanel({
  words, selectedId, search, sortBy, levelFilter, sourceFilter, sources, page, pageSize,
  showAiLookup, lookupActive, dateField, dateFrom, dateTo,
  onSearchChange, onSortChange, onFilterChange, onSourceFilterChange,
  onDateFieldChange, onDateFromChange, onDateToChange,
  onSelect, onPageChange, onDoubleClick, onAiLookup, onOpenGenerate,
}: Props) {
  const t = useT();
  const totalPages = Math.ceil(words.length / pageSize);
  const paged = words.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="w-80 shrink-0 border-r border-border bg-card flex flex-col h-full">
      <div className="px-4 pt-5 pb-3 space-y-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold">{t("vocab.title")}</h2>
          <span className="text-sm text-muted-foreground">{t("vocab.wordCount", { n: words.length })}</span>
          <Button
            variant="ghost"
            onClick={onOpenGenerate}
            title={t("vocab.generateBtn")}
            className="ml-auto w-6 h-6 p-0 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 transition-colors shrink-0"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5">
              <path d="M10 4v12M4 10h12" strokeLinecap="round" />
            </svg>
          </Button>
          <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortBy)}>
            <SelectTrigger className="h-6 w-auto gap-1 px-1.5 py-0 rounded-md border border-input bg-background text-[11px] text-muted-foreground focus:outline-none [&_svg]:h-3 [&_svg]:w-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">{t("vocab.sortRecent")}</SelectItem>
              <SelectItem value="freq">{t("vocab.sortFreq")}</SelectItem>
              <SelectItem value="alpha">{t("vocab.sortAlpha")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Dictionary search — hits the vocabulary first, AI lookup as fallback */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && showAiLookup && search.trim()) onAiLookup(search.trim());
            }}
            placeholder={t("vocab.searchDict")}
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
        </div>

        {/* Level chips */}
        <div className="flex gap-1 flex-wrap">
          {LEVEL_CHIPS.map((lv) => (
            <Button
              key={lv}
              variant="ghost"
              onClick={() => onFilterChange(lv)}
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

        {/* Source chips — only when the vocabulary has more than one origin */}
        {sources.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <Button
              variant="ghost"
              onClick={() => onSourceFilterChange("all")}
              className={`h-auto px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                sourceFilter === "all"
                  ? "bg-muted text-foreground border-transparent hover:bg-muted"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:bg-transparent"
              }`}
            >
              {t("vocab.source.all")}
            </Button>
            {sources.map((s) => (
              <Button
                key={s}
                variant="ghost"
                onClick={() => onSourceFilterChange(s)}
                className={`h-auto px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                  sourceFilter === s
                    ? "bg-muted text-foreground border-transparent hover:bg-muted"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:bg-transparent"
                }`}
              >
                {SOURCE_ICONS[s] ? React.createElement(SOURCE_ICONS[s], { className: "w-2.5 h-2.5 inline" }) : "·"} {t(`vocab.source.${s}`)}
              </Button>
            ))}
          </div>
        )}

        {/* Time-range filter — added vs. last-updated, each with a date range */}
        <div className="flex items-center gap-1.5">
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
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(from, to) => { onDateFromChange(from); onDateToChange(to); }}
            placeholder={t("vocab.dateRangePlaceholder")}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {/* AI dictionary lookup entry for words not in the vocabulary */}
        {showAiLookup && search.trim() && (
          <Button
            variant="ghost"
            onClick={() => onAiLookup(search.trim())}
            className={`h-auto w-full px-4 py-3 text-left justify-start block rounded-none transition-colors ${
              lookupActive ? "bg-accent/50 hover:bg-accent/50" : "hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <SparkIcon className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-semibold text-primary truncate">{search.trim()}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{t("vocab.aiLookupHint")}</p>
          </Button>
        )}

        {paged.length === 0 && !showAiLookup && (
          <div className="p-4 text-center text-sm text-muted-foreground">{t("vocab.empty")}</div>
        )}
        {paged.map((w) => (
          <div
            key={w.id}
            onDoubleClick={() => onDoubleClick(w.word)}
            onClick={() => onSelect(w)}
            className={`px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
              selectedId === w.id && !lookupActive ? "bg-accent/50" : ""
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-sm truncate">{w.word}</span>
              <LevelBadge level={w.level} />
              <SpeakButton text={w.word} className="w-3.5 h-3.5" />
              <span className="ml-auto text-muted-foreground/50 shrink-0">
                {SOURCE_ICONS[w.source] && React.createElement(SOURCE_ICONS[w.source], { className: "w-3 h-3" })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {w.word_type && <span className="mr-1">{w.word_type}.</span>}
              {w.zh}
            </p>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="shrink-0 border-t border-border px-3 py-2 flex items-center justify-between gap-1">
          <Button
            variant="ghost"
            onClick={() => onPageChange(Math.max(0, page - 1))}
            disabled={page === 0}
            className="w-7 h-7 p-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M9.78 12.78a.75.75 0 01-1.06 0L4.47 8.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L6.06 8l3.72 3.72a.75.75 0 010 1.06z" clipRule="evenodd" />
            </svg>
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, words.length)} / {words.length}
          </span>
          <Button
            variant="ghost"
            onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
            disabled={(page + 1) * pageSize >= words.length}
            className="w-7 h-7 p-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </Button>
        </div>
      )}
    </div>
  );
}

export type { LevelFilter, SortBy, DateField };
