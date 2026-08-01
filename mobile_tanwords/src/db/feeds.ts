/**
 * RSS feed subscriptions and entry cache — port of desktop
 * `app/core/src/rss/commands.rs`. Same tables (`rss_feeds`, `rss_entries`,
 * `feed_bookmarks`), same SQL.
 *
 * Fetching/parsing is NOT here — that's `src/services/rss.ts` on mobile
 * (another port target); this module persists what the fetcher hands to it,
 * so `db_sync_rss_feed` (fetch + persist) becomes `db_replace_feed_entries`
 * (persist only).
 */
import { getDb } from "./connection";
import type {
  FeedBookmark,
  FeedBookmarkInput,
  RssEntryRow,
  RssFeed,
} from "@/hooks/useDB.types";

/** One parsed feed entry, as produced by the RSS fetch/parse service. */
export interface ParsedEntryInput {
  title: string;
  url: string;
  author: string;
  summary: string;
  imageUrl: string | null;
  published: string;
  /** Podcast enclosure (direct mp3/m4a URL); null for regular article entries. */
  audioUrl: string | null;
  /** Episode length in seconds, when the feed provides it. */
  audioDuration: number | null;
  /** Hacker News item id, for hnrss.org-style feeds. */
  hnItemId?: number | null;
}

const RSS_ENTRY_COLUMNS =
  "id, feed_id, title, url, author, summary, image_url, audio_url, audio_duration, hn_item_id, published, is_read, fetched_at";

interface RawEntryRow {
  id: number;
  feed_id: number;
  title: string;
  url: string;
  author: string;
  summary: string;
  image_url: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  hn_item_id: number | null;
  published: string;
  is_read: number;
  fetched_at: string;
}

function mapRssEntryRow(r: RawEntryRow): RssEntryRow {
  return {
    id: r.id,
    feed_id: r.feed_id,
    title: r.title,
    url: r.url,
    author: r.author,
    summary: r.summary,
    image_url: r.image_url,
    audio_url: r.audio_url,
    audio_duration: r.audio_duration,
    hn_item_id: r.hn_item_id,
    published: r.published,
    is_read: r.is_read !== 0,
    fetched_at: r.fetched_at,
  };
}

/**
 * Insert or refresh a subscription row keyed by url. New feeds are
 * auto-pinned while fewer than five pins exist. Returns the feed id.
 * Port of `db_add_rss_feed`.
 */
export async function db_add_rss_feed(args: {
  url: string;
  title: string;
  siteLink: string;
  description: string;
}): Promise<number> {
  const db = getDb();
  const { url, title, siteLink, description } = args;
  const inserted =
    (
      await db.runAsync(
        "INSERT OR IGNORE INTO rss_feeds (url, title, site_link, description) VALUES (?, ?, ?, ?)",
        [url, title, siteLink, description]
      )
    ).changes > 0;
  await db.runAsync("UPDATE rss_feeds SET title=?, site_link=?, description=? WHERE url=?", [
    title,
    siteLink,
    description,
    url,
  ]);
  const row = await db.getFirstAsync<{ id: number }>("SELECT id FROM rss_feeds WHERE url=?", [url]);
  if (!row) throw new Error("no rows returned");
  const id = row.id;
  if (inserted) {
    const pinnedRow = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM rss_feeds WHERE is_pinned=1"
    );
    if ((pinnedRow?.n ?? 0) < 5) {
      await db.runAsync(
        "UPDATE rss_feeds SET is_pinned=1, " +
          "pin_order=(SELECT COALESCE(MAX(pin_order), 0) + 1 FROM rss_feeds) " +
          "WHERE id=?",
        [id]
      );
    }
  }
  return id;
}

