use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpService,
    },
    ServerHandler,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

const DEFAULT_PORT: u16 = 47831;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            token: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub endpoint: Option<String>,
    pub error: Option<String>,
}

#[derive(Default)]
struct RuntimeState {
    cancellation: Option<CancellationToken>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    status: McpStatus,
}

impl Default for McpStatus {
    fn default() -> Self {
        Self {
            running: false,
            endpoint: None,
            error: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct McpController {
    runtime: Arc<Mutex<RuntimeState>>,
}

impl McpController {
    pub fn status(&self) -> McpStatus {
        self.runtime
            .lock()
            .map(|state| state.status.clone())
            .unwrap_or_default()
    }

    pub async fn stop(&self) {
        let task = if let Ok(mut state) = self.runtime.lock() {
            if let Some(token) = state.cancellation.take() {
                token.cancel();
            }
            state.status = McpStatus::default();
            state.task.take()
        } else {
            None
        };
        if let Some(task) = task {
            let _ = task.await;
        }
    }

    pub async fn restart(&self, config: McpConfig, db_path: String) -> Result<McpStatus, String> {
        self.stop().await;
        if !config.enabled {
            return Ok(self.status());
        }
        if !(1024..=65535).contains(&config.port) {
            return Err("Port must be between 1024 and 65535".into());
        }
        if config.token.trim().len() < 24 {
            return Err("MCP access token is missing or too short".into());
        }

        let address = SocketAddr::from(([127, 0, 0, 1], config.port));
        let listener = tokio::net::TcpListener::bind(address)
            .await
            .map_err(|error| {
                let message = format!("Could not bind 127.0.0.1:{}: {error}", config.port);
                if let Ok(mut state) = self.runtime.lock() {
                    state.status.error = Some(message.clone());
                }
                message
            })?;
        let cancellation = CancellationToken::new();
        let endpoint = format!("http://127.0.0.1:{}/mcp", config.port);
        if let Ok(mut state) = self.runtime.lock() {
            state.cancellation = Some(cancellation.clone());
            state.status = McpStatus {
                running: true,
                endpoint: Some(endpoint),
                error: None,
            };
        }

        let controller = self.clone();
        let task = tauri::async_runtime::spawn(async move {
            let service = StreamableHttpService::new(
                move || Ok(TanWordsMcp::new(db_path.clone())),
                LocalSessionManager::default().into(),
                Default::default(),
            );
            let router = Router::new()
                .nest_service("/mcp", service)
                .layer(middleware::from_fn_with_state(config.token, require_token));
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(cancellation.cancelled_owned())
                .await
            {
                if let Ok(mut state) = controller.runtime.lock() {
                    state.status = McpStatus {
                        running: false,
                        endpoint: None,
                        error: Some(error.to_string()),
                    };
                }
            }
        });
        if let Ok(mut state) = self.runtime.lock() {
            state.task = Some(task);
        }
        Ok(self.status())
    }
}

async fn require_token(State(expected): State<String>, request: Request, next: Next) -> Response {
    let supplied = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let expected_header = format!("Bearer {expected}");
    if supplied == Some(expected_header.as_str()) {
        next.run(request).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            "Missing or invalid MCP access token",
        )
            .into_response()
    }
}

#[tauri::command]
pub fn mcp_generate_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn load_config(conn: &Connection) -> McpConfig {
    let get = |key: &str| -> Option<String> {
        conn.query_row(
            "SELECT value FROM user_settings WHERE key=?1",
            [key],
            |row| row.get(0),
        )
        .ok()
        .and_then(|raw: String| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| Some(value.to_string()))
        })
    };
    McpConfig {
        enabled: get("mcp_enabled").as_deref() == Some("true"),
        port: get("mcp_port")
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_PORT),
        token: get("mcp_token").unwrap_or_default(),
    }
}

