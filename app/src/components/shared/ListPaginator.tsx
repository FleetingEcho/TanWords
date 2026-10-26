import { ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/useT";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface Props {
  page: number;
  pageSize: number;
  /** Number of items *after* filtering — the list the pager actually walks. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
  /** Optional custom per-page choices (the Sentences feed offers up to 1000
   *  for scanning long piles). Defaults to the compact [10..100] set. */
  pageSizeOptions?: readonly number[];
}

/** Slim list footer: page size on the left, range + arrows as one pill on the
 * right. Kept to a single 28px row because on phones this bar is sandwiched
 * between the list and the tab bar, where a full-height control reads as a
 * second navigation strip. The "per page" label is dropped below `sm`; the
 * select itself already says what the number means. */
export function ListPaginator({
  page, pageSize, total, onPageChange, onPageSizeChange, className = "", pageSizeOptions,
}: Props) {
  const t = useT();
  // Guard against a caller handing in `undefined` (mixed HMR module state,
  // future refactors): Math.min(cutoff, undefined) made `last` NaN and the
  // range label rendered "1–NaN / <nothing>". A bad total degrades to an
  // honest 0 rather than a corrupted pill.
  const safeTotal = Number.isFinite(total) ? total : 0;
  const totalPages = Math.ceil(safeTotal / pageSize);
  const first = safeTotal === 0 ? 0 : page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, safeTotal);

  return (
    <div className={`px-3 py-1.5 flex items-center justify-between gap-2 ${className}`}>
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="hidden sm:inline">{t("vocab.perPage")}</span>
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger
            className="h-7 w-[3.75rem] rounded-full border-border/60 bg-transparent px-2.5 text-[11px]"
            aria-label={t("vocab.perPage")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* A persisted choice outside the offered set (e.g. an old "10"
              * after the list moved to 20-based tiers) must still render —
              * without a matching item the trigger paints a blank width. */}
            {(() => {
              const base = pageSizeOptions ?? PAGE_SIZE_OPTIONS;
              const options = base.includes(pageSize) ? base : [pageSize, ...base].sort((a, b) => a - b);
              return options.map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ));
            })()}
          </SelectContent>
        </Select>
      </label>

      <div className="flex items-center h-7 rounded-full border border-border/60">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          aria-label={t("common.prevPage")}
          className="h-7 w-8 flex items-center justify-center rounded-l-full text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="px-1 text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
          {first}–{last} / {safeTotal}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={last >= safeTotal}
          aria-label={t("common.nextPage")}
          className="h-7 w-8 flex items-center justify-center rounded-r-full text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
