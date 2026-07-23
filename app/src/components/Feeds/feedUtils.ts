/** Shared helpers for the Feeds magazine layout. */

const STALE_MS = 15 * 60 * 1000;

/** SQLite datetime('now') is UTC without a zone marker — parse it as UTC. */
export function isStale(lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return true;
  const iso = lastFetchedAt.includes("T") ? lastFetchedAt : lastFetchedAt.replace(" ", "T") + "Z";
  const t = new Date(iso).getTime();
  return isNaN(t) || Date.now() - t > STALE_MS;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Format a date string as relative time ("3d ago" etc.) */
export function relativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

export type DateGroup = "today" | "yesterday" | "thisWeek" | "earlier";

export function dateGroupOf(dateStr: string): DateGroup {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "earlier";
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  if (day >= today) return "today";
  if (day >= today - 86400_000) return "yesterday";
  if (day >= today - 6 * 86400_000) return "thisWeek";
  return "earlier";
}

/** Deterministic hue from a feed title, for the no-cover placeholder gradient. */
function feedHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function placeholderGradient(name: string): string {
  const h = feedHue(name || "?");
  return `linear-gradient(135deg, hsl(${h} 45% 58%), hsl(${(h + 50) % 360} 50% 38%))`;
}

/** Stable cache key for title translation (titleTranslateStore) — namespaced by
 *  source since a native HN story id and an RSS entry's DB row id are drawn from
 *  unrelated id spaces and could otherwise collide. */
export function titleTranslateKey(entry: { id: number; hn_item_id?: number | null }): string {
  return entry.hn_item_id != null ? `hn:${entry.hn_item_id}` : `rss:${entry.id}`;
}
