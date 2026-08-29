use crate::db::params;
use rmcp::{handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{json, Value};

use super::TanWordsMcp;
use crate::db;
use crate::mcp::types::{
    json_text, AppendDocument, CreateDocument, GetDocument, ListDocuments, SearchDocuments,
    UpdateDocument,
};

#[tool_router(router = documents_tool_router, vis = "pub(crate)")]
impl TanWordsMcp {
    #[tool(description = "List or full-text search documents; omit query to see the most recently updated")]
    pub(in crate::mcp) async fn documents_list(&self, Parameters(input): Parameters<ListDocuments>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let limit = input.limit.min(100) as i64;
            let offset = input.offset as i64;
            let items = match input.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
                Some(query) => {
                    // FTS5 search is SQLite-only (no `documents_fts` virtual
                    // table on Postgres; tsvector is the follow-up port).
                    if conn.kind() == crate::db::DbKind::Postgres {
                        return Err("Full-text search is not yet supported on the Postgres backend".into());
                    }
                    let terms = crate::db::fts_match_query(query);
                    if terms.is_empty() {
                        Vec::new()
                    } else {
                        db::fetch_all(
                            &conn,
                            "SELECT d.id,d.title,d.tags,d.pinned,d.word_count,d.updated_at,
                                    snippet(documents_fts,1,'','','…',24)
                             FROM documents_fts f JOIN documents d ON d.id=f.rowid
                             WHERE documents_fts MATCH ?1 AND d.protected=0
                               AND (?2 IS NULL OR EXISTS(SELECT 1 FROM json_each(d.tags) WHERE value=?2))
                             ORDER BY d.pinned DESC, bm25(documents_fts)
                             LIMIT ?3 OFFSET ?4",
                            params![terms, input.tag, limit, offset],
                            |row| Ok(json!({"id":row.get::<i64>(0)?,"title":row.get::<String>(1)?,"tags":serde_json::from_str::<Value>(&row.get::<String>(2)?).unwrap_or(json!([])),"pinned":row.get::<i64>(3)?!=0,"wordCount":row.get::<i64>(4)?,"updatedAt":row.get::<String>(5)?,"excerpt":row.get::<String>(6)?})),
                        )
                        .await?
                    }
                }
                None => {
                    db::fetch_all(
                        &conn,
                        "SELECT id,title,tags,pinned,word_count,updated_at,'' FROM documents
                         WHERE protected=0
                           AND (?1 IS NULL OR EXISTS(SELECT 1 FROM json_each(tags) WHERE value=?1))
                         ORDER BY pinned DESC, updated_at DESC LIMIT ?2 OFFSET ?3",
                        params![input.tag, limit, offset],
                        |row| Ok(json!({"id":row.get::<i64>(0)?,"title":row.get::<String>(1)?,"tags":serde_json::from_str::<Value>(&row.get::<String>(2)?).unwrap_or(json!([])),"pinned":row.get::<i64>(3)?!=0,"wordCount":row.get::<i64>(4)?,"updatedAt":row.get::<String>(5)?,"excerpt":row.get::<String>(6)?})),
                    )
                    .await?
                }
            };
            Ok(json!({"items": items}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Full-text search of TanWords documents by title and body, optionally filtered by tag. Ranked by relevance; returns a matching snippet."
    )]
    pub(in crate::mcp) async fn documents_search(&self, Parameters(input): Parameters<SearchDocuments>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            // FTS5 search is SQLite-only (no `documents_fts` virtual table on
            // Postgres; tsvector is the follow-up port).
            if conn.kind() == crate::db::DbKind::Postgres {
                return Err("Full-text search is not yet supported on the Postgres backend".into());
            }
            // The app maintains a documents_fts index (see db::init_db). The
            // old character-interleaved LIKE ("%a%p%i%") matched almost every
            // document for a short query and could not rank them; FTS gives
            // both relevance ordering and a snippet worth showing the agent.
            let terms = crate::db::fts_match_query(&input.query);
            if terms.is_empty() {
                return Ok(json!({"items": []}));
            }
            let items = db::fetch_all(
                &conn,
                "SELECT d.id,d.title,d.tags,d.pinned,d.word_count,d.created_at,d.updated_at,
                        snippet(documents_fts,1,'','','…',24)
                 FROM documents_fts f
                 JOIN documents d ON d.id = f.rowid
                 WHERE documents_fts MATCH ?1
                   AND d.protected=0
                   AND (?2 IS NULL OR EXISTS(SELECT 1 FROM json_each(d.tags) WHERE value=?2))
                 ORDER BY d.pinned DESC, bm25(documents_fts)
                 LIMIT ?3",
                params![terms, input.tag, input.limit.min(100) as i64],
                |row| Ok(json!({"id":row.get::<i64>(0)?,"title":row.get::<String>(1)?,"tags":serde_json::from_str::<Value>(&row.get::<String>(2)?).unwrap_or(json!([])),"pinned":row.get::<i64>(3)?!=0,"wordCount":row.get::<i64>(4)?,"createdAt":row.get::<String>(5)?,"updatedAt":row.get::<String>(6)?,"excerpt":row.get::<String>(7)?})),
            )
            .await?;
            Ok(json!({"items": items}))
        }
        .await;
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Read a TanWords document by unique ID; content is returned as Markdown when available"
    )]
    pub(in crate::mcp) async fn documents_get(&self, Parameters(input): Parameters<GetDocument>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            db::fetch_one(
                &conn,
                "SELECT id,title,content,content_text,tags,pinned,word_count,created_at,updated_at FROM documents WHERE id=?1 AND protected=0",
                [input.id],
                |row| Ok(json!({"id":row.get::<i64>(0)?,"title":row.get::<String>(1)?,"content":row.get::<String>(2)?,"text":row.get::<String>(3)?,"tags":serde_json::from_str::<Value>(&row.get::<String>(4)?).unwrap_or(json!([])),"pinned":row.get::<i64>(5)?!=0,"wordCount":row.get::<i64>(6)?,"createdAt":row.get::<String>(7)?,"updatedAt":row.get::<String>(8)?})),
            )
            .await
            .map_err(|_| "Document not found".to_string())
        }
        .await;
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Create a new TanWords document from Markdown; duplicate titles are allowed"
    )]
    pub(in crate::mcp) async fn documents_create(&self, Parameters(input): Parameters<CreateDocument>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let tags = serde_json::to_string(&input.tags).map_err(|e| e.to_string())?;
            // `content_text` is what the Documents list preview shows, and the
            // word count follows the editor's convention (CJK per character,
            // markdown structure dropped) — not a raw split on the Markdown.
            let content_text = crate::mcp::markdown_blocks::markdown_plain_text(&input.content);
            let count = crate::mcp::markdown_blocks::markdown_word_count(&content_text);
            let id = crate::db::fetch_one(
                &conn,
                "INSERT INTO documents(title,content,content_text,tags,word_count) VALUES(?1,?2,?3,?4,?5) RETURNING id",
                params![input.title, input.content, content_text, tags, count],
                |r| r.get::<i64>(0),
            )
            .await?;
            Ok(json!({"id":id,"created":true}))
        }
        .await;
        self.notify("mcp:docs-changed");
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Update a TanWords document by unique ID, with optional optimistic concurrency protection"
    )]
    pub(in crate::mcp) async fn documents_update(&self, Parameters(input): Parameters<UpdateDocument>) -> String {
        let out = self.update_document(input).await;
        self.notify("mcp:docs-changed");
        out
    }

    #[tool(description = "Append Markdown to the end of an existing TanWords document")]
    pub(in crate::mcp) async fn documents_append(&self, Parameters(input): Parameters<AppendDocument>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let (content, content_text) = db::fetch_one(
                &conn,
                "SELECT content,content_text FROM documents WHERE id=?1 AND protected=0",
                [input.id],
                |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?)),
            )
            .await
            .map_err(|_| "Document not found".to_string())?;
            // Appending has to respect how the body is stored. `content` is
            // the app's block JSON for every editor-created document;
            // concatenating Markdown onto it makes the column un-parseable
            // and the editor then renders (and re-saves) the whole document
            // as a dump of raw JSON. Legacy Lexical JSON ({"root":…}) cannot
            // be merged into at all — refuse rather than corrupt.
            let (new_content, new_text) = match serde_json::from_str::<Value>(&content) {
                Ok(Value::Array(mut blocks)) => {
                    let mut appended =
                        crate::mcp::markdown_blocks::markdown_to_blocks(&input.content);
                    blocks.append(&mut appended);
                    let text = format!(
                        "{}\n{}",
                        content_text.trim_end(),
                        crate::mcp::markdown_blocks::markdown_plain_text(&input.content).trim()
                    );
                    (serde_json::to_string(&blocks).map_err(|e| e.to_string())?, text)
                }
                Ok(Value::Object(_)) => {
                    return Err(
                        "Document uses a legacy editor format; open and save it in the app once, then append"
                            .into(),
                    );
                }
                _ => (
                    format!("{}\n\n{}", content, input.content),
                    format!("{}\n\n{}", content_text, input.content),
                ),
            };
            let count = crate::mcp::markdown_blocks::markdown_word_count(&new_text);
            let changed = conn.execute(
                "UPDATE documents SET content=?1,content_text=?2,word_count=?3,updated_at=datetime('now') WHERE id=?4 AND protected=0",
                params![new_content, new_text, count, input.id],
            )
            .await
            .map_err(|e| e.to_string())?;
            if changed == 0 {
                return Err("Document not found".into());
            }
            Ok(json!({"id":input.id,"updated":true}))
        }
        .await;
        self.notify("mcp:docs-changed");
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(description = "Delete a TanWords document by its unique ID")]
    pub(in crate::mcp) async fn documents_delete(&self, Parameters(input): Parameters<GetDocument>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let changed = conn
                .execute("DELETE FROM documents WHERE id=?1 AND protected=0", [input.id])
                .await
                .map_err(|e| e.to_string())?;
            if changed == 0 {
                return Err("Document not found".into());
            }
            Ok(json!({"id":input.id,"deleted":true}))
        }
        .await;
        self.notify("mcp:docs-changed");
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    pub(in crate::mcp) async fn update_document(&self, input: UpdateDocument) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let current: (String, String, String, String) = db::fetch_one(
                &conn,
                "SELECT title,content,tags,updated_at FROM documents WHERE id=?1 AND protected=0",
                [input.id],
                |row| {
                    Ok((
                        row.get::<String>(0)?,
                        row.get::<String>(1)?,
                        row.get::<String>(2)?,
                        row.get::<String>(3)?,
                    ))
                },
            )
            .await
            .map_err(|_| "Document not found".to_string())?;
            let expected = input.expected_updated_at.clone();
            if expected
                .as_deref()
                .is_some_and(|value| value != current.3)
            {
                return Err(format!("Conflict: document was updated at {}", current.3));
            }
            let title = input.title.unwrap_or(current.0);
            let tags = input
                .tags
                .map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "[]".into()))
                .unwrap_or(current.2);
            // A body handed back as a block array is stored verbatim (an agent
            // round-tripping what documents_get returned); Markdown is kept as
            // Markdown for Markdown documents, and converted to blocks when
            // the document is in the block format, so one write cannot flip
            // the document between formats.
            let current_is_blocks = matches!(
                serde_json::from_str::<Value>(&current.1),
                Ok(Value::Array(_))
            );
            let content = input.content.unwrap_or(current.1);
            let (stored_content, content_text) = match serde_json::from_str::<Value>(&content) {
                Ok(Value::Array(blocks)) => (
                    content,
                    crate::mcp::markdown_blocks::blocks_plain_text(&blocks),
                ),
                _ if current_is_blocks => {
                    let blocks =
                        crate::mcp::markdown_blocks::markdown_to_blocks(&content);
                    (
                        serde_json::to_string(&blocks).map_err(|e| e.to_string())?,
                        crate::mcp::markdown_blocks::blocks_plain_text(&blocks),
                    )
                }
                _ => {
                    let text = crate::mcp::markdown_blocks::markdown_plain_text(&content);
                    (content, text)
                }
            };
            let count = crate::mcp::markdown_blocks::markdown_word_count(&content_text);
            // The expected_updated_at guard is repeated inside the UPDATE so
            // a write landing between the SELECT and this statement cannot
            // slip past the pre-check (TOCTOU).
            let changed = conn.execute(
                "UPDATE documents SET title=?1,content=?2,content_text=?3,tags=?4,word_count=?5,updated_at=datetime('now')
                 WHERE id=?6 AND (?7 IS NULL OR updated_at=?7) AND protected=0",
                params![
                    title,
                    stored_content,
                    content_text,
                    tags,
                    count,
                    input.id,
                    expected
                ],
            )
            .await
            .map_err(|e| e.to_string())?;
            if changed == 0 {
                let exists = db::scalar_i64(
                    &conn,
                    "SELECT COUNT(*) FROM documents WHERE id=?1",
                    [input.id],
                )
                .await?;
                if exists == 0 {
                    return Err("Document not found".into());
                }
                return Err("Conflict: the document was modified while it was being updated".into());
            }
            Ok(json!({"id":input.id,"updated":true}))
        }
        .await;
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }
}
