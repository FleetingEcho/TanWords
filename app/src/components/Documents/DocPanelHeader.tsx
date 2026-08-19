import type React from "react";
import { Filter, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The header both document panels wear — the database list and the mounted
 *  folder's file tree.
 *
 *  Two rows, and the split between them is the point: the first says *which
 *  library you are in* (source tabs, refresh, library-wide actions), the second
 *  says *what you are doing inside it* (find, filter, create). Before this they
 *  were four rows across three alignment systems. The panel's own collapse
 *  control used to lead this row too; it now lives outside the panel as an
 *  edge-attached pull tab (see ListPanelEdgeHandle) so this header is only
 *  ever about what's inside the panel.
 *
 *  Shared rather than copied because these two panels have already drifted
 *  apart once (see listPanel.ts on their backgrounds), and the header is the
 *  part a reader compares side by side.
 */
export function DocPanelHeader({
  sourceTabs,
  actions,
  search,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  showFind = true,
  onNew,
  newLabel,
  filters,
}: {
  /** The database/local-folder switcher — see DocSourceTabs. Carries its own
   *  refresh button at its right edge, which is why it is given the row's
   *  free space rather than sized to its content. */
  sourceTabs?: React.ReactNode;
  /** Library-wide icon buttons — the attachment manager, the import/export
   *  menu. They belong beside the source tabs, not beside "new document". */
  actions?: React.ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  /** False drops the whole second row. The local panel with no folder mounted
   *  has nothing to search and nowhere to create — an empty field there is an
   *  offer the panel cannot honour. */
  showFind?: boolean;
  /** Omitted when there is nothing to create into — the local panel with no
   *  folder mounted. */
  onNew?: () => void;
  newLabel: string;
  /** The disclosure and its contents. `activeCount` drives the badge on the
   *  toggle, which is the only reason to notice the control at all when the
   *  filters are collapsed. */
  filters?: {
    open: boolean;
    onToggle: () => void;
    activeCount: number;
    label: string;
    content: React.ReactNode;
  };
}) {
  return (
    <div className="shrink-0 space-y-2 px-3 pb-2 pt-3">
      {/* Which library. */}
      <div className="flex items-center gap-1">
        {sourceTabs && <div className="flex min-w-0 flex-1 items-center">{sourceTabs}</div>}
        {actions}
      </div>

      {/* What you are doing inside it. Filtering rides inside the field it
        * filters rather than taking a row of its own below it. */}
      {showFind && (
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchAriaLabel}
            className={`h-7 w-full rounded-lg border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary/40 ${
              filters ? "pl-7 pr-8" : "pl-7 pr-2.5"
            }`}
          />
          {filters && (
            <button
              type="button"
              onClick={filters.onToggle}
              title={filters.label}
              aria-label={filters.label}
              aria-expanded={filters.open}
              className={`absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md transition-colors ${
                filters.open || filters.activeCount > 0
                  ? "text-primary hover:bg-primary/10"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Filter className="h-3 w-3" />
              {filters.activeCount > 0 && (
                // Sits on the corner rather than after the icon: inside a
                // 20px button there is no room for a number beside a glyph,
                // and the count is a notice, not a label.
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-bold leading-none text-primary-foreground">
                  {filters.activeCount}
                </span>
              )}
            </button>
          )}
        </div>
        {onNew && (
          <Button
            type="button"
            onClick={onNew}
            title={newLabel}
            aria-label={newLabel}
            // Outlined and tinted rather than a filled slab. Filled, this was
            // the loudest element on the screen for a control used a few times
            // a day, and it drowned out the document titles it sits above.
            className="h-7 w-7 shrink-0 rounded-lg border border-primary/40 bg-primary/10 p-0 text-primary shadow-none hover:bg-primary/20 hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      )}

      {showFind && filters?.open && filters.content}
    </div>
  );
}
