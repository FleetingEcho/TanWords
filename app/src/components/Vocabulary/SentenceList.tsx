import React from "react";
import { PatternItem } from "@/hooks/useDB.patterns";
import { useT } from "@/hooks/useT";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ListPaginator } from "@/components/shared/ListPaginator";
import { LevelDateFilter, LevelFilter } from "@/components/shared/LevelDateFilter";
import { Plus, Sparkles, ListChecks, Trash2, X, RefreshCw, Star } from "lucide-react";
import { hostCapabilities } from "@/platform";

interface Props {
  items: PatternItem[];
  expandedId: number | null;
  highlightId?: number;
  search: string;
  searchTokens: string[];
  levelFilter: LevelFilter;
  starredOnly: boolean;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
  onSearchChange: (v: string) => void;
  onLevelFilterChange: (v: LevelFilter) => void;
  onStarredOnlyChange: (v: boolean) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onToggleExpand: (item: PatternItem) => void;
  /** Double-click enters select mode (pre-selecting the sentence) or exits it */
  onDoubleClick: (item: PatternItem) => void;
  onPageChange: (p: number) => void;
  onPageSizeChange: (size: number) => void;
  onOpenAdd: () => void;
  onOpenGenerate: () => void;
  onRequestDelete: (item: PatternItem) => void;
  onReanalyze: (item: PatternItem) => void;
  reanalyzingId: number | null;
  onToggleStar: (id: number) => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onReanalyzeSelected: () => void;
}

/** Wraps every search-token occurrence in `text` with a <mark>, earliest
 *  match first (longest token wins a tie), so list rows show *why* they
 *  matched instead of leaving the reader to rescan the sentence. */
function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0 || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let pos = 0;
  while (pos < text.length) {
    let best = -1;
    let bestLen = 0;
    for (const tk of tokens) {
      const i = lower.indexOf(tk, pos);
      if (i === -1) continue;
      if (best === -1 || i < best || (i === best && tk.length > bestLen)) {
        best = i;
        bestLen = tk.length;
      }
    }
    if (best === -1) {
      nodes.push(text.slice(pos));
      break;
    }
    if (best > pos) nodes.push(text.slice(pos, best));
    nodes.push(
      <mark key={pos} className="rounded-sm bg-primary/25 text-inherit">
        {text.slice(best, best + bestLen)}
      </mark>
    );
    pos = best + bestLen;
  }
  return <>{nodes}</>;
}

/** When a row matched the search only through a field its collapsed line
 *  doesn't show (the note, the skeleton, an extra example), return that
 *  field's text so the row can surface it as a snippet — otherwise the row
 *  looks like a false positive. */
function findHiddenMatch(item: PatternItem, sentence: string, tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  const visible = `${sentence} ${item.zh}`.toLowerCase();
  if (tokens.every((tk) => visible.includes(tk))) return null;
  const hiddenFields = [
    item.note.startsWith("__") ? "" : item.note,
    item.pattern !== sentence ? item.pattern : "",
    ...item.examples.slice(1).map((e) => e.sentence),
  ];
  for (const field of hiddenFields) {
    if (!field) continue;
    const lower = field.toLowerCase();
    if (tokens.some((tk) => lower.includes(tk) && !visible.includes(tk))) return field;
  }
  return null;
}

/** Sentence library as a single full-width feed (HN-list style): one compact
 *  row per sentence, and clicking a row expands its translation / skeleton /
 *  note / extra examples inline right below it — no separate detail pane, so
 *  the sentence itself always gets the full width. */
