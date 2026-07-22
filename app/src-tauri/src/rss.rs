use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::db;
use crate::AppState;

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

#[derive(Serialize, Clone)]
pub struct RssEntry {
    pub title: String,
    pub url: String,
    pub author: String,
    pub summary: String,
    pub published: String,
    pub image_url: Option<String>,
    /// Podcast enclosure (direct mp3/m4a URL); None for regular article entries.
    pub audio_url: Option<String>,
    /// Episode length in seconds, when the feed provides it.
    pub audio_duration: Option<i64>,
}

/// A cached article row from `rss_entries` (plan2.md §A).
#[derive(Serialize)]
pub struct RssEntryRow {
    pub id: i64,
    pub feed_id: i64,
    pub title: String,
    pub url: String,
    pub author: String,
    pub summary: String,
    pub image_url: Option<String>,
    pub audio_url: Option<String>,
    pub audio_duration: Option<i64>,
    pub published: String,
    pub is_read: bool,
    pub fetched_at: String,
}

#[derive(Serialize)]
pub struct RssFeedMeta {
    pub title: String,
    pub description: String,
    pub site_link: String,
    pub entries: Vec<RssEntry>,
}

#[derive(Serialize)]
pub struct RssFeed {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub site_link: String,
    pub description: String,
    pub last_fetched_at: Option<String>,
    pub created_at: String,
    /// True when any cached entry of this feed carries an audio enclosure —
    /// the UI groups such feeds under "Podcasts" instead of "Articles".
    pub is_podcast: bool,
    pub category: String,
    pub category_override: Option<String>,
    pub is_pinned: bool,
    pub pin_order: Option<i64>,
}

/// Resolve a possibly-relative image URL against the entry/feed's page URL.
fn resolve_url(raw: &str, base: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    if let Ok(u) = url::Url::parse(raw) {
        return Some(u.to_string());
    }
    if let Ok(base_url) = url::Url::parse(base) {
        if let Ok(joined) = base_url.join(raw) {
            return Some(joined.to_string());
        }
    }
    None
}

/// Find the first `<img src="...">` in an HTML fragment (used as a last-resort cover).
fn first_img_src(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(rel) = lower[search_from..].find("<img") {
        let tag_start = search_from + rel;
        let tag_end = lower[tag_start..].find('>').map(|e| tag_start + e)?;
        let tag = &html[tag_start..tag_end];
        if let Some(src_pos) = tag.to_ascii_lowercase().find("src=") {
            let after = &tag[src_pos + 4..];
            let quote = after.chars().next()?;
            if quote == '"' || quote == '\'' {
                if let Some(end) = after[1..].find(quote) {
                    return Some(after[1..1 + end].to_string());
                }
            }
        }
        search_from = tag_end + 1;
    }
    None
}

