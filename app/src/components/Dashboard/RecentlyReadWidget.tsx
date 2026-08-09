import React, { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { useFeedsNavStore } from "@/store/feedsNavStore";
import { getRecentlyRead, type RecentlyReadItem } from "@/lib/recentlyRead";
import { PlayIcon, FeedIcon } from "@/components/ui/icons";
import { DashboardCard, DashboardRow, DashboardEmpty, DashboardFill, DASHBOARD_BODY_ROWS } from "./DashboardCard";

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
export function RecentlyReadWidget({ maxRows = DASHBOARD_BODY_ROWS }: { maxRows?: number }) {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);
  // localStorage is synchronous, so use it for the first render instead of
  // briefly painting an empty card and filling it from a passive effect.
  const [items, setItems] = useState<RecentlyReadItem[]>(() => getRecentlyRead().slice(0, maxRows));

  useEffect(() => {
    setItems(getRecentlyRead().slice(0, maxRows));
  }, [maxRows]);

  const openItem = (item: RecentlyReadItem) => {
    useFeedsNavStore.getState().setBrowse(item);
    navigate("feeds");
  };

  return (
    <DashboardCard
      title={t("dash.recentlyRead.title")}
      icon={<History className="w-3.5 h-3.5 text-muted-foreground" />}
      onViewAll={() => navigate("feeds")}
    >
      {items.length === 0 ? (
        <DashboardEmpty>{t("dash.empty.recentlyRead")}</DashboardEmpty>
      ) : (
        <>
        {items.map((item) => (
          <DashboardRow key={item.url} onClick={() => openItem(item)}>
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
          </DashboardRow>
        ))}
        <DashboardFill />
        </>
      )}
    </DashboardCard>
  );
}
