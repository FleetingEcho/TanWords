import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import { FeedIcon, PlayIcon } from "@/components/ui/icons";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";
import { Button } from "@/components/ui/button";
import { DashboardCard, DashboardRow, DashboardSkeleton, DashboardFillRows, DASHBOARD_BODY_ROWS } from "./DashboardCard";

/** Dashboard card: feed subscriptions at a glance — source/unread totals and
 * the latest unread entries — with the Feeds page as its click-through. */
export function RssWidget() {
  const t = useT();
  const db = useDB();
  const navigate = useNavStore((s) => s.navigate);

  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<RssEntryRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [feedList, counts, entries] = await Promise.all([
        db.getRssFeeds(),
        db.getRssUnreadCounts(),
        db.getRssEntries(null, 30),
      ]);
      if (!alive) return;
      setFeeds(feedList);
      setUnread(counts.reduce((sum, [, n]) => sum + n, 0));
      const unreadEntries = entries.filter((e) => !e.is_read);
      setLatest((unreadEntries.length ? unreadEntries : entries).slice(0, DASHBOARD_BODY_ROWS));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  const podcastCount = feeds.filter((f) => f.is_podcast).length;
  const articleCount = feeds.length - podcastCount;
  const feedsById = new Map(feeds.map((f) => [f.id, f]));

  return (
    <DashboardCard
      title={t("dash.rss.title")}
      icon={<FeedIcon className="w-3.5 h-3.5 text-muted-foreground" />}
      badge={
        unread > 0 ? (
          <span className="text-[10px] font-semibold tabular-nums rounded-full bg-primary/10 text-primary px-1.5 py-0.5">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : undefined
      }
      // In the header rather than as a body row: it used to eat ~24px of list
      // space, which is why this card fitted one fewer entry than its
      // neighbours.
      meta={loaded && feeds.length > 0
        ? t("dash.rss.summary", { articles: articleCount, podcasts: podcastCount, unread })
        : undefined}
      onViewAll={() => navigate("feeds")}
    >
      {!loaded ? (
        <DashboardSkeleton />
      ) : feeds.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-2.5 px-6 text-center">
          <p className="text-xs text-muted-foreground">{t("dash.rss.empty")}</p>
          <Button
            onClick={() => navigate("feeds")}
            className="h-8 px-3.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("dash.rss.open")}
          </Button>
        </div>
      ) : latest.length === 0 ? (
        <div className="h-full flex items-center justify-center px-6 text-center">
          <p className="text-xs text-muted-foreground">{t("feeds.noArticles")}</p>
        </div>
      ) : (
        <>
        {latest.map((e) => (
          <DashboardRow key={e.id} onClick={() => navigate("feeds")}>
            {e.audio_url ? (
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <PlayIcon className="w-2.5 h-2.5" />
              </span>
            ) : (
              <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                <FeedIcon className="w-2.5 h-2.5" />
              </span>
            )}
            <span className="flex-1 min-w-0">
              <span className={`block text-xs truncate ${e.is_read ? "text-muted-foreground" : "font-medium text-foreground"}`}>
                {e.title}
              </span>
              <span className="block text-[10px] text-muted-foreground truncate">
                {feedsById.get(e.feed_id)?.title || ""}
              </span>
            </span>
            {!e.is_read && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
          </DashboardRow>
        ))}
        <DashboardFillRows count={DASHBOARD_BODY_ROWS - latest.length} />
        </>
      )}
    </DashboardCard>
  );
}
