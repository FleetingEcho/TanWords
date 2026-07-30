import { Globe, Plus, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import type { BrowserTab } from "./useBrowserPanel";

/** Falls back through title → hostname → placeholder, so a tab is never
 *  nameless: a page that hasn't reported a title yet still reads as the site
 *  it's loading rather than as a blank chip. */
function tabLabel(tab: BrowserTab, fallback: string): string {
  if (tab.title) return tab.title;
  if (tab.url) {
    try {
      return new URL(tab.url).hostname.replace(/^www\./, "");
    } catch {
      return tab.url;
    }
  }
  return fallback;
}

export function BrowserTabStrip({
  tabs,
  activeKey,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: BrowserTab[];
  activeKey: string | undefined;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-2">
      {tabs.map((tab) => {
        const activeTab = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={activeTab}
            onClick={() => onSelect(tab.key)}
            onAuxClick={(e) => { if (e.button === 1) onClose(tab.key); }}
            title={tab.url || undefined}
            className={`group flex h-7 min-w-0 max-w-44 shrink-0 cursor-default select-none items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-xs transition-colors ${
              activeTab
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Globe
              className={`h-3 w-3 shrink-0 ${tab.loading ? "animate-pulse text-primary" : ""}`}
            />
            <span className="min-w-0 flex-1 truncate">{tabLabel(tab, t("browser.newTab"))}</span>
            {/* Always rendered, only revealed on hover/active — a slot that
              * appears on hover would resize the chip under the cursor. */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(tab.key); }}
              title={t("browser.closeTab")}
              aria-label={t("browser.closeTab")}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-foreground/10 ${
                activeTab ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60"
              }`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="icon"
        onClick={onNew}
        className="h-6 w-6 shrink-0 text-muted-foreground"
        title={t("browser.newTab")}
        aria-label={t("browser.newTab")}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
