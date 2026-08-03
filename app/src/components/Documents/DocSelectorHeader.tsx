import type React from "react";
import { ChevronsLeft, Download, FileInput, Filter, MoreHorizontal, Paperclip } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LIST_PANEL_TOGGLE_CLASS } from "@/components/shared/listPanel";
import type { DocListState } from "./hooks/useDocList";

/** Search box, sort/tag/date filters, and the header action row (new doc,
 * attachments manager, import/export menu). Split out of DocSelector purely
 * for size — it's a single self-contained block reading from useDocList. */
export function DocSelectorHeader({
  list, onCollapse, onNewDoc, onOpenImages, onImport, onExportAll, sourceTabs,
}: {
  list: DocListState;
  onCollapse?: () => void;
  /** The database/local-folder switcher, which lives in this row rather than
   *  in a bar of its own — see DocSourceTabs. */
  sourceTabs?: React.ReactNode;
  onNewDoc: () => void;
  onOpenImages: () => void;
  onImport: () => void;
  onExportAll: () => void;
}) {
  const t = useT();
  const {
    search, setSearch, sort, setSort, tagFilter, setTagFilter, allTags,
    dateFrom, dateTo, setDateFrom, setDateTo, filtersOpen, setFiltersOpen,
  } = list;

  return (
    <div className="px-3 pt-4 pb-2 space-y-2 shrink-0">
      {sourceTabs}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {onCollapse && (
            <Button variant="ghost" size="icon" onClick={onCollapse} className={`h-6 w-6 ${LIST_PANEL_TOGGLE_CLASS}`} title={t("doc.collapseFiles")}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenImages}
            className="h-6 w-6 text-muted-foreground hover:text-primary"
            title={t("doc.manageDatabaseImages")}
            aria-label={t("doc.manageDatabaseImages")}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
          <Button onClick={onNewDoc} className="h-6 px-2.5 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary/90">+ {t("doc.newDoc")}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onImport}><FileInput className="h-3.5 w-3.5" /> {t("doc.importMarkdown")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onExportAll}><Download className="h-3.5 w-3.5" /> {t("doc.exportAllMarkdown")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="9" r="5" />
          <path d="M13 13l3 3" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("doc.search")}
          className="w-full h-7 pl-7 pr-2.5 text-xs rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary/40"
        />
      </div>

      {/* Sort + tag + date filters — collapsed by default, same pattern as
        * Vocabulary's LevelDateFilter, so the list gets more room by default. */}
      <div>
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Filter className="w-3 h-3" />
          {t("doc.filters")}
          {(sort !== "modified" || tagFilter || dateFrom || dateTo) && (
            <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-bold text-primary">
              {[sort !== "modified", !!tagFilter, !!(dateFrom || dateTo)].filter(Boolean).length}
            </span>
          )}
          <svg viewBox="0 0 12 12" className={`w-2.5 h-2.5 shrink-0 transition-transform ${filtersOpen ? "rotate-90" : ""}`}>
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
        </button>

        {filtersOpen && (
          <div className="space-y-2 pt-2.5">
            <div className="flex gap-1.5">
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="flex-1 h-6 text-[11px] rounded-lg border border-border bg-card text-foreground focus:outline-hidden px-1.5 gap-1 [&_svg]:h-3 [&_svg]:w-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="modified">{t("doc.sortModified")}</SelectItem>
                  <SelectItem value="created">{t("doc.sortCreated")}</SelectItem>
                  <SelectItem value="title">{t("doc.sortTitle")}</SelectItem>
                </SelectContent>
              </Select>
              {allTags.length > 0 && (
                <Select value={tagFilter || "__all__"} onValueChange={(v) => setTagFilter(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="flex-1 h-6 text-[11px] rounded-lg border border-border bg-card text-foreground focus:outline-hidden px-1.5 gap-1 [&_svg]:h-3 [&_svg]:w-3">
                    <SelectValue placeholder={t("doc.allTags")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("doc.allTags")}</SelectItem>
                    {allTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
              placeholder={t("doc.dateRangePlaceholder")}
              className="w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
