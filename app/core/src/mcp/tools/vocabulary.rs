use libsql::params;
use rmcp::{handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{json, Value};

use super::TanWordsMcp;
use crate::db;
use crate::mcp::types::{json_text, AddVocabulary, AddVocabularyBatch, GetVocabulary, SearchVocabulary, UpdateVocabulary};

#[tool_router(router = vocabulary_tool_router, vis = "pub(crate)")]
impl TanWordsMcp {
    #[tool(
        description = "Fuzzy-search the user's TanWords vocabulary by English word or Chinese meaning"
    )]
    pub(in crate::mcp) async fn vocabulary_search(&self, Parameters(input): Parameters<SearchVocabulary>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let pattern = format!("%{}%", input.query.trim());
            let items = db::fetch_all(
                &conn,
                "SELECT w.id,w.word,w.word_type,w.level,COALESCE((SELECT zh FROM word_definitions WHERE word_id=w.id ORDER BY sort_order LIMIT 1),''),w.source,w.created_at,w.updated_at FROM words w WHERE w.word LIKE ?1 OR EXISTS(SELECT 1 FROM word_definitions d WHERE d.word_id=w.id AND d.zh LIKE ?1) ORDER BY w.updated_at DESC LIMIT ?2",
                params![pattern, input.limit.min(100) as i64],
                |row| Ok(json!({"id":row.get::<i64>(0)?,"word":row.get::<String>(1)?,"wordType":row.get::<Option<String>>(2)?,"level":row.get::<Option<String>>(3)?,"zh":row.get::<String>(4)?,"source":row.get::<Option<String>>(5)?,"createdAt":row.get::<String>(6)?,"updatedAt":row.get::<String>(7)?})),
            )
            .await?;
            Ok(json!({"items": items}))
        }
        .await;
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(description = "Get complete details for one vocabulary item by its unique ID")]
    pub(in crate::mcp) async fn vocabulary_get(&self, Parameters(input): Parameters<GetVocabulary>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let word = db::fetch_one(
                &conn,
                "SELECT id,word,word_type,level,notes,source,created_at,enrichment_text FROM words WHERE id=?1",
                [input.id],
                |row| Ok(json!({"id":row.get::<i64>(0)?,"word":row.get::<String>(1)?,"wordType":row.get::<Option<String>>(2)?,"level":row.get::<Option<String>>(3)?,"notes":row.get::<Option<String>>(4)?,"source":row.get::<Option<String>>(5)?,"createdAt":row.get::<String>(6)?,"enrichment":row.get::<Option<String>>(7)?})),
            )
            .await
            .map_err(|_| "Vocabulary item not found".to_string())?;
            let definitions = db::fetch_all(
                &conn,
                "SELECT pos,zh,en,example_en,example_zh FROM word_definitions WHERE word_id=?1 ORDER BY sort_order",
                [input.id],
                |row| Ok(json!({"pos":row.get::<String>(0)?,"zh":row.get::<String>(1)?,"en":row.get::<String>(2)?,"exampleEn":row.get::<String>(3)?,"exampleZh":row.get::<String>(4)?})),
            )
            .await?;
            Ok(json!({"item":word,"definitions":definitions}))
        }
        .await;
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Add one vocabulary item to TanWords; returns the existing ID when the word already exists"
    )]
    pub(in crate::mcp) async fn vocabulary_add(&self, Parameters(input): Parameters<AddVocabulary>) -> String {
        let out = self.add_words(vec![input], None).await;
        self.notify("mcp:vocab-changed");
        out
    }

    #[tool(description = "Add multiple vocabulary items to TanWords in one transaction")]
    pub(in crate::mcp) async fn vocabulary_add_batch(
        &self,
        Parameters(input): Parameters<AddVocabularyBatch>,
    ) -> String {
        let out = self.add_words(input.words, input.tag).await;
        self.notify("mcp:vocab-changed");
        out
    }

    #[tool(description = "Update one vocabulary item's meaning, part of speech, level or notes")]
    pub(in crate::mcp) async fn vocabulary_update(&self, Parameters(input): Parameters<UpdateVocabulary>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let changed = conn
                .execute(
                    "UPDATE words SET word_type=COALESCE(?2,word_type), level=COALESCE(?3,level),
                            notes=COALESCE(?4,notes), updated_at=datetime('now') WHERE id=?1",
                    params![input.id, input.word_type, input.level, input.notes],
                )
                .await
                .map_err(|e| e.to_string())?;
            if changed == 0 {
                return Err("Vocabulary item not found".into());
            }
            if let Some(zh) = input.zh.as_deref() {
                // The first definition is the one every list in the app shows.
                let updated = conn
                    .execute(
                        "UPDATE word_definitions SET zh=?2 WHERE word_id=?1 AND sort_order=(SELECT MIN(sort_order) FROM word_definitions WHERE word_id=?1)",
                        params![input.id, zh],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                if updated == 0 {
                    conn.execute("INSERT INTO word_definitions(word_id,pos,zh,sort_order) VALUES(?1,'other',?2,0)", params![input.id, zh])
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(json!({"id":input.id,"updated":true}))
        }
        .await;
        self.notify("mcp:vocab-changed");
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(description = "Delete one vocabulary item from TanWords by its unique ID")]
    pub(in crate::mcp) async fn vocabulary_delete(&self, Parameters(input): Parameters<GetVocabulary>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let changed = conn
                .execute("DELETE FROM words WHERE id=?1", [input.id])
                .await
                .map_err(|e| e.to_string())?;
            if changed == 0 {
                return Err("Vocabulary item not found".into());
            }
            Ok(json!({"id":input.id,"deleted":true}))
        }
        .await;
        self.notify("mcp:vocab-changed");
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    pub(in crate::mcp) async fn add_words(&self, words: Vec<AddVocabulary>, tag: Option<String>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let tx = conn.transaction().await.map_err(|e| e.to_string())?;
            let mut items = vec![];
            for item in words {
                let normalized = item.word.trim().to_lowercase();
                if normalized.is_empty() {
                    continue;
                }
                let existing: Option<i64> = db::fetch_optional(
                    &tx,
                    "SELECT id FROM words WHERE LOWER(word)=?1",
                    [normalized.clone()],
                    |row| row.get(0),
                )
                .await
                .unwrap_or(None);
                if let Some(id) = existing {
                    items.push(json!({"id":id,"word":normalized,"created":false}));
                    continue;
                }
                let tags = serde_json::to_string(&tag.iter().collect::<Vec<_>>())
                    .unwrap_or_else(|_| "[]".into());
                tx.execute("INSERT INTO words(word,word_type,level,word_freq,source,tags) VALUES(?1,?2,?3,1,'mcp',?4)",params![normalized.clone(),item.word_type,item.level,tags])
                    .await
                    .map_err(|e|e.to_string())?;
                let id = tx.last_insert_rowid();
                tx.execute("INSERT INTO word_definitions(word_id,pos,zh,example_en,sort_order) VALUES(?1,'other',?2,?3,0)",params![id,item.zh,item.context])
                    .await
                    .map_err(|e|e.to_string())?;
                items.push(json!({"id":id,"word":normalized,"created":true}));
            }
            tx.commit().await.map_err(|e| e.to_string())?;
            Ok(json!({"items":items}))
        }
        .await;
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }
}
