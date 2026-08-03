import type React from "react";
import { Download, FileInput, MoreHorizontal, Paperclip } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DocPanelHeader } from "./DocPanelHeader";
import type { DocListState } from "./hooks/useDocList";

/** Search box, sort/tag/date filters, and the header action row (new doc,
 * attachments manager, import/export menu). Split out of DocSelector purely
 * for size — it's a single self-contained block reading from useDocList.
 *
 * The layout itself lives in DocPanelHeader, shared with the local-folder
 * panel; what stays here is only what the database library has that the folder
 * one does not — the attachment manager and the sort/tag/date filters. */
export function DocSelectorHeader({
  list, onCollapse, onNewDoc, onOpenImages, onImport, onExportAll, sourceTabs,
}: {
  list: DocListState;
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
    search, setSearch, sort, setSort, tagFilter, setTagFilter, allTags,
    dateFrom, dateTo, setDateFrom, setDateTo, filtersOpen, setFiltersOpen,
  } = list;

  const activeFilters = [sort !== "modified", !!tagFilter, !!(dateFrom || dateTo)].filter(Boolean).length;

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
            <div className="flex gap-1.5">
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-6 flex-1 gap-1 rounded-lg border border-border bg-card px-1.5 text-[11px] text-foreground focus:outline-hidden [&_svg]:h-3 [&_svg]:w-3">
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
                  <SelectTrigger className="h-6 flex-1 gap-1 rounded-lg border border-border bg-card px-1.5 text-[11px] text-foreground focus:outline-hidden [&_svg]:h-3 [&_svg]:w-3">
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
        ),
      }}
    />
  );
}
