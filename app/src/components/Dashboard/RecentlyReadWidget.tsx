import React, { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { useFeedsNavStore } from "@/store/feedsNavStore";
import { getRecentlyRead, type RecentlyReadItem } from "@/lib/recentlyRead";
import { PlayIcon, FeedIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

const PREVIEW_COUNT = 5;

function formatTimeAgo(t: (key: string, vars?: Record<string, string | number>) => string, ts: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return t("feeds.recentlyRead.justNow");
  if (minutes < 60) return t("feeds.recentlyRead.minutesAgo", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("feeds.recentlyRead.hoursAgo", { n: hours });
  const days = Math.round(hours / 24);
  return t("feeds.recentlyRead.daysAgo", { n: days });
}

/** Dashboard card: the last few articles opened in the RSS reader (lib/recentlyRead,
 *  the same localStorage-backed list behind Feeds' history dropdown) — clicking one
 *  jumps to Feeds and reopens it in-app via feedsNavStore's browse state. */
export function RecentlyReadWidget() {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);
  const [items, setItems] = useState<RecentlyReadItem[]>([]);

  useEffect(() => {
    setItems(getRecentlyRead().slice(0, PREVIEW_COUNT));
  }, []);

  const openItem = (item: RecentlyReadItem) => {
    useFeedsNavStore.getState().setBrowse(item);
    navigate("feeds");
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          {t("dash.recentlyRead.title")}
        </h2>
        <Button
          variant="link"
          onClick={() => navigate("feeds")}
          className="h-auto p-0 text-[11px] font-semibold text-primary hover:underline"
        >
          {t("dash.viewAll")}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground leading-relaxed">{t("dash.empty.recentlyRead")}</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => (
            <Button
              key={item.url}
              variant="ghost"
              onClick={() => openItem(item)}
              className="h-auto w-full rounded-none flex items-center justify-start gap-2.5 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
            >
              {item.audioUrl ? (
                <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <PlayIcon className="w-2.5 h-2.5" />
                </span>
              ) : (
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                  <FeedIcon className="w-2.5 h-2.5" />
                </span>
              )}
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-medium text-foreground truncate">{item.title}</span>
                <span className="block text-[10px] text-muted-foreground truncate">
                  {item.feedTitle || item.domain}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatTimeAgo(t, item.readAt)}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
