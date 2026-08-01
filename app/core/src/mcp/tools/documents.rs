use libsql::params;
use rmcp::{handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{json, Value};

use super::TanWordsMcp;
use crate::db;
use crate::mcp::types::{
    json_text, fts_query, AppendDocument, CreateDocument, GetDocument, ListDocuments, SearchDocuments,
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
                    let terms = fts_query(query);
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
            // The app maintains a documents_fts index (see db::init_db). The
            // old character-interleaved LIKE ("%a%p%i%") matched almost every
            // document for a short query and could not rank them; FTS gives
            // both relevance ordering and a snippet worth showing the agent.
            let terms = fts_query(&input.query);
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
            let count = input.content.split_whitespace().count() as i64;
            conn.execute("INSERT INTO documents(title,content,content_text,tags,word_count) VALUES(?1,?2,?2,?3,?4)",params![input.title,input.content,tags,count])
                .await
                .map_err(|e|e.to_string())?;
            Ok(json!({"id":conn.last_insert_rowid(),"created":true}))
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
            let changed = conn.execute("UPDATE documents SET content=content||'\n\n'||?1,content_text=content_text||'\n\n'||?1,word_count=word_count+?2,updated_at=datetime('now') WHERE id=?3 AND protected=0",params![input.content.clone(),input.content.split_whitespace().count() as i64,input.id])
                .await
                .map_err(|e|e.to_string())?;
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
            if input
                .expected_updated_at
                .as_deref()
                .is_some_and(|expected| expected != current.3)
            {
                return Err(format!("Conflict: document was updated at {}", current.3));
            }
            let title = input.title.unwrap_or(current.0);
            let content = input.content.unwrap_or(current.1);
            let tags = input
                .tags
                .map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "[]".into()))
                .unwrap_or(current.2);
            let count = content.split_whitespace().count() as i64;
            conn.execute("UPDATE documents SET title=?1,content=?2,content_text=?2,tags=?3,word_count=?4,updated_at=datetime('now') WHERE id=?5",params![title,content,tags,count,input.id])
                .await
                .map_err(|e|e.to_string())?;
            Ok(json!({"id":input.id,"updated":true}))
        }
        .await;
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }
}
