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
    // Shares the header's first row with the collapse chevron and the
    // library-wide actions (see DocPanelHeader). `justify-between` is what puts
    // refresh at the far end of that row, next to those actions, so the icons
    // read as one cluster instead of one stranded glyph.
    <div className="flex w-full min-w-0 items-center justify-between gap-1">
      <div className="flex min-w-0 items-center gap-2">
        {(["db", "local"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            onClick={() => onSelect(value)}
            aria-pressed={source === value}
            // Underlined rather than a filled pill. Two filled pills sat at the
            // same weight as the primary action below them and read as three
            // competing buttons; a rule under the live one says "you are here"
            // without adding a third filled shape to a 320px column.
            className={`relative h-6 shrink-0 rounded-none px-0.5 text-[11px] font-semibold transition-colors after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:transition-colors hover:bg-transparent ${
              source === value
                ? "text-foreground after:bg-primary hover:text-foreground"
                : "text-muted-foreground after:bg-transparent hover:text-foreground"
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
