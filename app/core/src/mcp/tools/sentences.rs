use crate::db::params;
use rmcp::{handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{json, Value};

use super::TanWordsMcp;
use crate::db;
use crate::mcp::types::{json_text, AddSentence, ListSentences, SearchSentences};

#[tool_router(router = sentences_tool_router, vis = "pub(crate)")]
impl TanWordsMcp {
    #[tool(description = "List or filter saved sentences; omit query to see the most recently saved")]
    pub(in crate::mcp) async fn sentences_list(&self, Parameters(input): Parameters<ListSentences>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let limit = input.limit.min(100) as i64;
            let offset = input.offset as i64;
            let rows: Vec<Value> = match input.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
                Some(query) => {
                    let pattern = format!("%{}%", query);
                    db::fetch_all(
                        &conn,
                        "SELECT id,sentence,zh,note,level,source,created_at
                         FROM sentences
                         WHERE sentence LIKE ?1 OR zh LIKE ?1 OR note LIKE ?1
                         ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
                        params![pattern, limit, offset],
                        |row| Ok(json!({
                            "id": row.get::<i64>(0)?,
                            "sentence": row.get::<String>(1)?,
                            "zh": row.get::<String>(2)?,
                            "note": row.get::<String>(3)?,
                            "level": row.get::<Option<String>>(4)?,
                            "source": row.get::<String>(5)?,
                            "createdAt": row.get::<String>(6)?,
                        })),
                    )
                    .await?
                }
                None => {
                    db::fetch_all(
                        &conn,
                        "SELECT id,sentence,zh,note,level,source,created_at FROM sentences ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
                        params![limit, offset],
                        |row| Ok(json!({
                            "id": row.get::<i64>(0)?,
                            "sentence": row.get::<String>(1)?,
                            "zh": row.get::<String>(2)?,
                            "note": row.get::<String>(3)?,
                            "level": row.get::<Option<String>>(4)?,
                            "source": row.get::<String>(5)?,
                            "createdAt": row.get::<String>(6)?,
                        })),
                    )
                    .await?
                }
            };
            Ok(json!({"items": rows}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Search the user's saved sentences — English sentences they collected from websites or chat, each with a Chinese translation, a usage note and a level. Search by the sentence text, its meaning, or a note."
    )]
    pub(in crate::mcp) async fn sentences_search(&self, Parameters(input): Parameters<SearchSentences>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let pattern = format!("%{}%", input.query.trim());
            let rows: Vec<Value> = db::fetch_all(
                &conn,
                "SELECT id,sentence,zh,note,level,source,created_at
                 FROM sentences
                 WHERE sentence LIKE ?1 OR zh LIKE ?1 OR note LIKE ?1
                 ORDER BY created_at DESC LIMIT ?2",
                params![pattern, input.limit.min(100) as i64],
                |row| {
                    Ok(json!({
                        "id": row.get::<i64>(0)?,
                        "sentence": row.get::<String>(1)?,
                        "zh": row.get::<String>(2)?,
                        "note": row.get::<String>(3)?,
                        "level": row.get::<Option<String>>(4)?,
                        "source": row.get::<String>(5)?,
                        "createdAt": row.get::<String>(6)?,
                    }))
                },
            )
            .await?;
            Ok(json!({"items": rows}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Save a sentence to the user's sentence library. Give the English sentence, a Chinese translation, a short usage note, and a level. An existing identical sentence is not duplicated."
    )]
    pub(in crate::mcp) async fn sentences_add(&self, Parameters(input): Parameters<AddSentence>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let sentence = input.sentence.trim();
            if sentence.is_empty() {
                return Err("empty sentence".into());
            }
            let existing: Option<i64> = db::fetch_optional(
                &conn,
                "SELECT id FROM sentences WHERE sentence=?1",
                [sentence],
                |row| row.get(0),
            )
            .await
            .unwrap_or(None);
            let (id, created) = match existing {
                Some(id) => (id, false),
                None => {
                    let id = crate::db::fetch_one(
                        &conn,
                        "INSERT INTO sentences(sentence,zh,note,level,source) VALUES(?1,?2,?3,?4,'mcp') RETURNING id",
                        params![sentence, input.zh, input.note, input.level],
                        |r| r.get::<i64>(0),
                    )
                    .await?;
                    (id, true)
                }
            };
            Ok(json!({"id":id,"created":created}))
        }
        .await;
        self.notify("mcp:sentences-changed");
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }
}
