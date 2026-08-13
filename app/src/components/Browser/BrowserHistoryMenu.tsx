import { useState } from "react";
import { History, Trash2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { invoke } from "@/ipc/backend";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

function entryLabel(entry: HistoryEntry): string {
  if (entry.title) return entry.title;
  try {
    return new URL(entry.url).hostname.replace(/^www\./, "");
  } catch {
    return entry.url;
  }
}

/** History button + popover, shared by the full-page Browser and the
 *  floating mobile-browser widget — the underlying log is one shared,
 *  session-only list (see PanelSessionState.history in browserPanel.ts), so
 *  either surface's "clear" empties it for both. Fetched fresh each time the
 *  popover opens rather than kept live — this is a manually-triggered
 *  browsing aid, not something that needs to stay in sync while closed. */
export function BrowserHistoryMenu({
  onOpen,
  compact = false,
}: {
  onOpen: (url: string) => void;
  /** Smaller trigger button + tighter list, for the phone-sized widget. */
  compact?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void invoke<HistoryEntry[]>("browser_get_history").then(setEntries).catch(() => setEntries([]));
  };

  const clear = async () => {
    await invoke("browser_clear_history").catch(() => {});
    setEntries([]);
  };

  const select = (url: string) => {
    setOpen(false);
    onOpen(url);
  };

  const btnSize = compact ? "h-6 w-6" : "h-8 w-8";
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`${btnSize} text-muted-foreground`}
          title={t("browser.history")}
          aria-label={t("browser.history")}
        >
          <History className={iconSize} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={compact ? "w-56 p-2" : "w-80 p-2"}>
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-xs font-semibold text-foreground">{t("browser.history")}</span>
          {entries.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => void clear()}
              className="h-6 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              {t("browser.clearHistory")}
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {entries.length === 0 && (
            <p className="px-1 py-3 text-xs text-muted-foreground">{t("browser.historyEmpty")}</p>
          )}
          {entries.map((entry) => (
            <button
              key={`${entry.url}-${entry.visitedAt}`}
              type="button"
              onClick={() => select(entry.url)}
              title={entry.url}
              className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
            >
              <span className="w-full truncate text-xs text-foreground">{entryLabel(entry)}</span>
              <span className="w-full truncate text-[10px] text-muted-foreground">{entry.url}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
