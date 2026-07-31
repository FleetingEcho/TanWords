import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import type { DashboardStats } from "@/hooks/useDB";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { BookIcon } from "@/components/ui/icons";
import { DashboardCard, DashboardRow, DashboardEmpty, DashboardSkeleton, DashboardFill, DASHBOARD_BODY_ROWS } from "./DashboardCard";

/** Dashboard card: the newest additions to the vocabulary. `words` comes from
 *  the parent's single shared `getDashboardStats()` call rather than fetching
 *  its own copy, since that call already covers every "recents" card. */
export function LatestWordsWidget({ words, maxRows = DASHBOARD_BODY_ROWS }: {
  words: DashboardStats["recent_words"] | undefined;
  maxRows?: number;
}) {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);
  const shown = (words ?? []).slice(0, maxRows);

  return (
    <DashboardCard
      title={t("dash.recentWords")}
      // BookIcon, matching the sidebar's Vocabulary entry — this card was the
      // only one in the grid without an icon.
      icon={<BookIcon className="w-3.5 h-3.5 text-muted-foreground" />}
      onViewAll={() => navigate("vocabulary")}
    >
      {words === undefined ? (
        <DashboardSkeleton rows={maxRows} />
      ) : shown.length === 0 ? (
        <DashboardEmpty>{t("dash.empty.words")}</DashboardEmpty>
      ) : (
        <>
          {shown.map((w) => (
            <DashboardRow key={w.id} onClick={() => navigate("vocabulary", w.id)}>
              <span className="text-sm font-semibold text-foreground shrink-0">{w.word}</span>
              <LevelBadge level={w.level} />
              <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate text-right">{w.zh}</span>
            </DashboardRow>
          ))}
          <DashboardFill />
        </>
      )}
    </DashboardCard>
  );
}
