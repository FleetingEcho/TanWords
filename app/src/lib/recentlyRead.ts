const KEY = "tanwords_recently_read";
const MAX_ITEMS = 30;

export interface RecentlyReadItem {
  url: string;
  title: string;
  domain: string;
  audioUrl: string | null;
  feedTitle: string;
  hnItemId: number | null;
  readAt: number;
}

export function getRecentlyRead(): RecentlyReadItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Records (or bumps) an article as just-read — most recent first, deduped by
 *  URL, capped at MAX_ITEMS. Purely a localStorage convenience list (see the
 *  reader bar's "recently read" dropdown), not synced or DB-backed. */
export function addRecentlyRead(item: Omit<RecentlyReadItem, "readAt">): void {
  try {
    const existing = getRecentlyRead().filter((r) => r.url !== item.url);
    const next = [{ ...item, readAt: Date.now() }, ...existing].slice(0, MAX_ITEMS);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — this list is a nice-to-have, fail silently
  }
}

export function removeRecentlyRead(url: string): void {
  try {
    const next = getRecentlyRead().filter((r) => r.url !== url);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function clearRecentlyRead(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