export async function db_get_rss_feeds(): Promise<RssFeed[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{
    id: number;
    title: string;
    url: string;
    site_link: string;
    description: string;
    last_fetched_at: string | null;
    created_at: string;
    is_podcast: number;
    category: string;
    category_override: string | null;
    is_pinned: number;
    pin_order: number | null;
  }>(
    "SELECT id, title, url, site_link, description, last_fetched_at, created_at, " +
      "EXISTS(SELECT 1 FROM rss_entries e WHERE e.feed_id = rss_feeds.id AND e.audio_url IS NOT NULL) AS is_podcast, " +
      "COALESCE(category_override, CASE WHEN EXISTS( " +
      "SELECT 1 FROM rss_entries e WHERE e.feed_id = rss_feeds.id AND e.audio_url IS NOT NULL " +
      ") THEN 'podcast' ELSE 'article' END) AS category, " +
      "category_override, is_pinned, pin_order " +
      "FROM rss_feeds ORDER BY is_pinned DESC, pin_order ASC, created_at DESC"
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    site_link: r.site_link,
    description: r.description,
    last_fetched_at: r.last_fetched_at,
    created_at: r.created_at,
    is_podcast: r.is_podcast !== 0,
    category: r.category as "article" | "podcast",
    category_override: r.category_override as "article" | "podcast" | null,
    is_pinned: r.is_pinned !== 0,
    pin_order: r.pin_order,
  }));
}

/** Bookmark a feed/HN entry by URL (metadata is snapshotted so the drilldown
 *  stays useful even if the feed later drops or edits the entry). Returns
 *  whether the bookmark was newly created; calling it again removes it. */
export async function db_toggle_feed_bookmark(input: FeedBookmarkInput): Promise<boolean> {
  const db = getDb();
  const existingRow = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM feed_bookmarks WHERE url = ?",
    [input.url]
  );
  if ((existingRow?.n ?? 0) > 0) {
    await db.runAsync("DELETE FROM feed_bookmarks WHERE url = ?", [input.url]);
    return false;
  }

  await db.runAsync(
    "INSERT INTO feed_bookmarks " +
      "(url, title, feed_title, domain, summary, image_url, audio_url, audio_duration, hn_item_id, published) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      input.url,
      input.title,
      input.feedTitle,
      input.domain,
      input.summary,
      input.imageUrl,
      input.audioUrl,
      input.audioDuration,
      input.hnItemId,
      input.published,
    ]
  );
  return true;
}

export async function db_get_feed_bookmarks(args?: {
  limit?: number | null;
  offset?: number | null;
}): Promise<FeedBookmark[]> {
  const db = getDb();
  return db.getAllAsync<FeedBookmark>(
    "SELECT id, url, title, feed_title, domain, summary, image_url, audio_url, " +
      "audio_duration, hn_item_id, published, created_at " +
      "FROM feed_bookmarks " +
      "ORDER BY created_at DESC, id DESC " +
      "LIMIT ? OFFSET ?",
    [args?.limit ?? 500, args?.offset ?? 0]
  );
}

export async function db_remove_feed_bookmark(args: { url: string }): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM feed_bookmarks WHERE url = ?", [args.url]);
}

export async function db_update_rss_feed_preferences(args: {
  id: number;
  category: "article" | "podcast" | null;
  isPinned: boolean;
}): Promise<void> {
  const { id, category, isPinned } = args;
  if (category !== null && category !== "article" && category !== "podcast") {
    throw new Error("invalid feed category");
  }
  const db = getDb();
  if (isPinned) {
    const pinnedRow = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM rss_feeds WHERE is_pinned = 1 AND id != ?",
      [id]
    );
    if ((pinnedRow?.n ?? 0) >= 5) {
      throw new Error("at most five feeds can be pinned");
    }
  }
  await db.runAsync(
    "UPDATE rss_feeds " +
      "SET category_override = ?, " +
      "is_pinned = ?, " +
      "pin_order = CASE " +
      "WHEN ? = 1 AND is_pinned = 0 THEN (SELECT COALESCE(MAX(pin_order), 0) + 1 FROM rss_feeds) " +
      "WHEN ? = 1 THEN pin_order " +
      "ELSE NULL " +
      "END " +
      "WHERE id = ?",
    [category, isPinned ? 1 : 0, isPinned ? 1 : 0, isPinned ? 1 : 0, id]
  );
}

