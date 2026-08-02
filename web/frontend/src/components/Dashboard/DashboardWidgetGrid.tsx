import React from "react";
import type { DashboardStats } from "@/hooks/useDB";
import { RssWidget } from "./RssWidget";
import { LatestWordsWidget } from "./LatestWordsWidget";
import { RecentlyReadWidget } from "./RecentlyReadWidget";
import { RecentDocumentsWidget } from "./RecentDocumentsWidget";
import { PatternsWidget } from "./PatternsWidget";
import { ListenNextWidget } from "./ListenNextWidget";

/** The Dashboard's Recents area.
 *
 *  Six identical cards in two columns was predictable to the point of being
 *  dull — same width, same height, same weight, so nothing told you where to
 *  look. This is a bento instead: widths vary across a 12-column grid, and the
 *  sentence-pattern library gets to be the hero, since it is where
 *  article-driven study actually accumulates.
 *
 *  Heights are nobody's constant. Each card asks for the rows it actually has
 *  (capped by `maxRows`, so the hero may show more than the small cards) and
 *  then stretches to its grid row — so a full database gives the tall,
 *  aligned composition, and an empty one collapses to something compact
 *  instead of six tall cards full of filler.
 *
 *  Two grid cells per band, and the browser reconciles them: the hero and the
 *  stack beside it agree because they are siblings in the same stretched row,
 *  not because either was told a pixel value.
 *
 *  The slot assignment lives here as plain JSX rather than in a persisted
 *  setting. `dashboardWidgetLayout` modelled two ordered columns, which a
 *  bento cannot express — size and position are part of the composition now,
 *  not a free ordering — and nothing had been able to write to it since the
 *  drag handles were removed. */
export function DashboardWidgetGrid({ stats, statsFailed = false }: {
  stats: DashboardStats | null;
  /** True once the stats query settled with an error (e.g. no DB connected yet).
   *  The stats-fed cards then render their empty states instead of skeletons. */
  statsFailed?: boolean;
}) {
  const recentWords = stats?.recent_words ?? (statsFailed ? [] : undefined);
  const recentDocs = stats?.recent_docs ?? (statsFailed ? [] : undefined);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
      <div className="lg:col-span-7">
        <PatternsWidget maxRows={7} />
      </div>
      {/* flex-1 on each: the pair splits whatever height this cell is given,
        * which is what keeps their outer edges level with the hero's. */}
      <div className="lg:col-span-5 flex flex-col gap-2">
        <div className="flex-1 min-h-0">
          <LatestWordsWidget words={recentWords} maxRows={3} />
        </div>
        <div className="flex-1 min-h-0">
          <ListenNextWidget maxRows={3} />
        </div>
      </div>

      <div className="lg:col-span-5">
        <RssWidget maxRows={4} />
      </div>
      <div className="lg:col-span-4">
        <RecentlyReadWidget maxRows={4} />
      </div>
      <div className="lg:col-span-3">
        <RecentDocumentsWidget docs={recentDocs} maxRows={4} />
      </div>
    </div>
  );
}
