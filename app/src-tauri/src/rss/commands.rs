//! `#[tauri::command]` entry points for feed subscription management and the
//! `rss_entries` cache (DB reads/writes).

use std::time::Duration;

use tauri::State;

use crate::db;
use crate::AppState;

use super::parse::fetch_feed_meta;
use super::types::{RssEntryRow, RssFeed};

#[tauri::command]
pub fn db_add_rss_feed(
    url: String,
    title: String,
    site_link: String,
    description: String,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "INSERT OR IGNORE INTO rss_feeds (url, title, site_link, description) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![url, title, site_link, description],
    )
    .map_err(|e| e.to_string())?;
    let inserted = db.changes() > 0;
    db.execute(
        "UPDATE rss_feeds SET title=?2, site_link=?3, description=?4 WHERE url=?1",
        rusqlite::params![url, title, site_link, description],
    )
    .map_err(|e| e.to_string())?;
    let id: i64 = db
        .query_row("SELECT id FROM rss_feeds WHERE url=?1", [&url], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if inserted {
        let pinned: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM rss_feeds WHERE is_pinned=1",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if pinned < 5 {
            db.execute(
                "UPDATE rss_feeds SET is_pinned=1,
                    pin_order=(SELECT COALESCE(MAX(pin_order), 0) + 1 FROM rss_feeds)
                  WHERE id=?1",
                [id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(id)
}

#[tauri::command]
pub fn db_get_rss_feeds(conn: State<'_, AppState>) -> Result<Vec<RssFeed>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare(
            "SELECT id, title, url, site_link, description, last_fetched_at, created_at,
                    EXISTS(SELECT 1 FROM rss_entries e WHERE e.feed_id = rss_feeds.id AND e.audio_url IS NOT NULL),
                    COALESCE(category_override, CASE WHEN EXISTS(
                        SELECT 1 FROM rss_entries e WHERE e.feed_id = rss_feeds.id AND e.audio_url IS NOT NULL
                    ) THEN 'podcast' ELSE 'article' END),
                    category_override, is_pinned, pin_order
             FROM rss_feeds ORDER BY is_pinned DESC, pin_order ASC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RssFeed {
                id: row.get(0)?,
                title: row.get(1)?,
                url: row.get(2)?,
                site_link: row.get(3)?,
                description: row.get(4)?,
                last_fetched_at: row.get(5)?,
                created_at: row.get(6)?,
                is_podcast: row.get(7)?,
                category: row.get(8)?,
                category_override: row.get(9)?,
                is_pinned: row.get(10)?,
                pin_order: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_rss_feed_preferences(
    id: i64,
    category: Option<String>,
    is_pinned: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    if !matches!(
        category.as_deref(),
        None | Some("article") | Some("podcast")
    ) {
        return Err("invalid feed category".into());
    }
    let db = db::lock_db(&conn)?;
    if is_pinned {
        let pinned: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM rss_feeds WHERE is_pinned = 1 AND id != ?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if pinned >= 5 {
            return Err("at most five feeds can be pinned".into());
        }
    }
    db.execute(
        "UPDATE rss_feeds
            SET category_override = ?1,
                is_pinned = ?2,
                pin_order = CASE
                    WHEN ?2 = 1 AND is_pinned = 0 THEN (SELECT COALESCE(MAX(pin_order), 0) + 1 FROM rss_feeds)
                    WHEN ?2 = 1 THEN pin_order
                    ELSE NULL
                END
          WHERE id = ?3",
        rusqlite::params![category, is_pinned, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_update_rss_feed_title(
    id: i64,
    title: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "UPDATE rss_feeds SET title = ?1 WHERE id = ?2",
        rusqlite::params![title, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_rss_feed(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM rss_feeds WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetch the feed and upsert its entries into `rss_entries` (deduped by url; `is_read` is
/// never touched on conflict). Updates `rss_feeds.last_fetched_at` and backfills feed
/// metadata that was empty at subscribe time. Returns the number of newly-inserted entries.
#[tauri::command]
pub async fn db_sync_rss_feed(feed_id: i64, conn: State<'_, AppState>) -> Result<i64, String> {
    let url = {
        let db = db::lock_db(&conn)?;
        db.query_row(
            "SELECT url FROM rss_feeds WHERE id = ?1",
            rusqlite::params![feed_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
    };

    let meta = fetch_feed_meta(&url).await?;
    // RSS may write dozens of entries. Use a separate WAL connection and one
    // transaction so a background refresh never holds the app-wide DB mutex
    // or performs one autocommit per article.
    let db_path = conn.db_path.lock().map_err(|e| e.to_string())?.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<i64, String> {
    let mut rss_db = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    rss_db.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    rss_db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;
    let tx = rss_db.transaction().map_err(|e| e.to_string())?;

    let before: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM rss_entries WHERE feed_id = ?1",
            rusqlite::params![feed_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for e in &meta.entries {
        if e.url.is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO rss_entries (feed_id, title, url, author, summary, image_url, audio_url, audio_duration, hn_item_id, published, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))
             ON CONFLICT(url) DO UPDATE SET
               feed_id=excluded.feed_id, title=excluded.title, author=excluded.author,
               summary=excluded.summary, image_url=excluded.image_url,
               audio_url=excluded.audio_url, audio_duration=excluded.audio_duration,
               hn_item_id=excluded.hn_item_id,
               published=excluded.published, fetched_at=excluded.fetched_at",
            rusqlite::params![
                feed_id,
                e.title,
                e.url,
                e.author,
                e.summary,
                e.image_url,
                e.audio_url,
                e.audio_duration,
                e.hn_item_id,
                e.published
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let after: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM rss_entries WHERE feed_id = ?1",
            rusqlite::params![feed_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    tx.execute(
        "UPDATE rss_feeds SET
           last_fetched_at = datetime('now'),
           title = CASE WHEN title = '' THEN ?2 ELSE title END,
           site_link = CASE WHEN site_link = '' THEN ?3 ELSE site_link END,
           description = CASE WHEN description = '' THEN ?4 ELSE description END
         WHERE id = ?1",
        rusqlite::params![feed_id, meta.title, meta.site_link, meta.description],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(after - before)
    }).await.map_err(|e| e.to_string())?
}

fn map_rss_entry_row(row: &rusqlite::Row) -> rusqlite::Result<RssEntryRow> {
    Ok(RssEntryRow {
        id: row.get(0)?,
        feed_id: row.get(1)?,
        title: row.get(2)?,
        url: row.get(3)?,
        author: row.get(4)?,
        summary: row.get(5)?,
        image_url: row.get(6)?,
        audio_url: row.get(7)?,
        audio_duration: row.get(8)?,
        hn_item_id: row.get(9)?,
        published: row.get(10)?,
        is_read: row.get(11)?,
        fetched_at: row.get(12)?,
    })
}

const RSS_ENTRY_COLUMNS: &str =
    "id, feed_id, title, url, author, summary, image_url, audio_url, audio_duration, hn_item_id, published, is_read, fetched_at";

/// Read cached entries from the DB; `feed_id = None` returns entries across all feeds.
#[tauri::command]
pub fn db_get_rss_entries(
    feed_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<Vec<RssEntryRow>, String> {
    let db = db::lock_db(&conn)?;
    let lim = limit.unwrap_or(200);
    let off = offset.unwrap_or(0);

    let rows: Vec<RssEntryRow> = if let Some(fid) = feed_id {
        let sql = format!(
            "SELECT {RSS_ENTRY_COLUMNS} FROM rss_entries WHERE feed_id = ?1 ORDER BY published DESC LIMIT ?2 OFFSET ?3"
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(rusqlite::params![fid, lim, off], map_rss_entry_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        mapped
    } else {
        let sql = format!(
            "SELECT {RSS_ENTRY_COLUMNS} FROM rss_entries ORDER BY published DESC LIMIT ?1 OFFSET ?2"
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(rusqlite::params![lim, off], map_rss_entry_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        mapped
    };

    Ok(rows)
}

#[tauri::command]
pub fn db_mark_rss_entry_read(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "UPDATE rss_entries SET is_read = 1 WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Unread entry count per feed, as `[feed_id, count]` pairs (feeds with zero unread are omitted).
#[tauri::command]
pub fn db_get_rss_unread_counts(conn: State<'_, AppState>) -> Result<Vec<(i64, i64)>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare("SELECT feed_id, COUNT(*) FROM rss_entries WHERE is_read = 0 GROUP BY feed_id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
