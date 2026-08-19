use crate::db::params;
use rmcp::{handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{json, Value};

use super::TanWordsMcp;
use crate::db;
use crate::mcp::types::{json_text, ListFeedEntries, ListFeeds};

#[tool_router(router = feeds_tool_router, vis = "pub(crate)")]
impl TanWordsMcp {
    #[tool(description = "List the user's subscribed RSS/podcast feeds")]
    pub(in crate::mcp) async fn feeds_list(&self, _input: Parameters<ListFeeds>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let items = db::fetch_all(
                &conn,
                "SELECT id,title,url,site_link,description,last_fetched_at,created_at,
                        EXISTS(SELECT 1 FROM rss_entries e WHERE e.feed_id=rss_feeds.id AND e.audio_url IS NOT NULL) AS is_podcast,
                        category_override,is_pinned,pin_order
                 FROM rss_feeds ORDER BY is_pinned DESC, pin_order ASC, created_at DESC",
                (),
                |row| Ok(json!({
                    "id": row.get::<i64>(0)?,
                    "title": row.get::<String>(1)?,
                    "url": row.get::<String>(2)?,
                    "siteLink": row.get::<String>(3)?,
                    "description": row.get::<String>(4)?,
                    "lastFetchedAt": row.get::<Option<String>>(5)?,
                    "createdAt": row.get::<String>(6)?,
                    "isPodcast": row.get::<i64>(7)? != 0,
                    "categoryOverride": row.get::<Option<String>>(8)?,
                    "isPinned": row.get::<i64>(9)? != 0,
                    "pinOrder": row.get::<Option<i64>>(10)?,
                })),
            )
            .await?;
            Ok(json!({"items": items}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(description = "List cached entries from the user's RSS/podcast feeds, newest first")]
    pub(in crate::mcp) async fn feeds_entries(&self, Parameters(input): Parameters<ListFeedEntries>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let limit = input.limit.min(200) as i64;
            let offset = input.offset as i64;
            let items = match input.feed_id {
                Some(feed_id) => db::fetch_all(
                    &conn,
                    "SELECT id,feed_id,title,url,author,summary,image_url,audio_url,audio_duration,hn_item_id,published,is_read,fetched_at
                     FROM rss_entries WHERE feed_id=?1 ORDER BY published DESC LIMIT ?2 OFFSET ?3",
                    params![feed_id, limit, offset],
                    map_entry,
                )
                .await?,
                None => db::fetch_all(
                    &conn,
                    "SELECT id,feed_id,title,url,author,summary,image_url,audio_url,audio_duration,hn_item_id,published,is_read,fetched_at
                     FROM rss_entries ORDER BY published DESC LIMIT ?1 OFFSET ?2",
                    params![limit, offset],
                    map_entry,
                )
                .await?,
            };
            Ok(json!({"items": items}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }
}

fn map_entry(row: &crate::db::Row) -> crate::db::DbResult<Value> {
    Ok(json!({
        "id": row.get::<i64>(0)?,
        "feedId": row.get::<i64>(1)?,
        "title": row.get::<String>(2)?,
        "url": row.get::<String>(3)?,
        "author": row.get::<String>(4)?,
        "summary": row.get::<String>(5)?,
        "imageUrl": row.get::<Option<String>>(6)?,
        "audioUrl": row.get::<Option<String>>(7)?,
        "audioDuration": row.get::<Option<i64>>(8)?,
        "hnItemId": row.get::<Option<i64>>(9)?,
        "published": row.get::<String>(10)?,
        "isRead": row.get::<i64>(11)? != 0,
        "fetchedAt": row.get::<String>(12)?,
    }))
}
