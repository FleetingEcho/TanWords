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

/// Fetch and parse an RSS/Atom feed from a URL.
#[tauri::command]
pub async fn fetch_rss(url: String) -> Result<RssFeedMeta, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    let feed = feed_rs::parser::parse(&body[..]).map_err(|e| format!("Feed parse error: {e}"))?;

    let entries: Vec<RssEntry> = feed
        .entries
        .iter()
        .take(50)
        .map(|e| {
            let links = &e.links;
            let href = links.first().map(|l| l.href.clone()).unwrap_or_default();
            RssEntry {
                title: e.title.as_ref().map(|t| t.content.clone()).unwrap_or_default(),
                url: href,
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
            }
        })
        .collect();

    Ok(RssFeedMeta {
        title: feed.title.map(|t| t.content).unwrap_or_default(),
        description: feed
            .description
            .map(|d| d.content)
            .unwrap_or_default(),
        site_link: feed
            .links
            .first()
            .map(|l| l.href.clone())
            .unwrap_or_default(),
        entries,
    })
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
        "INSERT INTO rss_feeds (url, title, site_link, description) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(url) DO UPDATE SET title=excluded.title, site_link=excluded.site_link, description=excluded.description",
        rusqlite::params![url, title, site_link, description],
    )
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn db_get_rss_feeds(conn: State<'_, AppState>) -> Result<Vec<RssFeed>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare("SELECT id, title, url, site_link, description, last_fetched_at, created_at FROM rss_feeds ORDER BY created_at DESC")
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
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
