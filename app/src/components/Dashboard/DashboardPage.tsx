import React, { useEffect, useState } from "react";
import { useDB, DashboardStats } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { DashboardWidgetGrid } from "./DashboardWidgetGrid";
import { QuickActionsBar } from "./QuickActionsBar";
import { UploadsCard } from "./UploadsCard";
import { useNavStore } from "@/store/navStore";

// ── Small pieces ────────────────────────────────────────────────────────────

/** `value` is null until the sidecar handshake completes and the first stats
 *  query returns — which on a cold start is long enough to see.
 *
 *  It used to render `stats?.word_count ?? 0`, so the dashboard came up
 *  claiming four zeros and then snapped to the real numbers: not a load, but a
 *  wrong answer being corrected. A placeholder bar of the same height says
 *  "not known yet" and turns into the number without moving anything. */
function StatTile({
  value,
  label,
  accent,
  onClick,
}: {
  value: number | null;
  label: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-2xl border border-border bg-card px-5 py-4 text-left transition-[transform,border-color,background-color,box-shadow] hover:-translate-y-0.5 hover:border-primary/35 hover:bg-muted/20 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0"
    >
      {value === null ? (
        <div className="h-[30px] flex items-center" aria-hidden>
          <div className="h-6 w-14 rounded-lg bg-muted animate-pulse" />
        </div>
      ) : (
        <p className={`text-3xl font-bold leading-none tabular-nums h-[30px] ${accent ? "text-primary" : ""}`}>
          {value}
        </p>
      )}
      <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-foreground">
        {label}
      </p>
    </button>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
// Deliberately no streak / activity-heatmap / review stats: the dashboard is
// a "continue learning" dispatcher, not a habit tracker.

export function DashboardPage() {
  const db = useDB();
  const t = useT();
  const lang = useSettingsStore((s) => s.uiLanguage);
  const dashboardBanner = useSettingsStore((s) => s.dashboardBanner);
  const bannerPosition = useSettingsStore((s) => s.dashboardBannerPosition);
  const nickname = useSettingsStore((s) => s.nickname);
  const navigate = useNavStore((s) => s.navigate);
  const openVocabularyPatterns = useNavStore((s) => s.openVocabularyPatterns);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  // getDashboardStats resolves null when the DB is unreachable ("not connected
  // yet" looks identical to "still loading" in `stats` alone). Without this
  // flag the stat tiles pulse and the recents cards keep their skeletons
  // running forever on a fresh install that has no database yet.
  const [statsSettled, setStatsSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      db.getDashboardStats().then((s) => {
        if (!alive) return;
        setStats(s);
        setStatsSettled(true);
      });
    };
    load();
    window.addEventListener("vocab-updated", load);
    return () => {
      alive = false;
      window.removeEventListener("vocab-updated", load);
    };
  }, []);

  const hour = new Date().getHours();
  const baseGreeting =
    hour < 12 ? t("dash.greeting.morning") : hour < 18 ? t("dash.greeting.afternoon") : t("dash.greeting.evening");
  const greeting = nickname.trim() ? `${baseGreeting}, ${nickname.trim()}` : baseGreeting;
  const dateLabel = new Date().toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 animate-fade-in w-full">
      {dashboardBanner && (
        <div className="w-full h-[200px] rounded-2xl overflow-hidden border border-border">
          {/* The banner is far wider than most photos, so `cover` always discards
            * part of the image — which part is the user's choice, made in Settings. */}
          <img
            src={dashboardBanner}
            alt=""
            className="w-full h-full object-cover"
            style={{ objectPosition: `${bannerPosition.x}% ${bannerPosition.y}%` }}
          />
        </div>
      )}

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">{greeting}</h1>
        <p className="text-sm text-muted-foreground mt-1">{dateLabel}</p>
      </div>

      {/* Stat tiles: how much of each thing the app collects, not how
        * diligently — one tile per kind of thing you accumulate. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile value={statsSettled ? stats?.word_count ?? 0 : null} label={t("dash.stat.words")} onClick={() => navigate("vocabulary")} />
        <StatTile value={statsSettled ? stats?.pattern_count ?? 0 : null} label={t("dash.stat.sentences")} accent onClick={openVocabularyPatterns} />
        <StatTile value={statsSettled ? stats?.chat_count ?? 0 : null} label={t("dash.stat.chats")} onClick={() => navigate("chat")} />
        <StatTile value={statsSettled ? stats?.doc_count ?? 0 : null} label={t("dash.stat.docs")} onClick={() => navigate("documents")} />
      </div>

      {/* Navigation, not a "recent" anything — hence outside the grid below */}
      <QuickActionsBar />

      {/* Files land in the same standalone store the asset manager lists, so
        * dropping something here and opening Docs › assets shows the same file. */}
      <UploadsCard />

      {/* Recents — six cards, every one the same height (see DashboardCard) */}
      <DashboardWidgetGrid stats={stats} statsFailed={statsSettled && !stats} />
    </div>
  );
}
