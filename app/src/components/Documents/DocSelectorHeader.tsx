import type React from "react";
import { Download, FileInput, MoreHorizontal, Paperclip } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DocPanelHeader } from "./DocPanelHeader";
import type { DocListState } from "./hooks/useDocList";
import type { DocStatus } from "@/hooks/useDB";
import type { DocListDensity } from "./docListDensity";
import { tagHue } from "./tagColor";
import { STATUS_LIST, StatusIcon, statusColor, statusLabelKey } from "./documentStatus";

/** Search box, sort/tag/date filters, and the header action row (new doc,
 * attachments manager, import/export menu). Split out of DocSelector purely
 * for size — it's a single self-contained block reading from useDocList.
 *
 * The layout itself lives in DocPanelHeader, shared with the local-folder
 * panel; what stays here is only what the database library has that the folder
 * one does not — the attachment manager and the sort/tag/date filters. */
export function DocSelectorHeader({
  list, density, onDensityChange, onCollapse, onNewDoc, onOpenImages, onImport, onExportAll, sourceTabs,
}: {
  list: DocListState;
  density: DocListDensity;
  onDensityChange: (next: DocListDensity) => void;
  onCollapse?: () => void;
  /** The database/local-folder switcher, which lives in the header's first row
   *  rather than in a bar of its own — see DocSourceTabs. */
  sourceTabs?: React.ReactNode;
  onNewDoc: () => void;
  onOpenImages: () => void;
  onImport: () => void;
  onExportAll: () => void;
}) {
  const t = useT();
  const {
    search, setSearch, sort, setSort, tagFilter, setTagFilter, allTags, tagCounts,
    statusFilter, setStatusFilter, statusCounts,
    dateFrom, dateTo, setDateFrom, setDateTo, filtersOpen, setFiltersOpen, total,
  } = list;

  const activeFilters = [sort !== "modified", !!tagFilter, !!statusFilter, !!(dateFrom || dateTo)].filter(Boolean).length;

  return (
    <DocPanelHeader
      sourceTabs={sourceTabs}
      onCollapse={onCollapse}
      collapseLabel={t("doc.collapseFiles")}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("doc.search")}
      searchAriaLabel={t("doc.search")}
      onNew={onNewDoc}
      newLabel={t("doc.newDoc")}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenImages}
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
            title={t("doc.manageDatabaseImages")}
            aria-label={t("doc.manageDatabaseImages")}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" title={t("doc.more")} aria-label={t("doc.more")}>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onImport}><FileInput className="h-3.5 w-3.5" /> {t("doc.importMarkdown")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onExportAll}><Download className="h-3.5 w-3.5" /> {t("doc.exportAllMarkdown")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      filters={{
        open: filtersOpen,
        onToggle: () => setFiltersOpen((open) => !open),
        activeCount: activeFilters,
        label: t("doc.filters"),
        content: (
          <div className="space-y-2 pt-0.5">
            {/* Wrapping, with a floor on each control's width: three of these
              * side by side in a ~280px panel left each one ~85px, so every
              * label truncated to an ellipsis ("Last…") and the last one
              * crowded the panel edge. Two per row, the third dropping to its
              * own line, is legible at any panel width. */}
            <div className="flex flex-wrap gap-1.5">
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-6 min-w-[7.5rem] flex-1 gap-1 rounded-lg border border-border bg-card px-1.5 text-[11px] text-foreground focus:outline-hidden [&_svg]:h-3 [&_svg]:w-3">
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
                  <SelectTrigger className="h-6 min-w-[7.5rem] flex-1 gap-1 rounded-lg border border-border bg-card px-1.5 text-[11px] text-foreground focus:outline-hidden [&_svg]:h-3 [&_svg]:w-3">
                    {tagFilter && (
                      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `hsl(${tagHue(tagFilter)} 55% var(--tag-chip-l, 38%))` }} />
                    )}
                    <SelectValue placeholder={t("doc.allTags")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">
                      <span className="flex min-w-[8rem] items-center justify-between gap-2 pr-1">
                        <span>{t("doc.allTags")}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{total}</span>
                      </span>
                    </SelectItem>
                    {allTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        <span className="flex w-full min-w-[8rem] items-center gap-1.5">
                          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `hsl(${tagHue(tag)} 55% var(--tag-chip-l, 38%))` }} />
                          <span className="min-w-0 flex-1 truncate">{tag}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{tagCounts.get(tag) ?? 0}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-6 min-w-[7.5rem] flex-1 gap-1 rounded-lg border border-border bg-card px-1.5 text-[11px] text-foreground focus:outline-hidden [&_svg]:h-3 [&_svg]:w-3">
                  {statusFilter && <StatusIcon status={statusFilter as DocStatus} className="h-3 w-3" />}
                  <SelectValue placeholder={t("doc.allStatuses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    <span className="flex min-w-[8rem] items-center justify-between gap-2 pr-1">
                      <span>{t("doc.allStatuses")}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{total}</span>
                    </span>
                  </SelectItem>
                  {STATUS_LIST.map((value) => (
                    <SelectItem key={value} value={value}>
                      <span className="flex w-full min-w-[8rem] items-center gap-1.5" style={{ color: statusColor(value) }}>
                        <StatusIcon status={value} className="h-3 w-3" />
                        <span className="min-w-0 flex-1 truncate">{t(statusLabelKey(value))}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{statusCounts.get(value) ?? 0}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
              placeholder={t("doc.dateRangePlaceholder")}
              className="w-full"
            />

            {/* How roomy each row is. Rows are the densest surface in the app,
              * so this is a glancing preference rather than a filter — comfort
              * shows a preview, compact keeps the folder tree tight. */}
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/60 p-0.5">
              {(["comfortable", "compact"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onDensityChange(value)}
                  aria-pressed={density === value}
                  className={`h-6 rounded-md px-2 text-[10px] font-medium transition-colors ${
                    density === value
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(value === "compact" ? "doc.densityCompact" : "doc.densityComfortable")}
                </button>
              ))}
            </div>
          </div>
        ),
      }}
    />
  );
}
