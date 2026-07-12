import React from "react";
import { useT } from "@/hooks/useT";
import { HNStory, storyDomain } from "@/hooks/useHackerNews";
import { ExternalIcon, SearchIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";

interface Props {
  stories: HNStory[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: boolean;
  searching: boolean;
  readMap: Record<number, number>;
  savedMap: Record<number, number>;
  timeAgo: (unixSeconds: number) => string;
  sentinelRef: React.RefObject<HTMLDivElement>;
  onOpenArticle: (story: HNStory) => void;
  onOpenComments: (story: HNStory) => void;
  onOpenExternal: (story: HNStory) => void;
  onLearn: (story: HNStory) => void;
  onRetry: () => void;
}

/** The story ledger card: skeleton / error / empty states, rows, and the infinite-scroll footer. */
export function StoryList({
  stories, loading, loadingMore, hasMore, error, searching,
  readMap, savedMap, timeAgo, sentinelRef,
  onOpenArticle, onOpenComments, onOpenExternal, onLearn, onRetry,
}: Props) {
  const t = useT();

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {error && !loading ? (
        <div className="py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">{t("hn.error")}</p>
          {!searching && (
            <button
              onClick={onRetry}
              className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("hn.retry")}
            </button>
          )}
        </div>
      ) : loading && stories.length === 0 ? (
        <div className="divide-y divide-border">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-5 py-4">
              <div className="w-7 shrink-0 flex justify-end">
                <Skeleton className="h-4 w-5" />
              </div>
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                <Skeleton className="h-3 w-48 bg-muted/70" />
              </div>
            </div>
          ))}
        </div>
      ) : searching && stories.length === 0 ? (
        <div className="py-16 flex flex-col items-center gap-2">
          <SearchIcon className="w-6 h-6 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t("hn.search.none")}</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {stories.map((story, i) => {
            const isRead = !!readMap[story.id];
            const isSaved = !!savedMap[story.id];
            return (
              <div
                key={story.id}
                className="group flex gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors"
              >
                <span className="w-7 shrink-0 pt-0.5 text-right font-mono tabular-nums text-sm text-muted-foreground/50 group-hover:text-orange-500 transition-colors select-none">
                  {String(i + 1).padStart(2, "0")}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <button
                      onClick={() => onOpenArticle(story)}
                      className={`text-sm font-medium leading-snug text-left hover:text-orange-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm ${
                        isRead ? "text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {story.title}
                    </button>
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0 mt-0.5">
                      {storyDomain(story)}
                    </span>
                    {isSaved && (
                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
                        {t("hn.saved")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] font-mono tabular-nums text-muted-foreground">
                    <span>
                      <span className="text-orange-500">▲</span> {story.score}
                    </span>
                    <button
                      onClick={() => onOpenComments(story)}
                      className="hover:text-foreground hover:underline transition-colors"
                    >
                      {t("hn.comments", { n: story.descendants })}
                    </button>
                    <span>{timeAgo(story.time)}</span>
                    <span className="truncate">{story.by}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    onClick={() => onOpenExternal(story)}
                    title={t("hn.reader.external")}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <ExternalIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onLearn(story)}
                    className="h-7 px-3 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    ✦ {t("hn.learn")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Infinite-scroll sentinel + footer status */}
      <div ref={sentinelRef} />
      {loadingMore && (
        <div className="py-4 text-center text-xs text-muted-foreground animate-pulse">
          {t("hn.loadingMore")}
        </div>
      )}
      {!loading && !error && !hasMore && stories.length > 0 && (
        <div className="py-4 text-center text-[11px] font-mono text-muted-foreground/50">
          — {t("hn.end")} —
        </div>
      )}
    </div>
  );
}
