import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import type { DashboardStats } from "@/hooks/useDB";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { DashboardCard, DashboardRow, DashboardEmpty, DashboardSkeleton, DashboardFillRows, DASHBOARD_BODY_ROWS } from "./DashboardCard";

/** Dashboard card: the newest additions to the vocabulary. `words` comes from
 *  the parent's single shared `getDashboardStats()` call rather than fetching
 *  its own copy, since that call already covers every "recents" card. */
export function LatestWordsWidget({ words }: { words: DashboardStats["recent_words"] | undefined }) {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);

  return (
    <DashboardCard title={t("dash.recentWords")} onViewAll={() => navigate("vocabulary")}>
      {words === undefined ? (
        <DashboardSkeleton />
      ) : words.length === 0 ? (
        <DashboardEmpty>{t("dash.empty.words")}</DashboardEmpty>
      ) : (
        <>
          {words.map((w) => (
            <DashboardRow key={w.id} onClick={() => navigate("vocabulary", w.id)}>
              <span className="text-sm font-semibold text-foreground shrink-0">{w.word}</span>
              <LevelBadge level={w.level} />
              <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate text-right">{w.zh}</span>
            </DashboardRow>
          ))}
          <DashboardFillRows count={DASHBOARD_BODY_ROWS - words.length} />
        </>
      )}
    </DashboardCard>
  );
}
