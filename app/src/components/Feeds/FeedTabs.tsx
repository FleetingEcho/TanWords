import React, { useMemo, useState } from "react";
import { History, Plus } from "lucide-react";
import { useT } from "@/hooks/useT";
import { CloseIcon, RefreshIcon, GridIcon, ListIcon, TranslateIcon, BookmarkIcon } from "@/components/ui/icons";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RssFeed, FeedBookmark } from "@/hooks/useDB.types";
import type { RssTabSelection } from "@/store/settingsStore";
import type { FeedViewMode } from "./EntryGrid";
import { domainOf } from "./feedUtils";
import { useTitleTranslateStore } from "@/store/titleTranslateStore";
import type { RecentlyReadItem } from "@/lib/recentlyRead";
import { Button } from "@/components/ui/button";

interface Props {
  feeds: RssFeed[];
  unreadByFeed: Map<number, number>;
  /** Feed ids whose last background sync failed. */
  failedFeeds: Set<number>;
  selected: RssTabSelection;
  syncing: boolean;
  onSelect: (id: RssTabSelection) => void;
  onDelete: (id: number) => void;
  onPreferences: (id: number, category: "article" | "podcast" | null, isPinned: boolean) => Promise<void>;
  onAdd: () => void;
  onRefresh: () => void;
  viewMode: FeedViewMode;
  onSetViewMode: (mode: FeedViewMode) => void;
  /** One-click "translate every visible title to Chinese" — shows a Chinese line
   *  under each English title (current tab/section only) instead of navigating
   *  anywhere. Persists across tab switches so it stays on until toggled off. */
  showTitleTranslations: boolean;
  onToggleTitleTranslations: () => void;
  /** Recently-opened articles (localStorage-backed, see lib/recentlyRead) shown
   *  in a quick-jump dropdown so the user can get back to something they read
   *  a few tabs/feeds ago without hunting through the entry list again. */
  recentlyRead: RecentlyReadItem[];
  onOpenRecent: (item: RecentlyReadItem) => void;
  onClearRecentlyRead: () => void;
  onRemoveRecent: (url: string) => void;
  bookmarks: FeedBookmark[];
  onOpenBookmark: (bookmark: FeedBookmark) => void;
  onRemoveBookmark: (url: string) => void;
  bookmarkPendingUrls: Set<string>;
}

