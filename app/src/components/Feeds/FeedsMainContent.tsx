import React from "react";
import { useT } from "@/hooks/useT";
import { ReaderView } from "@/components/Reader/ReaderView";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";
import type { RssTabSelection } from "@/store/settingsStore";
import { EntryGrid, type FeedViewMode } from "./EntryGrid";
import { HackerNewsSection } from "./HackerNewsSection";
import { EntrySkeleton } from "./EntrySkeleton";
import { Button } from "@/components/ui/button";

export interface BrowseTarget {
  url: string;
  title: string;
  domain: string;
  /** Set for podcast entries — the reader's listen button plays this instead of TTS. */
  audioUrl: string | null;
  feedTitle: string;
  /** Set for entries from hnrss.org-style feeds — shows HN comments below the article. */
  hnItemId: number | null;
}

interface Props {
  browse: BrowseTarget | null;
  onCloseBrowse: () => void;
  onOpenExternal: (url: string) => void;

  selected: RssTabSelection;
  feedsViewMode: FeedViewMode;
  booting: boolean;
  syncing: boolean;
  feeds: RssFeed[];
  entries: RssEntryRow[];
  feedsById: Map<number, RssFeed>;

  learningId: number | null;
  translatingId: number | null;
  analyzingBackgroundIds: Set<number>;
  showTitleTranslations: boolean;
  titleTranslations: Record<string, string> | undefined;

  onOpenEntry: (entry: RssEntryRow) => void;
  onLearnEntry: (entry: RssEntryRow) => void;
  onPlayEntry: (entry: RssEntryRow) => void;
  onTranslateEntry: (entry: RssEntryRow) => void;
  onAnalyzeBackground: (entry: RssEntryRow) => void;
  onShowAdd: () => void;
}

/** The page's main viewport: the in-app reader when an entry is open, the native
 *  Hacker News browser when that tab is selected, or the regular RSS entry grid
 *  (with its own boot/empty states) otherwise. */
export function FeedsMainContent({
  browse,
  onCloseBrowse,
  onOpenExternal,
  selected,
  feedsViewMode,
  booting,
  syncing,
  feeds,
  entries,
  feedsById,
  learningId,
  translatingId,
  analyzingBackgroundIds,
  showTitleTranslations,
  titleTranslations,
  onOpenEntry,
  onLearnEntry,
  onPlayEntry,
  onTranslateEntry,
  onAnalyzeBackground,
  onShowAdd,
}: Props) {
  const t = useT();

  if (browse) {
    return (
      <ReaderView
        url={browse.url}
        title={browse.title}
        domain={browse.domain}
        audio={
          browse.audioUrl
            ? { audioUrl: browse.audioUrl, title: browse.title, feedTitle: browse.feedTitle }
            : undefined
        }
        onBack={onCloseBrowse}
        onOpenExternal={() => onOpenExternal(browse.url)}
        hnItemId={browse.hnItemId}
      />
    );
  }

  if (selected === "hackernews") {
    return (
      <HackerNewsSection
        viewMode={feedsViewMode}
        learningId={learningId}
        onOpen={onOpenEntry}
        onLearn={onLearnEntry}
        onTranslate={onTranslateEntry}
        translatingId={translatingId}
        onAnalyzeBackground={onAnalyzeBackground}
        analyzingBackgroundIds={analyzingBackgroundIds}
        showTitleTranslations={showTitleTranslations}
        titleTranslations={titleTranslations}
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {booting && entries.length === 0 ? (
        <EntrySkeleton />
      ) : feeds.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
          <p className="text-sm text-muted-foreground max-w-sm">{t("feeds.noFeeds")}</p>
          <Button
            onClick={onShowAdd}
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + {t("feeds.addFeed")}
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {syncing ? t("feeds.refreshing") : t("feeds.noArticles")}
          </p>
        </div>
      ) : (
        <EntryGrid
          entries={entries}
          feedsById={feedsById}
          learningId={learningId}
          onOpen={onOpenEntry}
          onLearn={onLearnEntry}
          onPlay={onPlayEntry}
          onTranslate={onTranslateEntry}
          translatingId={translatingId}
          onAnalyzeBackground={onAnalyzeBackground}
          analyzingBackgroundIds={analyzingBackgroundIds}
          titleTranslations={titleTranslations}
          viewMode={feedsViewMode}
        />
      )}
    </div>
  );
}
