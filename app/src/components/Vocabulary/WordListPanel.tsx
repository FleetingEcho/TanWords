import React from "react";
import { WordListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { SparkIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LevelDateFilter, LevelValue } from "@/components/shared/LevelDateFilter";
import { LIST_PANEL_WIDTH, LIST_PANEL_COLLAPSED_WIDTH, LIST_PANEL_TOGGLE_CLASS } from "@/components/shared/listPanel";
import { Wand2, RefreshCw, Sparkles, Loader2, ChevronsLeft, ChevronsRight, Trash2, X, Star, ListChecks, Columns2, Rows3 } from "lucide-react";

interface Props {
  words: WordListItem[];
  selectedId: number | null;
  highlightId?: number;
  search: string;
  /** Selected level chips — empty means "all levels" */
  levelFilter: LevelValue[];
  starredOnly: boolean;
  onStarredOnlyChange: (v: boolean) => void;
  page: number;
  pageSize: number;
  /** The searched term isn't in the vocabulary — offer an AI dictionary lookup */
  showAiLookup: boolean;
  lookupActive: boolean;
  dateFrom: string;
  dateTo: string;
  onSearchChange: (v: string) => void;
  onFilterChange: (v: LevelValue[]) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onRefresh: () => void;
  onSelect: (w: WordListItem) => void;
  onPageChange: (p: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Double-click enters select mode (pre-selecting the word) or exits it */
  onDoubleClick: (w: WordListItem) => void;
  onAiLookup: (q: string) => void;
  /** True while a bulk enrichment (un-analyzed or re-analyze-all) is running */
  bulkRunning: boolean;
  bulkProgress: { done: number; total: number };
  onEnrichUnanalyzed: () => void;
  onReanalyzeAll: () => void;
  onStopBulkEnrich: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onReanalyzeSelected: () => void;
  onDeleteSelected: () => void;
  onToggleStar: (id: number) => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  /** Full-width feed layout (like the Sentences tab): rows span the page and
   *  the detail renders inline below the selected word instead of beside the list. */
  fullWidth: boolean;
  onToggleLayout: () => void;
  renderDetail: () => React.ReactNode;
}

export function WordListPanel({
  words, selectedId, highlightId, search, levelFilter, starredOnly, onStarredOnlyChange, page, pageSize,
  showAiLookup, lookupActive, dateFrom, dateTo,
  onSearchChange, onFilterChange,
  onDateFromChange, onDateToChange, onRefresh,
  onSelect, onPageChange, onPageSizeChange, onDoubleClick, onAiLookup,
  bulkRunning, bulkProgress, onEnrichUnanalyzed, onReanalyzeAll, onStopBulkEnrich,
  collapsed, onToggleCollapsed, selectedIds, onToggleSelect, onSelectAll, onClearSelection,
  onReanalyzeSelected, onDeleteSelected, onToggleStar, selectMode, onToggleSelectMode,
  fullWidth, onToggleLayout, renderDetail,
}: Props) {
  const t = useT();
  const totalPages = Math.ceil(words.length / pageSize);
  const paged = words.slice(page * pageSize, (page + 1) * pageSize);
  const measure = fullWidth ? "mx-auto w-full max-w-4xl" : "";
  const [jumpHighlightId, setJumpHighlightId] = React.useState<number | null>(highlightId ?? null);
  React.useEffect(() => {
    if (!highlightId) return;
    setJumpHighlightId(highlightId);
    const timer = window.setTimeout(() => setJumpHighlightId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  if (collapsed && !fullWidth) {
    return (
      <div className={`${LIST_PANEL_COLLAPSED_WIDTH} shrink-0 border-r border-border bg-card flex flex-col items-center py-3`}>
        <Button
          variant="ghost"
          onClick={onToggleCollapsed}
          title={t("vocab.expandList")}
          className={`w-7 h-7 p-0 rounded-lg flex items-center justify-center ${LIST_PANEL_TOGGLE_CLASS}`}
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className={fullWidth ? "flex-1 min-h-0 flex flex-col" : `${LIST_PANEL_WIDTH} shrink-0 border-r border-border bg-card flex flex-col h-full`}>
      <div className={`${measure} ${fullWidth ? "px-6" : "px-4"} pt-5 pb-3 space-y-2.5`}>
        <div className="flex items-baseline gap-2">
          {!fullWidth && (
            <Button
              variant="ghost"
              onClick={onToggleCollapsed}
              title={t("vocab.collapseList")}
              className={`-ml-1 w-6 h-6 p-0 rounded-md flex items-center justify-center shrink-0 ${LIST_PANEL_TOGGLE_CLASS}`}
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
          )}
          <h2 className="text-lg font-bold">{t("vocab.title")}</h2>
          <span className="text-sm text-muted-foreground">{words.length}</span>
          <div className="ml-auto flex items-center gap-1">
            {bulkRunning ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    onClick={onStopBulkEnrich}
                    className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("vocab.bulkEnrichProgress", { done: bulkProgress.done, total: bulkProgress.total })} · {t("vocab.bulkEnrichStop")}
                </TooltipContent>
              </Tooltip>
            ) : !selectMode && (
              <>
                <Button
                  variant="ghost"
                  onClick={onRefresh}
                  title={t("vocab.refreshList")}
                  className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={onEnrichUnanalyzed}
                  title={t("vocab.enrichUnanalyzed")}
                  className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 transition-colors shrink-0"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={onReanalyzeAll}
                  title={t("vocab.reanalyzeAll")}
                  className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              onClick={onToggleLayout}
              title={fullWidth ? t("vocab.layoutSplit") : t("vocab.layoutFull")}
              className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            >
              {fullWidth ? <Columns2 className="w-3.5 h-3.5" /> : <Rows3 className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              onClick={onToggleSelectMode}
              title={selectMode ? t("vocab.exitSelectMode") : t("vocab.enterSelectMode")}
              className={`w-6 h-6 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                selectMode ? "bg-primary/15 text-primary hover:bg-primary/20" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {selectMode && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
            <Checkbox
              checked={selectedIds.size === words.length && words.length > 0}
              onCheckedChange={() => (selectedIds.size === words.length ? onClearSelection() : onSelectAll())}
              title={selectedIds.size === words.length ? t("vocab.unselectAll") : t("vocab.selectAll")}
            />
            <span className="text-[11px] font-medium text-muted-foreground">{t("vocab.selectedCount", { n: selectedIds.size })}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                onClick={onReanalyzeSelected}
                disabled={selectedIds.size === 0}
                title={t("vocab.reanalyzeSelected")}
                className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 disabled:opacity-30 transition-colors shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                onClick={onDeleteSelected}
                disabled={selectedIds.size === 0}
                title={t("vocab.deleteSelected")}
                className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                onClick={onToggleSelectMode}
                title={t("vocab.exitSelectMode")}
                className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

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

        <LevelDateFilter
          levels={levelFilter}
          onLevelsChange={onFilterChange}
          starredOnly={starredOnly}
          onStarredOnlyChange={onStarredOnlyChange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className={`${measure} divide-y divide-border`}>
        {/* AI dictionary lookup entry for words not in the vocabulary */}
        {showAiLookup && search.trim() && (
          <>
            <Button
              variant="ghost"
              onClick={() => onAiLookup(search.trim())}
              className={`h-auto w-full ${fullWidth ? "px-6" : "px-4"} py-3 text-left justify-start block rounded-none transition-colors ${
                lookupActive ? "bg-accent/50 hover:bg-accent/50" : "hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <SparkIcon className="w-3.5 h-3.5 text-primary" />
                <span className="text-sm font-semibold text-primary truncate">{search.trim()}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{t("vocab.aiLookupHint")}</p>
            </Button>
            {fullWidth && lookupActive && (
              <div className="flex h-[70vh] border-b border-border bg-background">{renderDetail()}</div>
            )}
          </>
        )}

        {paged.length === 0 && !showAiLookup && (
          <div className="p-4 text-center text-sm text-muted-foreground">{t("vocab.empty")}</div>
        )}
        {paged.map((w) => {
          const expanded = fullWidth && !selectMode && !lookupActive && selectedId === w.id;
          return (
          <div
            key={w.id}
            className={jumpHighlightId === w.id ? "relative z-20 rounded-sm ring-2 ring-inset ring-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]" : ""}
          >
          {/* border-l lives one level below the divide-y/divide-border row above — that
              utility's `> :not([hidden]) ~ :not([hidden])` selector out-specifies a plain
              border-l-* class and silently overrides border-left-color on every row but
              the first if it shares an element with it. */}
          <div className={`border-l-2 ${w.starred ? "border-l-yellow-400" : "border-l-transparent"}`}>
          <div
            onDoubleClick={() => onDoubleClick(w)}
            onClick={() => (selectMode ? onToggleSelect(w.id) : onSelect(w))}
            className={`${fullWidth ? "px-6 py-2.5" : "px-4 py-3"} cursor-pointer hover:bg-muted/50 transition-colors ${
              expanded ? "sticky top-0 z-10 bg-background" : ""
            } ${
              selectedIds.has(w.id) || (selectedId === w.id && !lookupActive) ? "bg-accent/50" : ""
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {selectMode && (
                <Checkbox
                  checked={selectedIds.has(w.id)}
                  onCheckedChange={() => onToggleSelect(w.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                />
              )}
              <span className="font-semibold text-sm truncate shrink-0">{w.word}</span>
              <LevelBadge level={w.level} />
              <SpeakButton text={w.word} className="w-3.5 h-3.5" />
              {/* Full-width rows are single-line: the gloss rides inline instead of a second line */}
              {fullWidth && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {w.word_type && <span className="mr-1">{w.word_type}.</span>}
                  {w.zh}
                </span>
              )}
              <Button
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onToggleStar(w.id); }}
                title={w.starred ? t("vocab.unstar") : t("vocab.star")}
                className="ml-auto w-5 h-5 p-0 rounded flex items-center justify-center shrink-0 hover:bg-transparent"
              >
                <Star className={`w-3.5 h-3.5 ${w.starred ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/50"}`} />
              </Button>
            </div>
            {!fullWidth && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {w.word_type && <span className="mr-1">{w.word_type}.</span>}
                {w.zh}
              </p>
            )}
          </div>
          {expanded && (
            <div className="flex h-[70vh] border-t border-border bg-background">{renderDetail()}</div>
          )}
          </div>
          </div>
          );
        })}
        </div>
      </div>

      {words.length > 0 && (
        <div className="shrink-0 border-t border-border">
        <div className={`${measure} px-3 py-2 flex items-center justify-between gap-2`}>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{t("vocab.perPage")}</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              aria-label={t("vocab.perPage")}
            >
              {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-1">
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
        </div>
        </div>
      )}
    </div>
  );
}

export type { LevelValue };
