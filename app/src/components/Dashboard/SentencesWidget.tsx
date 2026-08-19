import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import type { SentenceItem } from "@/hooks/useDB.sentences";
import { BookmarkIcon } from "@/components/ui/icons";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { DashboardCard, DashboardRow, DashboardEmpty, DashboardSkeleton, DashboardFill, DASHBOARD_BODY_ROWS } from "./DashboardCard";

/** Dashboard card: the sentence-pattern library, which is where article-driven
 *  study actually accumulates — starred sentences first, then the newest.
 *
 *  Click-through needs no new plumbing: `openVocabularySentence` navigates to
 *  Vocabulary and VocabularyPage switches itself to the sentences tab on a
 *  non-empty `initialSentenceId` (VocabularyPage.tsx:58). */
export function SentencesWidget({ maxRows = DASHBOARD_BODY_ROWS, onInitialDataSettled }: {
  maxRows?: number;
  onInitialDataSettled?: () => void;
}) {
  const t = useT();
  const db = useDB();
  const openSentence = useNavStore((s) => s.openVocabularySentence);
  const openPatterns = useNavStore((s) => s.openVocabularyPatterns);
  const [items, setItems] = useState<SentenceItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    const settle = (all: SentenceItem[]) => {
      if (!alive) return;
      const ranked = [...all].sort((a, b) => Number(b.starred) - Number(a.starred));
      setItems(ranked.slice(0, maxRows));
      onInitialDataSettled?.();
    };
    void db.listSentences().then(settle).catch(() => settle([]));
    return () => { alive = false; };
  }, [maxRows, onInitialDataSettled]);

  return (
    <DashboardCard
      title={t("dash.sentences.title")}
      icon={<BookmarkIcon className="w-3.5 h-3.5 text-muted-foreground" />}
      onViewAll={openPatterns}
    >
      {items === null ? (
        <DashboardSkeleton rows={maxRows} />
      ) : items.length === 0 ? (
        <DashboardEmpty>{t("dash.empty.sentences")}</DashboardEmpty>
      ) : (
        <>
        {items.map((p) => (
          <DashboardRow key={p.id} onClick={() => openSentence(p.id)}>
            {p.starred && <span className="shrink-0 text-[10px] text-primary">★</span>}
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium text-foreground truncate">{p.sentence}</span>
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
