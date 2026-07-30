use rmcp::{handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{json, Value};

use super::TanWordsMcp;
use crate::db;
use crate::mcp::types::{json_text, AddArticle, AddArticleComment, GetArticle, ListArticles};

fn article_row(row: &libsql::Row) -> libsql::Result<Value> {
    Ok(json!({
        "id": row.get::<i64>(0)?,
        "title": row.get::<String>(1)?,
        "wordCount": row.get::<i64>(2)?,
        "source": row.get::<String>(3)?,
        "lastReadAt": row.get::<String>(4)?,
        "commentCount": row.get::<i64>(5)?,
        "excerpt": row.get::<String>(6)?,
    }))
}

#[tool_router(router = articles_tool_router, vis = "pub(crate)")]
impl TanWordsMcp {
    #[tool(
        description = "Save an article to the user's reading library so they can read it in TanWords later. Re-adding the same article returns the existing entry instead of duplicating it."
    )]
    pub(in crate::mcp) async fn articles_add(&self, Parameters(input): Parameters<AddArticle>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let tags = serde_json::to_string(&input.tags).unwrap_or_else(|_| "[]".into());
            let (id, created) = db::upsert_article(
                &conn,
                input.title.trim(),
                &input.content,
                "mcp",
                input.source_url.as_deref().unwrap_or(""),
                &tags,
            )
            .await?;
            Ok(json!({"id": id, "created": created}))
        }
        .await;
        self.notify("mcp:articles-changed");
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "List or full-text search the user's reading library. Returns titles, sizes, sources and how many notes each article carries — not the article bodies."
    )]
    pub(in crate::mcp) async fn articles_list(&self, Parameters(input): Parameters<ListArticles>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let terms = input.query.as_deref().map(db::fts_match_query).filter(|t| !t.is_empty());
            let limit = input.limit.min(100) as i64;
            let rows = match terms {
                Some(terms) => {
                    db::fetch_all(
                        &conn,
                        "SELECT a.id,a.title,a.word_count,a.source,a.last_read_at,
                                (SELECT COUNT(*) FROM reading_article_comments c WHERE c.article_id=a.id),
                                snippet(reading_articles_fts,1,'','','…',22)
                         FROM reading_articles_fts f JOIN reading_articles a ON a.id=f.rowid
                         WHERE reading_articles_fts MATCH ?1
                         ORDER BY bm25(reading_articles_fts) LIMIT ?2",
                        libsql::params![terms, limit],
                        article_row,
                    )
                    .await?
                }
                None => {
                    db::fetch_all(
                        &conn,
                        "SELECT a.id,a.title,a.word_count,a.source,a.last_read_at,
                                (SELECT COUNT(*) FROM reading_article_comments c WHERE c.article_id=a.id),
                                ''
                         FROM reading_articles a ORDER BY a.last_read_at DESC LIMIT ?1",
                        libsql::params![limit],
                        article_row,
                    )
                    .await?
                }
            };
            Ok(json!({"items": rows}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(description = "Read one article from the reading library, optionally with the notes left on it")]
    pub(in crate::mcp) async fn articles_get(&self, Parameters(input): Parameters<GetArticle>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let mut article = db::fetch_one(
                &conn,
                "SELECT id,title,content,word_count,source,source_url,tags,created_at,last_read_at
                 FROM reading_articles WHERE id=?1",
                [input.id],
                |row| Ok(json!({"id":row.get::<i64>(0)?,"title":row.get::<String>(1)?,"content":row.get::<String>(2)?,"wordCount":row.get::<i64>(3)?,"source":row.get::<String>(4)?,"sourceUrl":row.get::<String>(5)?,"tags":serde_json::from_str::<Value>(&row.get::<String>(6)?).unwrap_or(json!([])),"createdAt":row.get::<String>(7)?,"lastReadAt":row.get::<String>(8)?})),
            )
            .await
            .map_err(|_| "Article not found".to_string())?;
            if input.with_comments {
                let comments = db::fetch_all(
                    &conn,
                    "SELECT id,author,body,anchor_text,created_at FROM reading_article_comments WHERE article_id=?1 ORDER BY created_at",
                    [input.id],
                    |row| Ok(json!({"id":row.get::<i64>(0)?,"author":row.get::<String>(1)?,"body":row.get::<String>(2)?,"anchorText":row.get::<Option<String>>(3)?,"createdAt":row.get::<String>(4)?})),
                )
                .await?;
                article["comments"] = json!(comments);
            }
            Ok(json!({"article": article}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Leave a note on an article in the reading library — a summary of the whole piece, or an explanation of one sentence. Pass anchor_text with the exact sentence to attach the note beside it while the user reads."
    )]
    pub(in crate::mcp) async fn articles_comment(&self, Parameters(input): Parameters<AddArticleComment>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let id = db::insert_comment(&conn, input.article_id, "ai", &input.body, input.anchor_text.as_deref()).await?;
            Ok(json!({"id": id, "created": true}))
        }
        .await;
        self.notify("mcp:articles-changed");
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }
}
