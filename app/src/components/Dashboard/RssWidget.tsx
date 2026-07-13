import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import { FeedIcon, PlayIcon } from "@/components/ui/icons";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";

const PREVIEW_COUNT = 3;

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
    (async () => {
      const [feedList, counts, entries] = await Promise.all([
        db.getRssFeeds(),
        db.getRssUnreadCounts(),
        db.getRssEntries(null, 30),
      ]);
      setFeeds(feedList);
      setUnread(counts.reduce((sum, [, n]) => sum + n, 0));
      const unreadEntries = entries.filter((e) => !e.is_read);
      setLatest((unreadEntries.length ? unreadEntries : entries).slice(0, PREVIEW_COUNT));
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return null;

  const podcastCount = feeds.filter((f) => f.is_podcast).length;
  const articleCount = feeds.length - podcastCount;
  const feedsById = new Map(feeds.map((f) => [f.id, f]));

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
          <FeedIcon className="w-3.5 h-3.5 text-muted-foreground" />
          {t("dash.rss.title")}
          {unread > 0 && (
            <span className="text-[10px] font-semibold tabular-nums rounded-full bg-primary/10 text-primary px-1.5 py-0.5">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </h2>
        <button
          onClick={() => navigate("feeds")}
          className="text-[11px] font-semibold text-primary hover:underline"
        >
          {t("dash.viewAll")}
        </button>
      </div>

      {feeds.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-xs text-muted-foreground">{t("dash.rss.empty")}</p>
          <button
            onClick={() => navigate("feeds")}
            className="mt-2.5 h-8 px-3.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("dash.rss.open")}
          </button>
        </div>
      ) : (
        <>
          <p className="px-4 pt-2.5 text-[11px] text-muted-foreground">
            {t("dash.rss.summary", { articles: articleCount, podcasts: podcastCount, unread })}
          </p>
          <div className="divide-y divide-border mt-1.5">
            {latest.map((e) => {
              const feed = feedsById.get(e.feed_id);
              return (
                <button
                  key={e.id}
                  onClick={() => navigate("feeds")}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
                >
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
                      {feed?.title || ""}
                    </span>
                  </span>
                  {!e.is_read && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                </button>
              );
            })}
            {latest.length === 0 && (
              <p className="px-4 py-4 text-xs text-muted-foreground">{t("feeds.noArticles")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
