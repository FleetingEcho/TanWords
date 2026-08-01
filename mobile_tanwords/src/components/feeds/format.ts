/** Formatting helpers shared by feeds/podcasts/bookmarks/reader/HN surfaces. */

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** "42:10" or "1:05:32" for episode durations (seconds). */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

type TLike = (key: string, vars?: Record<string, string | number>) => string;

/** Relative "n minutes ago" using the desktop feeds.recentlyRead.* keys;
 *  falls back to a short date past a week (desktop behavior in FeedTabs). */
export function relativeTime(isoOrMs: string | number, t: TLike): string {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("feeds.recentlyRead.justNow");
  if (minutes < 60) return t("feeds.recentlyRead.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("feeds.recentlyRead.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("feeds.recentlyRead.daysAgo", { n: days });
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Date bucket key for entry group headers: today/yesterday/thisWeek/earlier
 *  (desktop FeedsPage grouping, feeds.group.* keys). */
export type DateGroup = "feeds.group.today" | "feeds.group.yesterday" | "feeds.group.thisWeek" | "feeds.group.earlier";

export function dateGroupOf(isoDate: string, now = new Date()): DateGroup {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "feeds.group.earlier";
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (d.getTime() >= startOfDay) return "feeds.group.today";
  if (d.getTime() >= startOfDay - dayMs) return "feeds.group.yesterday";
  if (d.getTime() >= startOfDay - 6 * dayMs) return "feeds.group.thisWeek";
  return "feeds.group.earlier";
}