pub fn save_config(conn: &Connection, config: &McpConfig) -> Result<(), String> {
    for (key, value) in [
        ("mcp_enabled", json!(config.enabled)),
        ("mcp_port", json!(config.port.to_string())),
        ("mcp_token", json!(config.token)),
    ] {
        conn.execute(
            "INSERT INTO user_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value.to_string()],
        ).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_get_config(
    state: tauri::State<'_, crate::AppState>,
    controller: tauri::State<'_, McpController>,
) -> Result<Value, String> {
    let conn = crate::db::lock_db(&state)?;
    let config = load_config(&conn);
    Ok(json!({ "config": config, "status": controller.status() }))
}

#[tauri::command]
pub async fn mcp_apply_config(
    config: McpConfig,
    state: tauri::State<'_, crate::AppState>,
    controller: tauri::State<'_, McpController>,
) -> Result<McpStatus, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    let status = controller.restart(config.clone(), db_path).await?;
    {
        let conn = crate::db::lock_db(&state)?;
        save_config(&conn, &config)?;
    }
    Ok(status)
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct SearchVocabulary {
    #[schemars(description = "Word or Chinese meaning to search for")]
    query: String,
    #[serde(default = "default_limit")]
    limit: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct GetVocabulary {
    #[schemars(description = "Unique vocabulary ID")]
    id: i64,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AddVocabulary {
    word: String,
    #[serde(default)]
    zh: String,
    word_type: Option<String>,
    level: Option<String>,
    context: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AddVocabularyBatch {
    words: Vec<AddVocabulary>,
    tag: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct SearchDocuments {
    query: String,
    tag: Option<String>,
    #[serde(default = "default_limit")]
    limit: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct GetDocument {
    #[schemars(description = "Unique document ID")]
    id: i64,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct CreateDocument {
    title: String,
    #[schemars(description = "Markdown content")]
    content: String,
    #[serde(default)]
    tags: Vec<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct UpdateDocument {
    id: i64,
    title: Option<String>,
    #[schemars(description = "Replacement Markdown content")]
    content: Option<String>,
    tags: Option<Vec<String>>,
    expected_updated_at: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AppendDocument {
    id: i64,
    #[schemars(description = "Markdown to append")]
    content: String,
}

fn default_limit() -> usize {
    20
}
fn json_text(value: Value) -> String {
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into())
}

#[derive(Clone)]
pub struct TanWordsMcp {
    db_path: String,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl TanWordsMcp {
    fn new(db_path: String) -> Self {
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
    async fn vocabulary_search(&self, Parameters(input): Parameters<SearchVocabulary>) -> String {
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
    async fn vocabulary_get(&self, Parameters(input): Parameters<GetVocabulary>) -> String {
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
    async fn vocabulary_add(&self, Parameters(input): Parameters<AddVocabulary>) -> String {
        add_words(&self.db_path, vec![input], None)
    }

    #[tool(description = "Add multiple vocabulary items to TanWords in one transaction")]
    async fn vocabulary_add_batch(
        &self,
        Parameters(input): Parameters<AddVocabularyBatch>,
    ) -> String {
        add_words(&self.db_path, input.words, input.tag)
    }

    #[tool(
        description = "Fuzzy-search TanWords documents by title and body, optionally filtered by tag"
    )]
    async fn documents_search(&self, Parameters(input): Parameters<SearchDocuments>) -> String {
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
    async fn documents_get(&self, Parameters(input): Parameters<GetDocument>) -> String {
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
    async fn documents_create(&self, Parameters(input): Parameters<CreateDocument>) -> String {
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
    async fn documents_update(&self, Parameters(input): Parameters<UpdateDocument>) -> String {
        update_document(&self.db_path, input)
    }

    #[tool(description = "Append Markdown to the end of an existing TanWords document")]
    async fn documents_append(&self, Parameters(input): Parameters<AppendDocument>) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_database() -> String {
        let path = std::env::temp_dir().join(format!("tanwords-mcp-{}.db", mcp_generate_token()));
        let conn = Connection::open(&path).unwrap();
        crate::db::init_db(&conn).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn vocabulary_and_document_tools_round_trip() {
        let path = test_database();
        let server = TanWordsMcp::new(path.clone());

        let added = server
            .vocabulary_add(Parameters(AddVocabulary {
                word: "Serendipity".into(),
                zh: "意外发现美好事物的运气".into(),
                word_type: Some("noun".into()),
                level: Some("C1".into()),
                context: Some("A happy accident.".into()),
            }))
            .await;
        assert!(added.contains("serendipity"));

        let found = server
            .vocabulary_search(Parameters(SearchVocabulary {
                query: "意外发现".into(),
                limit: 20,
            }))
            .await;
        assert!(found.contains("serendipity"));

        let created = server
            .documents_create(Parameters(CreateDocument {
                title: "Same title".into(),
                content: "# First note\nUseful phrase".into(),
                tags: vec!["mcp".into()],
            }))
            .await;
        let id = serde_json::from_str::<Value>(&created).unwrap()["id"]
            .as_i64()
            .unwrap();
        let duplicate = server
            .documents_create(Parameters(CreateDocument {
                title: "Same title".into(),
                content: "Second note".into(),
                tags: vec![],
            }))
            .await;
        assert_ne!(
            id,
            serde_json::from_str::<Value>(&duplicate).unwrap()["id"]
                .as_i64()
                .unwrap()
        );

        let appended = server
            .documents_append(Parameters(AppendDocument {
                id,
                content: "More context".into(),
            }))
            .await;
        assert!(appended.contains("updated"));
        let document = server.documents_get(Parameters(GetDocument { id })).await;
        assert!(document.contains("More context"));

        drop(server);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn server_can_restart_on_the_same_custom_port() {
        let path = test_database();
        let probe = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let controller = McpController::default();
        let config = McpConfig { enabled: true, port, token: mcp_generate_token() };

        assert!(controller.restart(config.clone(), path.clone()).await.unwrap().running);
        assert!(controller.restart(config, path.clone()).await.unwrap().running);
        controller.stop().await;
        assert!(!controller.status().running);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn config_round_trip_and_token_strength() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(&conn).unwrap();
        let config = McpConfig {
            enabled: true,
            port: 49152,
            token: mcp_generate_token(),
        };
        assert!(config.token.len() >= 40);
        save_config(&conn, &config).unwrap();
        let loaded = load_config(&conn);
        assert!(loaded.enabled);
        assert_eq!(loaded.port, 49152);
        assert_eq!(loaded.token, config.token);
    }
}