/// True if the URL's path extension is a known non-image media type (podcast enclosures etc).
/// Extensionless URLs (common for CMS-generated image links) are treated as images.
fn looks_like_non_image(url_str: &str) -> bool {
    const NON_IMAGE_EXT: &[&str] = &[
        "mp3", "mp4", "m4a", "wav", "mov", "pdf", "zip", "ogg", "webm",
    ];
    url_str
        .rsplit('.')
        .next()
        .map(|ext| {
            let ext = ext
                .split(&['?', '#'][..])
                .next()
                .unwrap_or(ext)
                .to_ascii_lowercase();
            NON_IMAGE_EXT.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

/// Pick a cover image for an entry: media:content / enclosure / itunes:image / media:thumbnail
/// (all normalized into `entry.media` by feed-rs), falling back to the first `<img>` in the
/// entry's HTML body or summary. Relative URLs are resolved against `page_url`.
fn extract_image(entry: &feed_rs::model::Entry, page_url: &str) -> Option<String> {
    for media in &entry.media {
        for content in &media.content {
            if let Some(u) = &content.url {
                if !looks_like_non_image(u.as_str()) {
                    return resolve_url(u.as_str(), page_url);
                }
            }
        }
        for thumb in &media.thumbnails {
            if !thumb.image.uri.is_empty() {
                return resolve_url(&thumb.image.uri, page_url);
            }
        }
    }
    if let Some(body) = entry.content.as_ref().and_then(|c| c.body.as_ref()) {
        if let Some(src) = first_img_src(body) {
            return resolve_url(&src, page_url);
        }
    }
    if let Some(summary) = &entry.summary {
        if let Some(src) = first_img_src(&summary.content) {
            return resolve_url(&src, page_url);
        }
    }
    None
}

/// Pick the podcast audio enclosure for an entry, if any: the first `media:content`
/// (RSS `<enclosure>` is normalized into `entry.media` by feed-rs same as media:content)
/// whose MIME type starts with `audio/`, or failing that whose URL extension looks like
/// an audio file. Returns `(url, duration_seconds)`.
fn extract_audio(entry: &feed_rs::model::Entry, page_url: &str) -> (Option<String>, Option<i64>) {
    const AUDIO_EXT: &[&str] = &["mp3", "m4a", "wav", "ogg", "aac", "flac"];
    for media in &entry.media {
        for content in &media.content {
            let Some(u) = &content.url else { continue };
            let is_audio_type = content
                .content_type
                .as_ref()
                .is_some_and(|ct| ct.to_string().starts_with("audio/"));
            let is_audio_ext = u
                .path()
                .rsplit('.')
                .next()
                .map(|ext| AUDIO_EXT.contains(&ext.to_ascii_lowercase().as_str()))
                .unwrap_or(false);
            if is_audio_type || is_audio_ext {
                let url = resolve_url(u.as_str(), page_url);
                let duration = content
                    .duration
                    .or(media.duration)
                    .map(|d| d.as_secs() as i64);
                return (url, duration);
            }
        }
    }
    (None, None)
}

/// Strip HTML tags from a string, leaving plain text.
fn strip_html(input: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in input.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(c);
        }
    }
    result.trim().to_string()
}

/// Fetch and parse an RSS/Atom feed from a URL. Shared by the `fetch_rss` preview
/// command and `db_sync_rss_feed`.
async fn fetch_feed_meta(url: &str) -> Result<RssFeedMeta, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    let feed = feed_rs::parser::parse(&body[..]).map_err(|e| format!("Feed parse error: {e}"))?;

    let site_link = feed
        .links
        .first()
        .map(|l| l.href.clone())
        .unwrap_or_default();

    let entries: Vec<RssEntry> = feed
        .entries
        .iter()
        .take(50)
        .map(|e| {
            let links = &e.links;
            let href = links.first().map(|l| l.href.clone()).unwrap_or_default();
            let page_url = if href.is_empty() { &site_link } else { &href };
            let (audio_url, audio_duration) = extract_audio(e, page_url);
            RssEntry {
                title: e
                    .title
                    .as_ref()
                    .map(|t| t.content.clone())
                    .unwrap_or_default(),
                url: href.clone(),
                author: e
                    .authors
                    .first()
                    .map(|a| a.name.clone())
                    .unwrap_or_default(),
                summary: e
                    .summary
                    .as_ref()
                    .map(|s| strip_html(&s.content))
                    .unwrap_or_default(),
                published: e
                    .published
                    .or(e.updated)
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_default(),
                image_url: extract_image(e, page_url),
                audio_url,
                audio_duration,
            }
        })
        .collect();

    Ok(RssFeedMeta {
        title: feed.title.map(|t| t.content).unwrap_or_default(),
        description: feed.description.map(|d| d.content).unwrap_or_default(),
        site_link,
        entries,
    })
}

/// Fetch and parse an RSS/Atom feed from a URL (used for the add-feed preview).
#[tauri::command]
pub async fn fetch_rss(url: String) -> Result<RssFeedMeta, String> {
    fetch_feed_meta(&url).await
}

// ── DB commands ──────────────────────────────────────────────────────────────

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
            "INSERT INTO rss_entries (feed_id, title, url, author, summary, image_url, audio_url, audio_duration, published, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
             ON CONFLICT(url) DO UPDATE SET
               feed_id=excluded.feed_id, title=excluded.title, author=excluded.author,
               summary=excluded.summary, image_url=excluded.image_url,
               audio_url=excluded.audio_url, audio_duration=excluded.audio_duration,
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
        published: row.get(9)?,
        is_read: row.get(10)?,
        fetched_at: row.get(11)?,
    })
}

const RSS_ENTRY_COLUMNS: &str =
    "id, feed_id, title, url, author, summary, image_url, audio_url, audio_duration, published, is_read, fetched_at";

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
