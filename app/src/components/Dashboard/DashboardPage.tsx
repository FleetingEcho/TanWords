import React, { useEffect, useState } from "react";
import { useDB, DashboardStats } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { useReadingStore } from "@/store/readingStore";
import { useSettingsStore } from "@/store/settingsStore";
import { ReadingIcon, ChatIcon, FeedIcon } from "@/components/ui/icons";
import { RssWidget } from "./RssWidget";
import { Button } from "@/components/ui/button";

const LEVEL_COLORS: Record<string, string> = {
  C2: "#a855f7", C1: "#3b82f6", B2: "#14b8a6", B1: "#22c55e", A2: "#f59e0b", A1: "#f59e0b",
};

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

// ── Page ────────────────────────────────────────────────────────────────────
// Deliberately no streak / activity-heatmap / review stats: the dashboard is
// a "continue learning" dispatcher, not a habit tracker.

export function DashboardPage() {
  const db = useDB();
  const t = useT();
  const lang = useSettingsStore((s) => s.uiLanguage);
  const navigate = useNavStore((s) => s.navigate);
  const setPendingArticleId = useReadingStore((s) => s.setPendingArticleId);
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
  const greeting =
    hour < 12 ? t("dash.greeting.morning") : hour < 18 ? t("dash.greeting.afternoon") : t("dash.greeting.evening");
  const dateLabel = new Date().toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const resumeLesson = (articleId: number) => {
    setPendingArticleId(articleId);
    navigate("reading");
  };

  const resume = stats?.resume ?? null;

  return (
    <div className="p-6 space-y-5 animate-fade-in w-full">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">{greeting}</h1>
        <p className="text-sm text-muted-foreground mt-1">{dateLabel}</p>
      </div>

      {/* Hero: resume the unfinished lesson, or start a new one */}
      {resume ? (
        <Button
          variant="ghost"
          onClick={() => resumeLesson(resume.article_id)}
          className="h-auto group w-full block text-left bg-gradient-to-br from-primary to-indigo-700 text-primary-foreground rounded-2xl p-6 relative overflow-hidden transition-transform hover:scale-[1.005] hover:bg-gradient-to-br hover:from-primary hover:to-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest opacity-80">
            {resume.origin === "hackernews" && (
              <span className="w-4 h-4 rounded-sm bg-white/20 text-[9px] font-bold flex items-center justify-center">Y</span>
            )}
            {resume.origin === "rss" && (
              <span className="w-4 h-4 rounded-sm bg-white/20 flex items-center justify-center">
                <FeedIcon className="w-2.5 h-2.5" />
              </span>
            )}
            {t("dash.resume.eyebrow")}
          </div>
          <p className="text-xl font-bold leading-snug mt-2 pr-32 line-clamp-2">{resume.title}</p>
          <div className="mt-4 max-w-md">
            <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-white/90 transition-all"
                style={{ width: `${Math.round((resume.processed / Math.max(resume.total, 1)) * 100)}%` }}
              />
            </div>
            <p className="text-xs opacity-80 mt-1.5 tabular-nums">
              {t("dash.resume.progress", { done: resume.processed, total: resume.total })}
            </p>
          </div>
          <span className="absolute right-6 bottom-6 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-white/15 backdrop-blur text-sm font-semibold group-hover:bg-white/25 transition-colors">
            {t("dash.resume.cta")} →
          </span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          onClick={() => navigate("reading")}
          className="h-auto group w-full block text-left bg-gradient-to-br from-primary to-indigo-700 text-primary-foreground rounded-2xl p-6 relative overflow-hidden transition-transform hover:scale-[1.005] hover:bg-gradient-to-br hover:from-primary hover:to-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">{t("dash.start.eyebrow")}</p>
          <p className="text-xl font-bold leading-snug mt-2">{t("dash.start.title")}</p>
          <p className="text-sm opacity-80 mt-1">{t("dash.start.sub")}</p>
          <span className="absolute right-6 bottom-6 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-white/15 backdrop-blur text-sm font-semibold group-hover:bg-white/25 transition-colors">
            {t("dash.start.cta")} →
          </span>
        </Button>
      )}

      {/* Stat tiles: what has been collected, not how diligently */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile value={stats?.word_count ?? 0} label={t("dash.stat.words")} />
        <StatTile value={stats?.words_this_week ?? 0} label={t("dash.stat.week")} accent />
        <StatTile value={stats?.article_count ?? 0} label={t("dash.stat.articles")} />
      </div>

      {/* Recents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <div className="space-y-3">
          {/* Quick actions */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: ReadingIcon, label: t("dash.quick.reading"), go: () => navigate("reading") },
                { icon: FeedIcon, label: t("dash.quick.feeds"), go: () => navigate("feeds") },
                { icon: ChatIcon, label: t("dash.quick.chat"), go: () => navigate("chat") },
              ].map((a) => (
                <Button
                  key={a.label}
                  variant="ghost"
                  onClick={a.go}
                  className="h-auto group flex flex-col items-center gap-1.5 py-3 rounded-xl border border-border hover:bg-muted/60 hover:border-primary/30 transition-colors"
                >
                  <a.icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  <span className="text-[11px] font-medium text-muted-foreground">{a.label}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Feed subscriptions at a glance */}
          <RssWidget />
        </div>

        <div className="space-y-3">
          {/* Latest words */}
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
            {stats && stats.recent_words.length === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground leading-relaxed">{t("dash.empty.words")}</p>
            ) : (
              <div className="divide-y divide-border">
                {(stats?.recent_words ?? []).map((w) => (
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

          {/* Recent documents */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <h2 className="text-sm font-semibold">{t("dash.recentDocs")}</h2>
              <Button
                variant="link"
                onClick={() => navigate("documents")}
                className="h-auto p-0 text-[11px] font-semibold text-primary hover:underline"
              >
                {t("dash.viewAll")}
              </Button>
            </div>
            {stats && stats.recent_docs.length === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground">{t("dash.empty.docs")}</p>
            ) : (
              <div className="divide-y divide-border">
                {(stats?.recent_docs ?? []).map((d) => (
                  <Button
                    key={d.id}
                    variant="ghost"
                    onClick={() => navigate("documents")}
                    className="h-auto w-full rounded-none flex items-center justify-start gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
                  >
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">{d.title}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                      {d.updated_at.slice(0, 10)}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
