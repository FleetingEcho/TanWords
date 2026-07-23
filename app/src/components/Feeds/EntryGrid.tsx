import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import type { RssFeed } from "@/hooks/useDB.types";
import { ChevronDownIcon, LoadMoreIcon } from "@/components/ui/icons";
import { EntryCard, EntryListRow, type DisplayEntry } from "./EntryCard";
import { dateGroupOf, titleTranslateKey, type DateGroup } from "./feedUtils";

export type FeedViewMode = "card" | "list";

interface Props {
  entries: DisplayEntry[];
  feedsById: Map<number, RssFeed>;
  /** Entry id currently being fetched for one-click learn, if any. */
  learningId: number | null;
  onOpen: (entry: DisplayEntry) => void;
  onLearn: (entry: DisplayEntry) => void;
  /** Podcast playback — only wired onto cards whose entry has an audio_url. */
  onPlay: (entry: DisplayEntry) => void;
  /** One-click "translate to Chinese" — omit to hide the translate button entirely. */
  onTranslate?: (entry: DisplayEntry) => void;
  /** Entry id currently being fetched for onTranslate, if any. */
  translatingId?: number | null;
  /** Queue for background analysis — omit to hide the button entirely. Several can
   *  run at once, so entries in flight are tracked as a set rather than a single id. */
  onAnalyzeBackground?: (entry: DisplayEntry) => void;
  analyzingBackgroundIds?: Set<number>;
  /** key (titleTranslateKey) -> Chinese title, shown under the English one when present. */
  titleTranslations?: Record<string, string>;
  /** "list" trades cover art and the hero layout for a dense one-line-per-entry view. */
  viewMode: FeedViewMode;
  /** False for sources with no real read-tracking (e.g. the live HN browser). Default true. */
  trackRead?: boolean;
  /** Fixed placeholder-cover background for entries with no cover image, overriding the usual per-feed hash gradient. */
  coverColor?: string;
  /** Fixed placeholder-cover letter, overriding the usual first-letter-of-feedTitle. */
  coverLetter?: string;
  /** Set (native HN browsing only) when the underlying source has more data beyond what's
   *  currently loaded — shows a "more" trigger on every expanded group's header, since
   *  there's one shared paginated list underneath rather than a per-group fetch. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

const GROUP_ORDER: DateGroup[] = ["today", "yesterday", "thisWeek", "earlier"];

function GroupHeader({
  label, count, collapsed, onToggle, showMore, loadingMore, onLoadMore, moreLabel, loadingLabel,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  showMore: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  moreLabel: string;
  loadingLabel: string;
}) {
  return (
    <div className="flex w-full items-center gap-3 pt-2">
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group/header flex shrink-0 items-center gap-1 text-left text-[11px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        {label}
        <span className="font-normal normal-case tracking-normal text-muted-foreground/70">({count})</span>
      </button>
      <div className="h-px flex-1 bg-border" />
      {showMore && !collapsed && (
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          title={loadingMore ? loadingLabel : moreLabel}
          aria-label={loadingMore ? loadingLabel : moreLabel}
          className="shrink-0 text-muted-foreground transition-colors hover:text-primary disabled:text-muted-foreground/50"
        >
          {loadingMore ? (
            <span className="block h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" />
          ) : (
            <LoadMoreIcon className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

/** Magazine flow: date-grouped sections; the very first entry renders as a hero card.
 *  In list mode, groups collapse into a dense one-line-per-entry list instead (no hero, no cover art). */
export function EntryGrid({ entries, feedsById, learningId, onOpen, onLearn, onPlay, onTranslate, translatingId = null, onAnalyzeBackground, analyzingBackgroundIds, titleTranslations, viewMode, trackRead = true, coverColor, coverLetter, hasMore = false, loadingMore = false, onLoadMore }: Props) {
  const t = useT();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<DateGroup>>(new Set());

  const toggleGroup = (g: DateGroup) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  const groups = new Map<DateGroup, DisplayEntry[]>();
  for (const e of entries) {
    const g = dateGroupOf(e.published);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(e);
  }

  const heroId = viewMode === "card" ? entries[0]?.id : undefined;
  const labels: Record<DateGroup, string> = {
    today: t("feeds.group.today"),
    yesterday: t("feeds.group.yesterday"),
    thisWeek: t("feeds.group.thisWeek"),
    earlier: t("feeds.group.earlier"),
  };

  return (
    <div className={`max-w-4xl mx-auto px-6 py-5 ${viewMode === "list" ? "space-y-2" : "space-y-4"}`}>
      {GROUP_ORDER.filter((g) => groups.has(g)).map((g) => {
        const items = groups.get(g)!;
        const hero = items.find((e) => e.id === heroId);
        const rest = items.filter((e) => e.id !== heroId);
        const collapsed = collapsedGroups.has(g);
        return (
          <section key={g} className={viewMode === "list" ? "space-y-0.5" : "space-y-3"}>
            <GroupHeader
              label={labels[g]}
              count={items.length}
              collapsed={collapsed}
              onToggle={() => toggleGroup(g)}
              showMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={onLoadMore}
              moreLabel={t("feeds.loadMore")}
              loadingLabel={t("feeds.loadingMore")}
            />
            {collapsed ? null : viewMode === "list" ? (
              rest.map((e) => (
                <EntryListRow
                  key={e.id}
                  entry={e}
                  feedTitle={feedsById.get(e.feed_id)?.title ?? ""}
                  learning={learningId === e.id}
                  onOpen={() => onOpen(e)}
                  onLearn={() => onLearn(e)}
                  onPlay={e.audio_url ? () => onPlay(e) : undefined}
                  onTranslate={onTranslate ? () => onTranslate(e) : undefined}
                  translating={translatingId === e.id}
                  onAnalyzeBackground={onAnalyzeBackground ? () => onAnalyzeBackground(e) : undefined}
                  analyzingBackground={analyzingBackgroundIds?.has(e.id) ?? false}
                  chineseTitle={titleTranslations?.[titleTranslateKey(e)]}
                  trackRead={trackRead}
                />
              ))
            ) : (
              <>
                {hero && (
                  <EntryCard
                    entry={hero}
                    feedTitle={feedsById.get(hero.feed_id)?.title ?? ""}
                    hero
                    learning={learningId === hero.id}
                    onOpen={() => onOpen(hero)}
                    onLearn={() => onLearn(hero)}
                    onPlay={hero.audio_url ? () => onPlay(hero) : undefined}
                    onTranslate={onTranslate ? () => onTranslate(hero) : undefined}
                    translating={translatingId === hero.id}
                    onAnalyzeBackground={onAnalyzeBackground ? () => onAnalyzeBackground(hero) : undefined}
                    analyzingBackground={analyzingBackgroundIds?.has(hero.id) ?? false}
                    chineseTitle={titleTranslations?.[titleTranslateKey(hero)]}
                    trackRead={trackRead}
                    coverColor={coverColor}
                    coverLetter={coverLetter}
                  />
                )}
                {rest.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {rest.map((e) => (
                      <EntryCard
                        key={e.id}
                        entry={e}
                        feedTitle={feedsById.get(e.feed_id)?.title ?? ""}
                        learning={learningId === e.id}
                        onOpen={() => onOpen(e)}
                        onLearn={() => onLearn(e)}
                        onPlay={e.audio_url ? () => onPlay(e) : undefined}
                        onTranslate={onTranslate ? () => onTranslate(e) : undefined}
                        translating={translatingId === e.id}
                        onAnalyzeBackground={onAnalyzeBackground ? () => onAnalyzeBackground(e) : undefined}
                        analyzingBackground={analyzingBackgroundIds?.has(e.id) ?? false}
                        chineseTitle={titleTranslations?.[titleTranslateKey(e)]}
                        trackRead={trackRead}
                        coverColor={coverColor}
                        coverLetter={coverLetter}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
