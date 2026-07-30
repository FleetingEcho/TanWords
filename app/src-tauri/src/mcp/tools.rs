use std::sync::Arc;

use libsql::{params, Connection};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ServerHandler,
};
use serde_json::{json, Value};

use crate::db;

use super::types::{
    fts_query, json_text, AddArticle, AddArticleComment, AddPattern, GetArticle, ListArticles, AddVocabulary, AddVocabularyBatch, AppendDocument,
    CreateDocument, GetDocument, GetVocabulary, SearchDocuments, SearchPatterns, SearchVocabulary,
    UpdateDocument, UpdateVocabulary,
};

/// Called after every write so the running app can reload the affected list.
/// A plain callback rather than an AppHandle: the tools then know nothing
/// about Tauri, and tests can pass a no-op instead of booting a runtime.
pub type ChangeNotifier = Arc<dyn Fn(&str) + Send + Sync>;

/// Hands back the app's *current* database connection.
///
/// A callback rather than a stored `Connection` for the same reason the
/// notifier is one — and because `db_switch_path` / `db_connect_turso` can
/// swap the database underneath a long-running MCP server. Resolving per call
/// means an outside agent always talks to the database the user is actually
/// looking at, instead of one that was current when the server started.
pub type ConnProvider = Arc<dyn Fn() -> Result<Connection, String> + Send + Sync>;

#[derive(Clone)]
pub struct TanWordsMcp {
    conn: ConnProvider,
    /// Without this, words or documents written by an outside agent don't
    /// show up until the user navigates away and back.
    notifier: ChangeNotifier,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl TanWordsMcp {
    pub fn new(conn: ConnProvider, notifier: ChangeNotifier) -> Self {
        Self {
            conn,
            notifier,
            tool_router: Self::tool_router(),
        }
    }

    /// Fire-and-forget refresh signal for the UI. The frontend listens for
    /// these (see useMcpSync) and reloads the affected list.
    fn notify(&self, event: &str) {
        (self.notifier)(event);
    }

    /// One connection per request. The provider hands out a fresh connection
    /// (its own Hrana stream on Turso) so MCP traffic never shares a stream
    /// with the UI's commands — see `db::txn_conn` for the failure mode.
    async fn connect(&self) -> Result<Connection, String> {
        let conn = (self.conn)()?;
        // Advisory, mirroring `connection::apply_pragmas` — a replica may
        // reject it, which is fine.
        let _ = conn.execute_batch("PRAGMA foreign_keys=ON;").await;
        Ok(conn)
    }

    #[tool(
        description = "Fuzzy-search the user's TanWords vocabulary by English word or Chinese meaning"
    )]
    pub(super) async fn vocabulary_search(&self, Parameters(input): Parameters<SearchVocabulary>) -> String {
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
    pub(super) async fn vocabulary_get(&self, Parameters(input): Parameters<GetVocabulary>) -> String {
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
    pub(super) async fn vocabulary_add(&self, Parameters(input): Parameters<AddVocabulary>) -> String {
        let out = self.add_words(vec![input], None).await;
        self.notify("mcp:vocab-changed");
        out
    }

    #[tool(description = "Add multiple vocabulary items to TanWords in one transaction")]
    pub(super) async fn vocabulary_add_batch(
        &self,
        Parameters(input): Parameters<AddVocabularyBatch>,
    ) -> String {
        let out = self.add_words(input.words, input.tag).await;
        self.notify("mcp:vocab-changed");
        out
    }

    #[tool(
        description = "Full-text search of TanWords documents by title and body, optionally filtered by tag. Ranked by relevance; returns a matching snippet."
    )]
    pub(super) async fn documents_search(&self, Parameters(input): Parameters<SearchDocuments>) -> String {
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
    pub(super) async fn documents_get(&self, Parameters(input): Parameters<GetDocument>) -> String {
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
    pub(super) async fn documents_create(&self, Parameters(input): Parameters<CreateDocument>) -> String {
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
    pub(super) async fn documents_update(&self, Parameters(input): Parameters<UpdateDocument>) -> String {
        let out = self.update_document(input).await;
        self.notify("mcp:docs-changed");
        out
    }

    #[tool(description = "Append Markdown to the end of an existing TanWords document")]
    pub(super) async fn documents_append(&self, Parameters(input): Parameters<AppendDocument>) -> String {
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

    #[tool(description = "Update one vocabulary item's meaning, part of speech, level or notes")]
    pub(super) async fn vocabulary_update(&self, Parameters(input): Parameters<UpdateVocabulary>) -> String {
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
    pub(super) async fn vocabulary_delete(&self, Parameters(input): Parameters<GetVocabulary>) -> String {
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

    #[tool(description = "Delete a TanWords document by its unique ID")]
    pub(super) async fn documents_delete(&self, Parameters(input): Parameters<GetDocument>) -> String {
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

    #[tool(
        description = "Search the user's saved sentence patterns — reusable English structures they collected, each with a Chinese gloss, a usage note and example sentences. Search by the pattern skeleton, its meaning, or an example."
    )]
    pub(super) async fn patterns_search(&self, Parameters(input): Parameters<SearchPatterns>) -> String {
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
    pub(super) async fn patterns_add(&self, Parameters(input): Parameters<AddPattern>) -> String {
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
                    conn.execute(
                        "INSERT INTO patterns(pattern,zh,note,level) VALUES(?1,?2,?3,?4)",
                        params![input.pattern, input.zh, input.note, input.level],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    (conn.last_insert_rowid(), true)
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

    #[tool(
        description = "Save an article to the user's reading library so they can read it in TanWords later. Re-adding the same article returns the existing entry instead of duplicating it."
    )]
    pub(super) async fn articles_add(&self, Parameters(input): Parameters<AddArticle>) -> String {
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
    pub(super) async fn articles_list(&self, Parameters(input): Parameters<ListArticles>) -> String {
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
                        params![terms, limit],
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
                        params![limit],
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
    pub(super) async fn articles_get(&self, Parameters(input): Parameters<GetArticle>) -> String {
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
    pub(super) async fn articles_comment(&self, Parameters(input): Parameters<AddArticleComment>) -> String {
        let result: Result<Value, String> = async {
            let conn = self.connect().await?;
            let id = db::insert_comment(&conn, input.article_id, "ai", &input.body, input.anchor_text.as_deref()).await?;
            Ok(json!({"id": id, "created": true}))
        }
        .await;
        self.notify("mcp:articles-changed");
        result.map(json_text).unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    async fn add_words(&self, words: Vec<AddVocabulary>, tag: Option<String>) -> String {
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

    async fn update_document(&self, input: UpdateDocument) -> String {
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

#[tool_handler]
impl ServerHandler for TanWordsMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo { instructions: Some("Use TanWords as the user's local English-learning knowledge base. Documents are identified by numeric ID; duplicate titles are valid.".into()), capabilities: ServerCapabilities::builder().enable_tools().build(), ..Default::default() }
    }
}

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