export async function db_update_rss_feed_title(args: { id: number; title: string }): Promise<void> {
  const db = getDb();
  await db.runAsync("UPDATE rss_feeds SET title = ? WHERE id = ?", [args.title, args.id]);
}

export async function db_delete_rss_feed(args: { id: number }): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM rss_feeds WHERE id = ?", [args.id]);
}

/**
 * Persist a freshly-parsed feed's entries (the fetch happens in
 * `src/services/rss.ts`, not here). New urls are inserted with is_read = 0;
 * rows the feed already had are left completely untouched (including is_read
 * and any field the publisher edited), so the guard in the desktop's
 * last-sync-wins `ON CONFLICT ... WHERE` clause never comes into play.
 * Bumps rss_feeds.last_fetched_at. Returns the number of newly-added entries
 * for this feed (same count db_sync_rss_feed returns on desktop).
 */
export async function db_replace_feed_entries(args: {
  feedId: number;
  entries: ParsedEntryInput[];
}): Promise<number> {
  const db = getDb();
  const { feedId, entries } = args;

  let before = 0;
  let after = 0;
  await db.withTransactionAsync(async () => {
    before = (
      await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM rss_entries WHERE feed_id = ?",
        [feedId]
      )
    )?.n ?? 0;

    for (const e of entries) {
      if (!e.url) continue;
      await db.runAsync(
        "INSERT OR IGNORE INTO rss_entries (feed_id, title, url, author, summary, image_url, audio_url, audio_duration, hn_item_id, published, fetched_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        [
          feedId,
          e.title,
          e.url,
          e.author,
          e.summary,
          e.imageUrl,
          e.audioUrl,
          e.audioDuration,
          e.hnItemId ?? null,
          e.published,
        ]
      );
    }

    after = (
      await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM rss_entries WHERE feed_id = ?",
        [feedId]
      )
    )?.n ?? 0;

    await db.runAsync("UPDATE rss_feeds SET last_fetched_at = datetime('now') WHERE id = ?", [
      feedId,
    ]);
  });
  return after - before;
}

/** Read cached entries from the DB; `feedId` null/omitted returns entries
 *  across all feeds. */
export async function db_get_rss_entries(args?: {
  feedId?: number | null;
  limit?: number | null;
  offset?: number | null;
}): Promise<RssEntryRow[]> {
  const db = getDb();
  const lim = args?.limit ?? 200;
  const off = args?.offset ?? 0;

  const feedId = args?.feedId ?? null;
  if (feedId !== null) {
    const rows = await db.getAllAsync<RawEntryRow>(
      `SELECT ${RSS_ENTRY_COLUMNS} FROM rss_entries WHERE feed_id = ? ORDER BY published DESC LIMIT ? OFFSET ?`,
      [feedId, lim, off]
    );
    return rows.map(mapRssEntryRow);
  }
  const rows = await db.getAllAsync<RawEntryRow>(
    `SELECT ${RSS_ENTRY_COLUMNS} FROM rss_entries ORDER BY published DESC LIMIT ? OFFSET ?`,
    [lim, off]
  );
  return rows.map(mapRssEntryRow);
}

export async function db_mark_rss_entry_read(args: { id: number }): Promise<void> {
  const db = getDb();
  await db.runAsync("UPDATE rss_entries SET is_read = 1 WHERE id = ?", [args.id]);
}

/** Unread entry count per feed, as [feed_id, count] pairs (feeds with zero
 *  unread are omitted). */
export async function db_get_rss_unread_counts(): Promise<Array<[number, number]>> {
  const db = getDb();
  const rows = await db.getAllAsync<{ feed_id: number; n: number }>(
    "SELECT feed_id, COUNT(*) AS n FROM rss_entries WHERE is_read = 0 GROUP BY feed_id"
  );
  return rows.map((r) => [r.feed_id, r.n] as [number, number]);
}
