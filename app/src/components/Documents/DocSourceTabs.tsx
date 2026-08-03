import { RefreshCw } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

export type DocSource = "db" | "local";

/** Which library you are browsing — the database or a mounted folder — plus a
 *  refresh for whichever one that is.
 *
 *  Sized and placed to live in the document list's own header rather than in a
 *  bar of its own. A full-width row for two short pills left the other 90% of
 *  the line empty, and the refresh button stranded at the far right of the
 *  window had nothing to do with anything near it. Both belong to the list:
 *  the tabs choose which list, refresh reloads the one showing, and the list's
 *  header row was already half empty.
 */
export function DocSourceTabs({
  source, onSelect, refreshing, onRefresh,
}: {
  source: DocSource;
  onSelect: (source: DocSource) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useT();

  return (
    // Its own row inside the list header, not squeezed in beside the actions:
    // two pills, a chevron and a "New Doc" button on one panel-width line read
    // as clutter. Refresh sits at the far end of this row so the pair reads as
    // "this list, and reload it".
    <div className="flex w-full min-w-0 items-center justify-between gap-1">
      <div className="flex min-w-0 items-center gap-0.5">
        {(["db", "local"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            onClick={() => onSelect(value)}
            aria-pressed={source === value}
            className={`h-6 shrink-0 rounded-md px-2 text-[11px] font-semibold transition-colors ${
              source === value
                ? "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {value === "db" ? t("doc.tabDatabase") : t("doc.tabLocal")}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        disabled={refreshing}
        title={t("doc.refreshDocuments")}
        aria-label={t("doc.refreshDocuments")}
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
