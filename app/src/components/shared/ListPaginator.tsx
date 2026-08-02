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
}

/** Slim list footer: page size on the left, range + arrows as one pill on the
 * right. Kept to a single 28px row because on phones this bar is sandwiched
 * between the list and the tab bar, where a full-height control reads as a
 * second navigation strip. The "per page" label is dropped below `sm`; the
 * select itself already says what the number means. */
export function ListPaginator({
  page, pageSize, total, onPageChange, onPageSizeChange, className = "",
}: Props) {
  const t = useT();
  const totalPages = Math.ceil(total / pageSize);
  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, total);

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
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
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
          {first}–{last} / {total}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={last >= total}
          aria-label={t("common.nextPage")}
          className="h-7 w-8 flex items-center justify-center rounded-r-full text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
