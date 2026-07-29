import React, { useEffect, useState } from "react";
import { useDB, DashboardStats } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { DashboardWidgetGrid } from "./DashboardWidgetGrid";

// ── Small pieces ────────────────────────────────────────────────────────────

function StatTile({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-2xl px-5 py-4">
      <p className={`text-3xl font-bold leading-none tabular-nums ${accent ? "text-primary" : ""}`}>
        {value}
      </p>
      <p className="text-[11px] font-medium text-muted-foreground mt-2 uppercase tracking-wider">
        {label}
      </p>
    </div>
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
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      db.getDashboardStats().then((s) => { if (alive) setStats(s); });
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
    <div className="p-6 space-y-5 animate-fade-in w-full">
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

      {/* Stat tiles: what has been collected, not how diligently */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile value={stats?.word_count ?? 0} label={t("dash.stat.words")} />
        <StatTile value={stats?.words_this_week ?? 0} label={t("dash.stat.week")} accent />
        <StatTile value={stats?.article_count ?? 0} label={t("dash.stat.articles")} />
      </div>

      {/* Recents — drag any card by its handle to reorder, within or across columns */}
      <DashboardWidgetGrid stats={stats} />
    </div>
  );
}
