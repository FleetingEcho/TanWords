import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { Button } from "@/components/ui/button";
import type { DashboardStats } from "@/hooks/useDB";

const LEVEL_COLORS: Record<string, string> = {
  C2: "#a855f7", C1: "#3b82f6", B2: "#14b8a6", B1: "#22c55e", A2: "#f59e0b", A1: "#f59e0b",
};

function LevelDot({ level }: { level: string }) {
  if (!level) return null;
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{ color: LEVEL_COLORS[level] ?? "#64748b", backgroundColor: `${LEVEL_COLORS[level] ?? "#64748b"}18` }}
    >
      {level}
    </span>
  );
}

/** Dashboard card: the newest additions to the vocabulary. `words` comes from
 *  the parent's single shared `getDashboardStats()` call rather than fetching
 *  its own copy, since that call already covers every "recents" card. */
export function LatestWordsWidget({ words }: { words: DashboardStats["recent_words"] | undefined }) {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h2 className="text-sm font-semibold">{t("dash.recentWords")}</h2>
        <Button
          variant="link"
          onClick={() => navigate("vocabulary")}
          className="h-auto p-0 text-[11px] font-semibold text-primary hover:underline"
        >
          {t("dash.viewAll")}
        </Button>
      </div>
      {words && words.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground leading-relaxed">{t("dash.empty.words")}</p>
      ) : (
        <div className="divide-y divide-border">
          {(words ?? []).map((w) => (
            <Button
              key={w.id}
              variant="ghost"
              onClick={() => navigate("vocabulary", w.id)}
              className="h-auto w-full rounded-none flex items-center justify-start gap-2 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
            >
              <span className="text-sm font-semibold text-foreground">{w.word}</span>
              <LevelDot level={w.level} />
              <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate text-right">{w.zh}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