function formatTimeAgo(t: (key: string, vars?: Record<string, string | number>) => string, ts: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return t("feeds.recentlyRead.justNow");
  if (minutes < 60) return t("feeds.recentlyRead.minutesAgo", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("feeds.recentlyRead.hoursAgo", { n: hours });
  const days = Math.round(hours / 24);
  return t("feeds.recentlyRead.daysAgo", { n: days });
}

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="shrink-0 text-[10px] font-semibold tabular-nums rounded-full bg-primary/10 text-primary px-1.5 py-0.5 min-w-5 text-center">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Single-row switcher: pinned feeds stay visible; the full categorized library lives in More. */
export function FeedTabs({ feeds, unreadByFeed, failedFeeds, selected, syncing, onSelect, onDelete, onPreferences, onAdd, onRefresh, viewMode, onSetViewMode, showTitleTranslations, onToggleTitleTranslations, recentlyRead, onOpenRecent, onClearRecentlyRead, onRemoveRecent, bookmarks, onOpenBookmark, onRemoveBookmark, bookmarkPendingUrls }: Props) {
  const t = useT();
  const totalUnread = [...unreadByFeed.values()].reduce((a, b) => a + b, 0);
  const translatingTitles = useTitleTranslateStore((s) => s.pending.size > 0);
  const [pendingDelete, setPendingDelete] = useState<RssFeed | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  const visibleFeeds = useMemo(() => {
    const pinned = feeds.filter((f) => f.is_pinned).slice(0, 5);
    if (selected === "all" || pinned.some((f) => f.id === selected)) return pinned;
    const current = feeds.find((f) => f.id === selected);
    return current ? [...pinned, current] : pinned;
  }, [feeds, selected]);
  const hiddenCount = feeds.filter((f) => !visibleFeeds.some((v) => v.id === f.id)).length;
  const normalizedQuery = query.trim().toLowerCase();
  const matchingFeeds = feeds.filter((f) =>
    !normalizedQuery || `${f.title} ${domainOf(f.url)}`.toLowerCase().includes(normalizedQuery)
  );

  const savePreferences = async (feed: RssFeed, category: "article" | "podcast" | null, pinned: boolean) => {
    setSavingId(feed.id);
    try { await onPreferences(feed.id, category, pinned); }
    finally { setSavingId(null); }
  };

  const pill = (active: boolean) =>
    `flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
      active
        ? "border-primary/40 bg-primary/10 font-semibold text-primary"
        : "border-border font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  const scrollTabsHorizontally = (event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const scroller = event.currentTarget;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  return (
    // relative z-20: backdrop-blur-sm creates a stacking context, and without a
    // z-index the content bars below (e.g. HackerNewsSection's blurred toolbar)
    // paint over the More / Recently-read dropdowns.
    <div className="relative z-20 flex shrink-0 items-center gap-3 border-b border-border bg-transparent backdrop-blur-xl px-4 py-2.5">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className="rss-tabs-scroll -mb-3 flex items-center gap-1.5 overflow-x-auto pb-3"
          onWheel={scrollTabsHorizontally}
        >
        <button onClick={() => onSelect("all")} className={`${pill(selected === "all")} shrink-0`}>
          {t("feeds.all")}
          <UnreadBadge n={totalUnread} />
        </button>

        <button onClick={() => onSelect("hackernews")} className={`${pill(selected === "hackernews")} shrink-0`}>
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-orange-500 text-[9px] font-bold leading-none text-white">Y</span>
          {t("hn.tab")}
        </button>

        {visibleFeeds.map((f) => {
          const active = selected === f.id;
          return (
            <button key={f.id} onClick={() => onSelect(f.id)} className={`${pill(active)} group shrink-0`} title={domainOf(f.url)}>
              {f.is_podcast && <span className="shrink-0 text-[10px] leading-none" aria-label={t("feeds.section.podcasts")}>🎧</span>}
              <span className="min-w-0 max-w-44 truncate">{f.title || domainOf(f.url)}</span>
              {failedFeeds.has(f.id) && (
                <span title={t("feeds.syncFailed")} aria-label={t("feeds.syncFailed")} className="shrink-0 text-xs leading-none text-amber-500">⚠</span>
              )}
              {/* Fixed-width slot: the badge keeps its space when hovered
                  (invisible, not hidden) and the delete × overlays it, so
                  the pill never changes width. */}
              <span className="relative flex h-4 min-w-4 shrink-0 items-center justify-center">
                <span className="group-hover:invisible">
                  <UnreadBadge n={unreadByFeed.get(f.id) ?? 0} />
                </span>
                <span
                  role="button"
                  aria-label={t("feeds.deleteFeed")}
                  title={t("feeds.deleteFeed")}
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(f); }}
                  className="absolute inset-0 hidden items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive group-hover:flex"
                >
                  <CloseIcon className="h-2.5 w-2.5" />
                </span>
              </span>
            </button>
          );
        })}

        </div>
      </div>

      <div className="rss-tabs-scroll -mb-1 flex h-8 max-w-[min(70vw,480px)] shrink-0 items-center gap-2 overflow-x-auto pb-1">
        {feeds.length > 0 && (
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button className={pill(moreOpen)} aria-expanded={moreOpen}>
                {t("feeds.more")} {hiddenCount > 0 ? hiddenCount : ""} <span aria-hidden>▾</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0 overflow-hidden rounded-xl border-border bg-card shadow-xl">
                <div className="border-b border-border p-3">
                  <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("feeds.searchFeeds")} className="h-8 w-full rounded-lg border border-input bg-background px-3 text-xs outline-hidden focus:ring-1 focus:ring-ring" />
                </div>
                <div className="max-h-96 overflow-y-auto p-2">
                  {(["article", "podcast"] as const).map((category) => {
                    const group = matchingFeeds.filter((f) => f.category === category);
                    if (group.length === 0) return null;
                    return (
                      <section key={category} className="mb-2 last:mb-0">
                        <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <span>{t(category === "article" ? "feeds.section.articles" : "feeds.section.podcasts")}</span><span>{group.length}</span>
                        </div>
                        {group.map((f) => (
                          <div key={f.id} className={`group flex items-center gap-1 rounded-lg px-1 py-0.5 ${selected === f.id ? "bg-primary/10" : "hover:bg-muted"}`}>
                            <button onClick={() => { onSelect(f.id); setMoreOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
                              <span className="truncate text-xs font-medium">{f.title || domainOf(f.url)}</span><UnreadBadge n={unreadByFeed.get(f.id) ?? 0} />
                            </button>
                            <button disabled={savingId === f.id} onClick={() => savePreferences(f, f.category_override, !f.is_pinned)} title={t(f.is_pinned ? "feeds.unpin" : "feeds.pin")} className={`h-7 w-7 rounded-md text-sm hover:bg-background ${f.is_pinned ? "text-amber-500" : "text-muted-foreground"}`}>
                              {f.is_pinned ? "★" : "☆"}
                            </button>
                            <button disabled={savingId === f.id} onClick={() => savePreferences(f, f.category === "article" ? "podcast" : "article", f.is_pinned)} title={t("feeds.changeCategory")} className="h-7 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground">
                              {f.category === "podcast" ? "🎧" : "A"}
                            </button>
                            <button onClick={() => setPendingDelete(f)} title={t("feeds.deleteFeed")} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
                              <CloseIcon className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </section>
                    );
                  })}
                  {matchingFeeds.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("feeds.noFeedResults")}</p>}
                </div>
            </PopoverContent>
          </Popover>
        )}
        {syncing && <span className="text-[11px] text-muted-foreground">{t("feeds.refreshing")}</span>}
        <Popover open={bookmarkOpen} onOpenChange={setBookmarkOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              title={t("feeds.bookmarks.title")}
              aria-label={t("feeds.bookmarks.title")}
              aria-pressed={bookmarkOpen}
              className={`relative flex h-7 w-7 items-center justify-center rounded-md p-0 transition-colors ${
                bookmarkOpen || bookmarks.length > 0
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <BookmarkIcon filled={bookmarks.length > 0 || bookmarkOpen} className="h-4 w-4" />
              {bookmarks.length > 0 && (
                <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0 overflow-hidden rounded-xl border-border bg-card shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold">{t("feeds.bookmarks.title")}</span>
                <span className="text-[10px] text-muted-foreground">{bookmarks.length}</span>
              </div>
              <div className="max-h-96 overflow-y-auto p-1.5">
                {bookmarks.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("feeds.bookmarks.empty")}</p>
                ) : (
                  bookmarks.map((bookmark) => (
                    <div key={bookmark.url} className="group relative flex items-center rounded-lg hover:bg-muted">
                      <button
                        onClick={() => { onOpenBookmark(bookmark); setBookmarkOpen(false); }}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-2 text-left"
                      >
                        <span className="w-full truncate pr-5 text-xs font-medium text-foreground">{bookmark.title}</span>
                        <span className="flex w-full items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="truncate">{bookmark.feed_title || bookmark.domain}</span>
                          {bookmark.created_at && (
                            <>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">{formatTimeAgo(t, new Date(bookmark.created_at).getTime())}</span>
                            </>
                          )}
                        </span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveBookmark(bookmark.url); }}
                        disabled={bookmarkPendingUrls.has(bookmark.url)}
                        title={t("feeds.unbookmark")}
                        aria-label={t("feeds.unbookmark")}
                        className="absolute right-1.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive group-hover:flex"
                      >
                        {bookmarkPendingUrls.has(bookmark.url) ? (
                          <span className="h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
                        ) : (
                          <CloseIcon className="h-2.5 w-2.5" />
                        )}
                      </button>
                    </div>
                  ))
                )}
              </div>
          </PopoverContent>
        </Popover>
        <Popover open={recentOpen} onOpenChange={setRecentOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              title={t("feeds.recentlyRead.button")}
              aria-label={t("feeds.recentlyRead.button")}
              aria-pressed={recentOpen}
              className={`flex h-7 w-7 items-center justify-center rounded-md p-0 transition-colors ${
                recentOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <History className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0 overflow-hidden rounded-xl border-border bg-card shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold">{t("feeds.recentlyRead.title")}</span>
                {recentlyRead.length > 0 && (
                  <button onClick={onClearRecentlyRead} className="text-[11px] text-muted-foreground hover:text-foreground">
                    {t("feeds.recentlyRead.clear")}
                  </button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto p-1.5">
                {recentlyRead.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("feeds.recentlyRead.empty")}</p>
                ) : (
                  recentlyRead.map((item) => (
                    <div key={item.url} className="group relative flex items-center rounded-lg hover:bg-muted">
                      <button
                        onClick={() => { onOpenRecent(item); setRecentOpen(false); }}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-2 text-left"
                      >
                        <span className="w-full truncate pr-5 text-xs font-medium text-foreground">{item.title}</span>
                        <span className="flex w-full items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="truncate">{item.feedTitle || item.domain}</span>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0">{formatTimeAgo(t, item.readAt)}</span>
                        </span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveRecent(item.url); }}
                        title={t("feeds.recentlyRead.remove")}
                        aria-label={t("feeds.recentlyRead.remove")}
                        className="absolute right-1.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive group-hover:flex"
                      >
                        <CloseIcon className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          onClick={onToggleTitleTranslations}
          title={t("feeds.translateTitles")}
          aria-label={t("feeds.translateTitles")}
          aria-pressed={showTitleTranslations}
          className={`flex h-7 w-7 items-center justify-center rounded-md p-0 transition-colors ${
            showTitleTranslations ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {showTitleTranslations && translatingTitles ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <TranslateIcon className="h-4 w-4" />
          )}
        </Button>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <Button
            variant="ghost"
            onClick={() => onSetViewMode("card")}
            title={t("feeds.viewCard")}
            aria-label={t("feeds.viewCard")}
            aria-pressed={viewMode === "card"}
            className={`flex h-6 w-6 items-center justify-center rounded-md p-0 transition-colors hover:bg-transparent ${
              viewMode === "card" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <GridIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => onSetViewMode("list")}
            title={t("feeds.viewList")}
            aria-label={t("feeds.viewList")}
            aria-pressed={viewMode === "list"}
            className={`flex h-6 w-6 items-center justify-center rounded-md p-0 transition-colors hover:bg-transparent ${
              viewMode === "list" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ListIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <button onClick={onAdd} className="flex h-8 w-8 lg:w-auto items-center justify-center lg:justify-start rounded-full border border-dashed border-border px-0 lg:px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
          <span className="lg:hidden"><Plus className="h-4 w-4" /></span>
          <span className="hidden lg:inline">+ {t("feeds.addFeed")}</span>
        </button>
        <Button
          variant="ghost"
          onClick={onRefresh}
          disabled={syncing || feeds.length === 0}
          title={t("feeds.refresh")}
          className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RefreshIcon className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("feeds.deleteFeed")}
        message={t("feeds.confirmDelete", { name: pendingDelete?.title || domainOf(pendingDelete?.url ?? "") })}
        confirmLabel={t("feeds.deleteFeed")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
