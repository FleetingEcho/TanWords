use crate::db::params;
use rmcp::{handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{json, Value};

use super::TanWordsMcp;
use crate::db;
use crate::mcp::types::{json_text, AddPattern, ListPatterns, SearchPatterns};

#[tool_router(router = patterns_tool_router, vis = "pub(crate)")]
impl TanWordsMcp {
    #[tool(description = "List or filter saved sentence patterns; omit query to see the most recently saved")]
    pub(in crate::mcp) async fn patterns_list(&self, Parameters(input): Parameters<ListPatterns>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let limit = input.limit.min(100) as i64;
            let offset = input.offset as i64;
            let rows: Vec<(i64, Value)> = match input.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
                Some(query) => {
                    let pattern = format!("%{}%", query);
                    db::fetch_all(
                        &conn,
                        "SELECT p.id,p.pattern,p.zh,p.note,p.level,p.created_at
                         FROM patterns p
                         WHERE p.pattern LIKE ?1 OR p.zh LIKE ?1 OR p.note LIKE ?1
                            OR EXISTS(SELECT 1 FROM pattern_examples e WHERE e.pattern_id=p.id AND e.sentence LIKE ?1)
                         ORDER BY p.created_at DESC LIMIT ?2 OFFSET ?3",
                        params![pattern, limit, offset],
                        |row| Ok((row.get::<i64>(0)?, json!({"id":row.get::<i64>(0)?,"pattern":row.get::<String>(1)?,"zh":row.get::<String>(2)?,"note":row.get::<String>(3)?,"level":row.get::<Option<String>>(4)?,"createdAt":row.get::<String>(5)?}))),
                    )
                    .await?
                }
                None => {
                    db::fetch_all(
                        &conn,
                        "SELECT id,pattern,zh,note,level,created_at FROM patterns ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
                        params![limit, offset],
                        |row| Ok((row.get::<i64>(0)?, json!({"id":row.get::<i64>(0)?,"pattern":row.get::<String>(1)?,"zh":row.get::<String>(2)?,"note":row.get::<String>(3)?,"level":row.get::<Option<String>>(4)?,"createdAt":row.get::<String>(5)?}))),
                    )
                    .await?
                }
            };

            let mut items = Vec::with_capacity(rows.len());
            for (id, mut value) in rows {
                let examples = db::fetch_all(
                    &conn,
                    "SELECT sentence,source FROM pattern_examples WHERE pattern_id=?1 ORDER BY id LIMIT 5",
                    [id],
                    |row| Ok(json!({"sentence":row.get::<String>(0)?,"source":row.get::<String>(1)?})),
                )
                .await
                .unwrap_or_default();
                value["examples"] = json!(examples);
                items.push(value);
            }
            Ok(json!({"items": items}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Search the user's saved sentence patterns — reusable English structures they collected, each with a Chinese gloss, a usage note and example sentences. Search by the pattern skeleton, its meaning, or an example."
    )]
    pub(in crate::mcp) async fn patterns_search(&self, Parameters(input): Parameters<SearchPatterns>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let pattern = format!("%{}%", input.query.trim());
            let rows: Vec<(i64, Value)> = db::fetch_all(
                &conn,
                "SELECT p.id,p.pattern,p.zh,p.note,p.level,p.created_at
                 FROM patterns p
                 WHERE p.pattern LIKE ?1 OR p.zh LIKE ?1 OR p.note LIKE ?1
                    OR EXISTS(SELECT 1 FROM pattern_examples e WHERE e.pattern_id=p.id AND e.sentence LIKE ?1)
                 ORDER BY p.created_at DESC LIMIT ?2",
                params![pattern, input.limit.min(100) as i64],
                |row| {
                    Ok((row.get::<i64>(0)?, json!({"id":row.get::<i64>(0)?,"pattern":row.get::<String>(1)?,"zh":row.get::<String>(2)?,"note":row.get::<String>(3)?,"level":row.get::<Option<String>>(4)?,"createdAt":row.get::<String>(5)?})))
                },
            )
            .await?;

            let mut items = Vec::with_capacity(rows.len());
            for (id, mut value) in rows {
                let examples = db::fetch_all(
                    &conn,
                    "SELECT sentence,source FROM pattern_examples WHERE pattern_id=?1 ORDER BY id LIMIT 5",
                    [id],
                    |row| Ok(json!({"sentence":row.get::<String>(0)?,"source":row.get::<String>(1)?})),
                )
                .await
                .unwrap_or_default();
                value["examples"] = json!(examples);
                items.push(value);
            }
            Ok(json!({"items": items}))
        }
        .await;
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Save a sentence pattern to the user's pattern library. Give the reusable skeleton (e.g. 'be shortlisted for + noun'), a Chinese gloss, a short usage note, and the example sentence it came from. An existing identical pattern gains the example instead of being duplicated."
    )]
    pub(in crate::mcp) async fn patterns_add(&self, Parameters(input): Parameters<AddPattern>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let existing: Option<i64> = db::fetch_optional(
                &conn,
                "SELECT id FROM patterns WHERE pattern=?1",
                [input.pattern.clone()],
                |row| row.get(0),
            )
            .await
            .unwrap_or(None);
            let (id, created) = match existing {
                Some(id) => (id, false),
                None => {
                    let id = crate::db::fetch_one(
                        &conn,
                        "INSERT INTO patterns(pattern,zh,note,level) VALUES(?1,?2,?3,?4) RETURNING id",
                        params![input.pattern, input.zh, input.note, input.level],
                        |r| r.get::<i64>(0),
                    )
                    .await?;
                    (id, true)
                }
            };
            if let Some(sentence) = input.example.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                let duplicate: Option<i64> = db::fetch_optional(
                    &conn,
                    "SELECT id FROM pattern_examples WHERE pattern_id=?1 AND sentence=?2",
                    params![id, sentence],
                    |row| row.get(0),
                )
                .await
                .unwrap_or(None);
                if duplicate.is_none() {
                    conn.execute("INSERT INTO pattern_examples(pattern_id,sentence,source) VALUES(?1,?2,'mcp')", params![id, sentence])
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(json!({"id":id,"created":created}))
        }
        .await;
        self.notify("mcp:patterns-changed");
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }
}
