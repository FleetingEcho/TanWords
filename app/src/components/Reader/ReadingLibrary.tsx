import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ClipboardPaste, Filter, MessageSquareText, Rss, Search, Trash2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import type { ReadingArticleItem } from "@/hooks/useDB.reading";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAGE_SIZE = 20;
const WPM = 220;

const SOURCE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  paste: ClipboardPaste,
  mcp: Bot,
  reader: Rss,
};

/** Splits "2026-07-26 21:40:00" into the two lines of the date gutter. */
function dateParts(value: string) {
  const [date] = value.split(" ");
  const [year, month, day] = date.split("-");
  return { day: `${month}/${day}`, year };
}

/**
 * The reading library: every article ever pasted in, saved from the reader,
 * or added by an agent over MCP.
 *
 * Laid out as a log rather than a grid of cards — these rows are one text
 * each, distinguished by when they were read and what's been written about
 * them, so the date runs down a gutter on the left and everything else hangs
 * off it. A card grid would give equal weight to thumbnails that don't exist
 * and hide the one thing worth scanning for: which of these has notes on it.
 */
export function ReadingLibrary({ onOpen }: { onOpen: (id: number) => void }) {
  const t = useT();
  const db = useDB();

  const [items, setItems] = useState<ReadingArticleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [onlyCommented, setOnlyCommented] = useState(false);
  const [sort, setSort] = useState<"recent" | "added" | "longest">("recent");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ReadingArticleItem | null>(null);
  // Guards concurrent loads: the last call wins, and a stale response
  // (earlier-started, later-finished) is dropped instead of clobbering it.
  const loadSeqRef = useRef(0);

  const load = useCallback(async (targetPage = page) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const result = await db.listReadingArticles({
        search, source: source === "all" ? "" : source,
        dateFrom, dateTo, onlyCommented, sort,
        page: targetPage, limit: PAGE_SIZE,
      });
      if (seq !== loadSeqRef.current) return;
      setItems(result.items);
      setTotal(result.total);
      // Deleting the last item on the last page must not strand the user on
      // an out-of-range page — that renders the "library empty" state and
      // hides the pagination bar, so the remaining articles on earlier pages
      // look deleted with no visible way back. Step to the last real page;
      // the page effect reloads it.
      if (result.items.length === 0 && targetPage > 0) {
        setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1));
      }
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [db, search, source, dateFrom, dateTo, onlyCommented, sort, page]);

  // Filter changes reset to the first page; page changes keep them.
  useEffect(() => { setPage(0); void load(0); }, [search, source, dateFrom, dateTo, onlyCommented, sort]);
  useEffect(() => { void load(page); }, [page]);

  // An agent can add or annotate articles while this is on screen.
  useEffect(() => {
    const onChange = () => { void load(page); };
    window.addEventListener("articles-updated", onChange);
    return () => window.removeEventListener("articles-updated", onChange);
  }, [load, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = !!search || source !== "all" || !!dateFrom || !!dateTo || onlyCommented;
  const advancedFiltersActive = source !== "all" || !!dateFrom || !!dateTo || onlyCommented || sort !== "recent";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Centered search with secondary filters collapsed out of the way. */}
      <div className="shrink-0 border-b border-border/60">
        <div className="mx-auto px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("library.searchPlaceholder")}
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs placeholder:text-muted-foreground/40 focus:outline-hidden focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className={`mt-2 flex items-center gap-1.5 text-[11px] font-medium transition-colors hover:text-foreground ${
              advancedFiltersActive ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Filter className="h-3 w-3" />
            {t("library.filters")}
            <ChevronDown className={`h-3 w-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
          </button>

          {filtersOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-8 w-auto min-w-[104px] gap-1.5 rounded-lg border-border bg-background px-2.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("library.sourceAll")}</SelectItem>
                  <SelectItem value="paste">{t("library.sourcePaste")}</SelectItem>
                  <SelectItem value="mcp">{t("library.sourceMcp")}</SelectItem>
                  <SelectItem value="reader">{t("library.sourceReader")}</SelectItem>
                </SelectContent>
              </Select>

              <DateRangePicker from={dateFrom} to={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} placeholder={t("library.dateRange")} className="w-auto" />

              <Button
                variant="ghost"
                onClick={() => setOnlyCommented((v) => !v)}
                aria-pressed={onlyCommented}
                className={`h-8 gap-1.5 rounded-lg px-2.5 text-xs font-medium ${onlyCommented ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                {t("library.onlyCommented")}
              </Button>

              <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                <SelectTrigger className="h-8 w-auto min-w-[92px] gap-1.5 rounded-lg border-border bg-background px-2.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">{t("library.sortRecent")}</SelectItem>
                  <SelectItem value="added">{t("library.sortAdded")}</SelectItem>
                  <SelectItem value="longest">{t("library.sortLongest")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Log */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loading && items.length === 0 ? (
          <p className="px-5 py-16 text-center text-xs text-muted-foreground">
            {filtered ? t("library.noResults") : t("library.empty")}
          </p>
        ) : (
          <div className="mx-auto max-w-4xl px-5 py-2">
            {items.map((item) => {
              const { day, year } = dateParts(item.last_read_at);
              const SourceIcon = SOURCE_ICONS[item.source] ?? ClipboardPaste;
              return (
                <div
                  key={item.id}
                  onClick={() => onOpen(item.id)}
                  className="group flex cursor-pointer gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-muted"
                >
                  <div className="w-11 shrink-0 pt-0.5 text-right">
                    <p className="text-[11px] font-semibold tabular-nums text-foreground/70">{day}</p>
                    <p className="text-[9px] tabular-nums text-muted-foreground/50">{year}</p>
                  </div>

                  <div className="w-px shrink-0 bg-border/70 transition-colors group-hover:bg-primary/40" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.title || t("library.untitled")}</p>
                    {item.snippet && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{item.snippet}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2.5 text-[10px] text-muted-foreground/70">
                      <span className="inline-flex items-center gap-1">
                        <SourceIcon className="h-3 w-3" />
                        {t(`library.source.${item.source}`)}
                      </span>
                      <span className="tabular-nums">
                        {t("library.meta", {
                          words: item.word_count.toLocaleString(),
                          minutes: Math.max(1, Math.round(item.word_count / WPM)),
                        })}
                      </span>
                      {item.comment_count > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                          <MessageSquareText className="h-2.5 w-2.5" />
                          {item.comment_count}
                        </span>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(item); }}
                    title={t("common.delete")}
                    className="h-7 w-7 shrink-0 self-center p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 border-t border-border/60 px-5 py-2.5 text-xs">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="h-7 rounded-lg px-2.5 text-xs disabled:opacity-30">
            {t("library.prev")}
          </Button>
          <span className="tabular-nums text-muted-foreground">{t("library.pageOf", { page: page + 1, pages })}</span>
          <Button variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="h-7 rounded-lg px-2.5 text-xs disabled:opacity-30">
            {t("library.next")}
          </Button>
        </div>
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("library.deleteConfirmTitle")}
        message={t("library.deleteConfirmMessage", { title: pendingDelete?.title ?? "" })}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await db.deleteReadingArticle(pendingDelete.id);
            setPendingDelete(null);
            void load(page);
          }
        }}
      />
    </div>
  );
}
