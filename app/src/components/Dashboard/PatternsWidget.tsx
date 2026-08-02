import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import type { PatternItem } from "@/hooks/useDB.patterns";
import { BookmarkIcon } from "@/components/ui/icons";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { DashboardCard, DashboardRow, DashboardEmpty, DashboardSkeleton, DashboardFill, DASHBOARD_BODY_ROWS } from "./DashboardCard";

/** Dashboard card: the sentence-pattern library, which is where article-driven
 *  study actually accumulates — starred patterns first, then the newest.
 *
 *  Click-through needs no new plumbing: `openVocabularySentence` navigates to
 *  Vocabulary and VocabularyPage switches itself to the patterns tab on a
 *  non-empty `initialSentenceId` (VocabularyPage.tsx:58). */
export function PatternsWidget({ maxRows = DASHBOARD_BODY_ROWS }: { maxRows?: number }) {
  const t = useT();
  const db = useDB();
  const openSentence = useNavStore((s) => s.openVocabularySentence);
  const openPatterns = useNavStore((s) => s.openVocabularyPatterns);
  const [items, setItems] = useState<PatternItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    db.listPatterns().then((all) => {
      if (!alive) return;
      const ranked = [...all].sort((a, b) => Number(b.starred) - Number(a.starred));
      setItems(ranked.slice(0, maxRows));
    });
    return () => { alive = false; };
  }, [maxRows]);

  return (
    <DashboardCard
      title={t("dash.patterns.title")}
      icon={<BookmarkIcon className="w-3.5 h-3.5 text-muted-foreground" />}
      onViewAll={openPatterns}
    >
      {items === null ? (
        <DashboardSkeleton rows={maxRows} />
      ) : items.length === 0 ? (
        <DashboardEmpty>{t("dash.empty.patterns")}</DashboardEmpty>
      ) : (
        <>
        {items.map((p) => (
          <DashboardRow key={p.id} onClick={() => openSentence(p.id)}>
            {p.starred && <span className="shrink-0 text-[10px] text-primary">★</span>}
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium text-foreground truncate">{p.pattern}</span>
              <span className="block text-[10px] text-muted-foreground truncate">{p.zh}</span>
            </span>
            {p.level && <LevelBadge level={p.level} />}
          </DashboardRow>
        ))}
        <DashboardFill />
        </>
      )}
    </DashboardCard>
  );
}