export function SentenceList({
  items, expandedId, highlightId, search, searchTokens, levelFilter, starredOnly, dateFrom, dateTo, page, pageSize,
  onSearchChange, onLevelFilterChange, onStarredOnlyChange, onDateFromChange, onDateToChange,
  onToggleExpand, onDoubleClick, onPageChange, onPageSizeChange, onOpenAdd, onOpenGenerate, onRequestDelete, onReanalyze, reanalyzingId, onToggleStar,
  selectMode, onToggleSelectMode, selectedIds, onToggleSelect, onSelectAll, onClearSelection, onDeleteSelected, onReanalyzeSelected,
}: Props) {
  const t = useT();
  const paged = items.slice(page * pageSize, (page + 1) * pageSize);
  const [jumpHighlightId, setJumpHighlightId] = React.useState<number | null>(highlightId ?? null);
  React.useEffect(() => {
    if (!highlightId) return;
    setJumpHighlightId(highlightId);
    const timer = window.setTimeout(() => setJumpHighlightId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="mx-auto w-full max-w-4xl px-4 pt-5 pb-3 space-y-2.5 lg:px-6">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="min-w-0 truncate text-lg font-bold">{t("vocab.patterns.title")}</h2>
          <span className="text-sm text-muted-foreground">{items.length}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={onOpenAdd}
              title={t("vocab.patterns.addTooltip")}
              className="w-10 h-10 lg:w-6 lg:h-6 p-0 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              onClick={onOpenGenerate}
              title={t("vocab.patterns.genTooltip")}
              className="w-10 h-10 lg:w-6 lg:h-6 p-0 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 transition-colors shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              onClick={onToggleSelectMode}
              title={selectMode ? t("vocab.exitSelectMode") : t("vocab.enterSelectMode")}
              className={`w-10 h-10 lg:w-6 lg:h-6 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                selectMode ? "bg-primary/15 text-primary hover:bg-primary/20" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {selectMode && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
            <Checkbox
              checked={selectedIds.size === items.length && items.length > 0}
              onCheckedChange={() => (selectedIds.size === items.length ? onClearSelection() : onSelectAll())}
              title={selectedIds.size === items.length ? t("vocab.unselectAll") : t("vocab.selectAll")}
            />
            <span className="text-[11px] font-medium text-muted-foreground">{t("vocab.selectedCount", { n: selectedIds.size })}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                onClick={onReanalyzeSelected}
                disabled={selectedIds.size === 0 || reanalyzingId !== null}
                title={t("vocab.reanalyzeSelected")}
                className="w-10 h-10 lg:w-6 lg:h-6 p-0 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 disabled:opacity-30 transition-colors shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reanalyzingId !== null ? "animate-spin" : ""}`} />
              </Button>
              <Button
                variant="ghost"
                onClick={onDeleteSelected}
                disabled={selectedIds.size === 0}
                title={t("vocab.deleteSelected")}
                className="w-10 h-10 lg:w-6 lg:h-6 p-0 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                onClick={onToggleSelectMode}
                title={t("vocab.exitSelectMode")}
                className="w-10 h-10 lg:w-6 lg:h-6 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        <div className="relative -mx-4 lg:-mx-6">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("vocab.patterns.searchPlaceholder")}
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
          <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
        </div>

        <LevelDateFilter
          levelFilter={levelFilter}
          onLevelFilterChange={onLevelFilterChange}
          starredOnly={starredOnly}
          onStarredOnlyChange={onStarredOnlyChange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* data-no-selection opts the whole list out of the global SelectionAsk toolbar
            (Add word / Translate / Look up) — these rows are library management, not
            reading material to look words up from. */}
        <div className="mx-auto w-full max-w-4xl divide-y divide-border" data-no-selection>
          {paged.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {items.length === 0 && !search ? t("vocab.patterns.empty") : t("vocab.patterns.noMatch")}
            </div>
          )}
          {paged.map((item) => {
            const [primary, ...rest] = item.examples;
            const sentence = primary?.sentence ?? item.pattern;
            const expanded = !selectMode && item.id === expandedId;
            const showSkeleton = item.pattern && item.pattern !== sentence;
            const hiddenMatch = expanded ? null : findHiddenMatch(item, sentence, searchTokens);
            return (
              <div
                key={item.id}
                className={`${expanded ? "bg-muted/30" : ""} ${
                  jumpHighlightId === item.id
                    ? "relative z-20 rounded-sm ring-2 ring-inset ring-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
                    : ""
                }`}
              >
                {/* border-l lives on its own element, one level below the divide-y/divide-border
                    row above — that utility's `> :not([hidden]) ~ :not([hidden])` selector out-specifies
                    a plain border-l-* class and silently overrides border-left-color on every row but
                    the first if it shares an element with it. */}
                <div className={`border-l-2 ${item.starred ? "border-l-yellow-400" : "border-l-transparent"}`}>
                <div
                  onClick={() => (selectMode ? onToggleSelect(item.id) : onToggleExpand(item))}
                  onDoubleClick={() => onDoubleClick(item)}
                  className={`flex items-center gap-2 px-4 py-2.5 lg:px-5 cursor-pointer hover:bg-muted/50 transition-colors ${
                    expanded ? "sticky top-0 z-10 bg-background" : ""
                  } ${
                    selectedIds.has(item.id) ? "bg-accent/50" : ""
                  }`}
                >
                  {selectMode && (
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      onCheckedChange={() => onToggleSelect(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium wrap-break-word">
                      <Highlight text={sentence} tokens={searchTokens} />
                    </p>
                    {hostCapabilities.nativeTts && <SpeakButton text={sentence} className="w-3.5 h-3.5" />}
                    {hiddenMatch && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        <Highlight text={hiddenMatch} tokens={searchTokens} />
                      </p>
                    )}
                  </div>
                  <LevelBadge level={item.level} />
                  <Button
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); onToggleStar(item.id); }}
                    title={item.starred ? t("vocab.unstar") : t("vocab.star")}
                    className="w-9 h-9 lg:w-5 lg:h-5 p-0 rounded flex items-center justify-center shrink-0 hover:bg-transparent"
                  >
                    <Star className={`w-3.5 h-3.5 ${item.starred ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/50"}`} />
                  </Button>
                </div>

                {expanded && (
                  <div className="px-4 pb-4 space-y-3 animate-fade-in lg:px-5">
                    {item.zh && (
                      <p className="text-sm text-muted-foreground">
                        <Highlight text={item.zh} tokens={searchTokens} />
                      </p>
                    )}
                    {showSkeleton && (
                      <p className="text-xs font-mono text-muted-foreground/70">
                        <Highlight text={item.pattern} tokens={searchTokens} />
                      </p>
                    )}
                    {item.note && !item.note.startsWith("__") && (
                      <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm leading-6">
                        <Highlight text={item.note} tokens={searchTokens} />
                      </p>
                    )}
                    {rest.length > 0 && (
                      <section>
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          {t("vocab.patterns.moreExamples")}
                        </p>
                        <div className="space-y-2.5">
                          {rest.map((example) => (
                            <div key={example.id} className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                              <p className="min-w-0 flex-1 wrap-break-word text-sm leading-6">
                                <Highlight text={example.sentence} tokens={searchTokens} />
                              </p>
                              {hostCapabilities.nativeTts && <SpeakButton text={example.sentence} className="mt-0.5 w-3.5 h-3.5 shrink-0" />}
                              {example.source && (
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{example.source}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    <div className="flex items-center gap-2">
                      {primary?.source && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{primary.source}</span>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => onReanalyze(item)}
                        disabled={reanalyzingId !== null}
                        title={reanalyzingId === item.id ? t("vocab.patterns.reanalyzing") : t("vocab.patterns.reanalyzeTooltip")}
                        className="ml-auto w-7 h-7 p-0 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-40 transition-colors shrink-0"
                      >
                        <RefreshCw className={`w-4 h-4 ${reanalyzingId === item.id ? "animate-spin" : ""}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => onRequestDelete(item)}
                        title={t("vocab.patterns.delete")}
                        className="w-7 h-7 p-0 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {items.length > 0 && (
        <div className="shrink-0 border-t border-border">
          <ListPaginator
            className="mx-auto w-full max-w-4xl"
            page={page}
            pageSize={pageSize}
            total={items.length}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      )}
    </div>
  );
}
