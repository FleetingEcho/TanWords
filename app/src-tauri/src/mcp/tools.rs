use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ServerHandler,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::types::{
    json_text, AddVocabulary, AddVocabularyBatch, AppendDocument, CreateDocument, GetDocument,
    GetVocabulary, SearchDocuments, SearchVocabulary, UpdateDocument,
};

#[derive(Clone)]
pub struct TanWordsMcp {
    db_path: String,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl TanWordsMcp {
    pub(super) fn new(db_path: String) -> Self {
        Self {
            db_path,
            tool_router: Self::tool_router(),
        }
    }
    fn connect(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path).map_err(|error| error.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|error| error.to_string())?;
        Ok(conn)
    }

    #[tool(
        description = "Fuzzy-search the user's TanWords vocabulary by English word or Chinese meaning"
    )]
    pub(super) async fn vocabulary_search(&self, Parameters(input): Parameters<SearchVocabulary>) -> String {
        let result = (|| -> Result<Value, String> {
            let conn = self.connect()?;
            let pattern = format!("%{}%", input.query.trim());
            let mut stmt = conn.prepare("SELECT w.id,w.word,w.word_type,w.level,COALESCE((SELECT zh FROM word_definitions WHERE word_id=w.id ORDER BY sort_order LIMIT 1),''),w.source,w.created_at,w.updated_at FROM words w WHERE w.word LIKE ?1 OR EXISTS(SELECT 1 FROM word_definitions d WHERE d.word_id=w.id AND d.zh LIKE ?1) ORDER BY w.updated_at DESC LIMIT ?2").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![pattern, input.limit.min(100) as i64], |row| Ok(json!({"id":row.get::<_,i64>(0)?,"word":row.get::<_,String>(1)?,"wordType":row.get::<_,Option<String>>(2)?,"level":row.get::<_,Option<String>>(3)?,"zh":row.get::<_,String>(4)?,"source":row.get::<_,Option<String>>(5)?,"createdAt":row.get::<_,String>(6)?,"updatedAt":row.get::<_,String>(7)?}))).map_err(|e| e.to_string())?;
            Ok(json!({"items": rows.filter_map(Result::ok).collect::<Vec<_>>() }))
        })();
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(description = "Get complete details for one vocabulary item by its unique ID")]
    pub(super) async fn vocabulary_get(&self, Parameters(input): Parameters<GetVocabulary>) -> String {
        let result = (|| -> Result<Value, String> {
            let conn = self.connect()?;
            let word = conn.query_row("SELECT id,word,word_type,level,notes,source,created_at,enrichment_text FROM words WHERE id=?1", [input.id], |row| Ok(json!({"id":row.get::<_,i64>(0)?,"word":row.get::<_,String>(1)?,"wordType":row.get::<_,Option<String>>(2)?,"level":row.get::<_,Option<String>>(3)?,"notes":row.get::<_,Option<String>>(4)?,"source":row.get::<_,Option<String>>(5)?,"createdAt":row.get::<_,String>(6)?,"enrichment":row.get::<_,Option<String>>(7)?}))).map_err(|_| "Vocabulary item not found".to_string())?;
            let mut stmt = conn.prepare("SELECT pos,zh,en,example_en,example_zh FROM word_definitions WHERE word_id=?1 ORDER BY sort_order").map_err(|e| e.to_string())?;
            let definitions = stmt.query_map([input.id], |row| Ok(json!({"pos":row.get::<_,String>(0)?,"zh":row.get::<_,String>(1)?,"en":row.get::<_,String>(2)?,"exampleEn":row.get::<_,String>(3)?,"exampleZh":row.get::<_,String>(4)?}))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect::<Vec<_>>();
            Ok(json!({"item":word,"definitions":definitions}))
        })();
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Add one vocabulary item to TanWords; returns the existing ID when the word already exists"
    )]
    pub(super) async fn vocabulary_add(&self, Parameters(input): Parameters<AddVocabulary>) -> String {
        add_words(&self.db_path, vec![input], None)
    }

    #[tool(description = "Add multiple vocabulary items to TanWords in one transaction")]
    pub(super) async fn vocabulary_add_batch(
        &self,
        Parameters(input): Parameters<AddVocabularyBatch>,
    ) -> String {
        add_words(&self.db_path, input.words, input.tag)
    }

    #[tool(
        description = "Fuzzy-search TanWords documents by title and body, optionally filtered by tag"
    )]
    pub(super) async fn documents_search(&self, Parameters(input): Parameters<SearchDocuments>) -> String {
        let result = (|| -> Result<Value, String> {
            let conn = self.connect()?;
            let fuzzy =
                input
                    .query
                    .to_lowercase()
                    .chars()
                    .fold(String::from("%"), |mut out, ch| {
                        if matches!(ch, '%' | '_' | '\\') {
                            out.push('\\');
                        }
                        out.push(ch);
                        out.push('%');
                        out
                    });
            let mut stmt = conn.prepare("SELECT id,title,tags,pinned,word_count,created_at,updated_at,substr(content_text,1,500) FROM documents WHERE (LOWER(title) LIKE ?1 ESCAPE '\\' OR LOWER(content_text) LIKE ?1 ESCAPE '\\') AND (?2 IS NULL OR EXISTS(SELECT 1 FROM json_each(tags) WHERE value=?2)) ORDER BY pinned DESC,updated_at DESC LIMIT ?3").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![fuzzy,input.tag,input.limit.min(100) as i64], |row| Ok(json!({"id":row.get::<_,i64>(0)?,"title":row.get::<_,String>(1)?,"tags":serde_json::from_str::<Value>(&row.get::<_,String>(2)?).unwrap_or(json!([])),"pinned":row.get::<_,i64>(3)?!=0,"wordCount":row.get::<_,i64>(4)?,"createdAt":row.get::<_,String>(5)?,"updatedAt":row.get::<_,String>(6)?,"excerpt":row.get::<_,String>(7)?}))).map_err(|e| e.to_string())?;
            Ok(json!({"items":rows.filter_map(Result::ok).collect::<Vec<_>>() }))
        })();
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Read a TanWords document by unique ID; content is returned as Markdown when available"
    )]
    pub(super) async fn documents_get(&self, Parameters(input): Parameters<GetDocument>) -> String {
        let result = (|| -> Result<Value, String> {
            let conn = self.connect()?;
            conn.query_row("SELECT id,title,content,content_text,tags,pinned,word_count,created_at,updated_at FROM documents WHERE id=?1",[input.id],|row| Ok(json!({"id":row.get::<_,i64>(0)?,"title":row.get::<_,String>(1)?,"content":row.get::<_,String>(2)?,"text":row.get::<_,String>(3)?,"tags":serde_json::from_str::<Value>(&row.get::<_,String>(4)?).unwrap_or(json!([])),"pinned":row.get::<_,i64>(5)?!=0,"wordCount":row.get::<_,i64>(6)?,"createdAt":row.get::<_,String>(7)?,"updatedAt":row.get::<_,String>(8)?}))).map_err(|_|"Document not found".into())
        })();
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Create a new TanWords document from Markdown; duplicate titles are allowed"
    )]
    pub(super) async fn documents_create(&self, Parameters(input): Parameters<CreateDocument>) -> String {
        let result = (|| -> Result<Value, String> {
            let conn = self.connect()?;
            let tags = serde_json::to_string(&input.tags).map_err(|e| e.to_string())?;
            let count = input.content.split_whitespace().count() as i64;
            conn.execute("INSERT INTO documents(title,content,content_text,tags,word_count) VALUES(?1,?2,?2,?3,?4)",params![input.title,input.content,tags,count]).map_err(|e|e.to_string())?;
            Ok(json!({"id":conn.last_insert_rowid(),"created":true}))
        })();
        result
            .map(json_text)
            .unwrap_or_else(|error| json_text(json!({"error":error})))
    }

    #[tool(
        description = "Update a TanWords document by unique ID, with optional optimistic concurrency protection"
    )]
    pub(super) async fn documents_update(&self, Parameters(input): Parameters<UpdateDocument>) -> String {
        update_document(&self.db_path, input)
    }

    #[tool(description = "Append Markdown to the end of an existing TanWords document")]
    pub(super) async fn documents_append(&self, Parameters(input): Parameters<AppendDocument>) -> String {
        let result = (|| -> Result<Value, String> {
            let conn = self.connect()?;
            let changed=conn.execute("UPDATE documents SET content=content||'\n\n'||?1,content_text=content_text||'\n\n'||?1,word_count=word_count+?2,updated_at=datetime('now') WHERE id=?3",params![input.content,input.content.split_whitespace().count() as i64,input.id]).map_err(|e|e.to_string())?;
            if changed == 0 {
                return Err("Document not found".into());
            }
            Ok(json!({"id":input.id,"updated":true}))
        })();
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

fn add_words(db_path: &str, words: Vec<AddVocabulary>, tag: Option<String>) -> String {
    let result = (|| -> Result<Value, String> {
        let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut items = vec![];
        for item in words {
            let normalized = item.word.trim().to_lowercase();
            if normalized.is_empty() {
                continue;
            }
            let existing: Option<i64> = tx
                .query_row(
                    "SELECT id FROM words WHERE LOWER(word)=?1",
                    [&normalized],
                    |row| row.get(0),
                )
                .ok();
            if let Some(id) = existing {
                items.push(json!({"id":id,"word":normalized,"created":false}));
                continue;
            }
            let tags = serde_json::to_string(&tag.iter().collect::<Vec<_>>())
                .unwrap_or_else(|_| "[]".into());
            tx.execute("INSERT INTO words(word,word_type,level,word_freq,source,tags) VALUES(?1,?2,?3,1,'mcp',?4)",params![normalized,item.word_type,item.level,tags]).map_err(|e|e.to_string())?;
            let id = tx.last_insert_rowid();
            tx.execute("INSERT INTO word_definitions(word_id,pos,zh,example_en,sort_order) VALUES(?1,'other',?2,?3,0)",params![id,item.zh,item.context]).map_err(|e|e.to_string())?;
            items.push(json!({"id":id,"word":normalized,"created":true}));
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(json!({"items":items}))
    })();
    result
        .map(json_text)
        .unwrap_or_else(|error| json_text(json!({"error":error})))
}

fn update_document(db_path: &str, input: UpdateDocument) -> String {
    let result = (|| -> Result<Value, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        let current = conn
            .query_row(
                "SELECT title,content,tags,updated_at FROM documents WHERE id=?1",
                [input.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
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
        conn.execute("UPDATE documents SET title=?1,content=?2,content_text=?2,tags=?3,word_count=?4,updated_at=datetime('now') WHERE id=?5",params![title,content,tags,count,input.id]).map_err(|e|e.to_string())?;
        Ok(json!({"id":input.id,"updated":true}))
    })();
    result
        .map(json_text)
        .unwrap_or_else(|error| json_text(json!({"error":error})))
}
