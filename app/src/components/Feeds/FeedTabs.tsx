import React, { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { CloseIcon, RefreshIcon, GridIcon, ListIcon } from "@/components/ui/icons";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { RssFeed } from "@/hooks/useDB.types";
import type { RssTabSelection } from "@/store/settingsStore";
import type { FeedViewMode } from "./EntryGrid";
import { domainOf } from "./feedUtils";
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
}

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="shrink-0 text-[10px] font-semibold tabular-nums rounded-full bg-primary/10 text-primary px-1.5 py-0.5 min-w-[1.25rem] text-center">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Single-row switcher: pinned feeds stay visible; the full categorized library lives in More. */
export function FeedTabs({ feeds, unreadByFeed, failedFeeds, selected, syncing, onSelect, onDelete, onPreferences, onAdd, onRefresh, viewMode, onSetViewMode }: Props) {
  const t = useT();
  const totalUnread = [...unreadByFeed.values()].reduce((a, b) => a + b, 0);
  const [pendingDelete, setPendingDelete] = useState<RssFeed | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [moreOpen]);

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

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <button onClick={() => onSelect("all")} className={pill(selected === "all")}>
          {t("feeds.all")}
          <UnreadBadge n={totalUnread} />
        </button>

        <button onClick={() => onSelect("hackernews")} className={pill(selected === "hackernews")}>
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-orange-500 text-[9px] font-bold leading-none text-white">Y</span>
          {t("hn.tab")}
        </button>

        {visibleFeeds.map((f) => {
          const active = selected === f.id;
          return (
            <button key={f.id} onClick={() => onSelect(f.id)} className={`${pill(active)} group min-w-0`} title={domainOf(f.url)}>
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

      <div className="flex h-8 shrink-0 items-center gap-2">
        {feeds.length > 0 && (
          <div ref={moreRef} className="relative shrink-0">
            <button onClick={() => setMoreOpen((v) => !v)} className={pill(moreOpen)} aria-expanded={moreOpen}>
              {t("feeds.more")} {hiddenCount > 0 ? hiddenCount : ""} <span aria-hidden>▾</span>
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                <div className="border-b border-border p-3">
                  <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("feeds.searchFeeds")} className="h-8 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring" />
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
              </div>
            )}
          </div>
        )}
        {syncing && <span className="text-[11px] text-muted-foreground">{t("feeds.refreshing")}</span>}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <Button
            variant="ghost"
            onClick={() => onSetViewMode("card")}
            title={t("feeds.viewCard")}
            aria-label={t("feeds.viewCard")}
            aria-pressed={viewMode === "card"}
            className={`flex h-6 w-6 items-center justify-center rounded-md p-0 transition-colors hover:bg-transparent ${
              viewMode === "card" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
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
              viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ListIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <button onClick={onAdd} className="flex h-8 items-center rounded-full border border-dashed border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
          + {t("feeds.addFeed")}
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
