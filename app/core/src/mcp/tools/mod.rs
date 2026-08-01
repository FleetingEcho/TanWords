use std::sync::Arc;

use libsql::Connection;
use rmcp::{
    handler::server::router::tool::ToolRouter,
    model::{
        AnnotateAble, GetPromptRequestParams, GetPromptResult, ListPromptsResult,
        ListResourceTemplatesResult, ListResourcesResult, Prompt, PromptArgument, PromptMessage,
        PromptMessageRole, RawResource, RawResourceTemplate, ReadResourceRequestParams,
        ReadResourceResult, Resource, ResourceContents, ResourceTemplate, ServerCapabilities,
        ServerInfo,
    },
    tool_handler, ServerHandler,
};
use serde_json::{json, Value};

use super::types::json_text;

mod articles;
mod documents;
mod feeds;
mod hackernews;
mod patterns;
mod vocabulary;

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

impl TanWordsMcp {
    pub fn new(conn: ConnProvider, notifier: ChangeNotifier) -> Self {
        Self {
            conn,
            notifier,
            tool_router: Self::vocabulary_tool_router()
                + Self::documents_tool_router()
                + Self::patterns_tool_router()
                + Self::articles_tool_router()
                + Self::feeds_tool_router()
                + Self::hackernews_tool_router(),
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

    async fn scalar_count(&self, sql: &str) -> Result<i64, String> {
        let conn = self.connect().await?;
        crate::db::scalar_i64(&conn, sql, ()).await.map_err(|e| e.to_string())
    }

    pub(in crate::mcp) fn resource_definitions() -> Vec<Resource> {
        vec![
            RawResource::new("tanwords://stats", "TanWords stats")
                .no_annotation(),
        ]
    }

    pub(in crate::mcp) fn resource_template_definitions() -> Vec<ResourceTemplate> {
        let template = |uri: &str, name: &str, description: &str| {
            RawResourceTemplate {
                uri_template: uri.into(),
                name: name.into(),
                title: None,
                description: Some(description.into()),
                mime_type: Some("text/plain".into()),
                icons: None,
            }
            .no_annotation()
        };
        vec![
            template(
                "tanwords://vocabulary/{id}",
                "Vocabulary item",
                "One vocabulary item plus its definitions",
            ),
            template(
                "tanwords://documents/{id}",
                "Document",
                "One Markdown document from Documents",
            ),
            template(
                "tanwords://patterns/{id}",
                "Sentence pattern",
                "One saved sentence pattern plus examples",
            ),
            template(
                "tanwords://articles/{id}",
                "Reading article",
                "One article from the reading library",
            ),
        ]
    }

    pub(in crate::mcp) fn prompt_definitions() -> Vec<Prompt> {
        let arg = |name: &str, description: &str, required: bool| PromptArgument {
            name: name.into(),
            title: None,
            description: Some(description.into()),
            required: Some(required),
        };
        vec![
            Prompt::new(
                "extract-vocabulary",
                Some("Extract and save useful vocabulary from text"),
                Some(vec![arg("text", "The text to extract from", true)]),
            ),
            Prompt::new(
                "summarize-document",
                Some("Summarize a saved document"),
                Some(vec![arg("document_id", "Numeric document ID", true)]),
            ),
            Prompt::new(
                "daily-review",
                Some("Build a short review from known words and saved patterns"),
                None,
            ),
            Prompt::new(
                "generate-speaking-material",
                Some("Generate speaking practice material for a scenario"),
                Some(vec![arg("scenario", "Scenario the user wants to practice", true)]),
            ),
        ]
    }

    pub(in crate::mcp) fn prompt_messages(
        &self,
        name: &str,
        arguments: Option<serde_json::Map<String, Value>>,
    ) -> Result<Vec<PromptMessage>, rmcp::ErrorData> {
        let arg = |key: &str| {
            arguments
                .as_ref()
                .and_then(|m| m.get(key))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let user = |text: String| vec![PromptMessage::new_text(PromptMessageRole::User, text)];
        match name {
            "extract-vocabulary" => Ok(user(format!(
                "Extract useful vocabulary from the following text. Check what is already saved with vocabulary_search, then save new items with vocabulary_add.\n\n{}",
                arg("text")
            ))),
            "summarize-document" => Ok(user(format!(
                "Read document {} with documents_get, then summarize it as a concise Markdown note.",
                arg("document_id")
            ))),
            "daily-review" => Ok(user(
                "Use vocabulary_known_words and patterns_list to build a short, practical review: 5 words and 2-3 sentence patterns the user should revisit.".into(),
            )),
            "generate-speaking-material" => Ok(user(format!(
                "Generate speaking practice material for this scenario. Return Markdown with 常用词汇, 高频句 and 地道表达; every speakable English sentence must be its own blockquote line so the app can attach TTS and save buttons. Save useful phrases with patterns_add when appropriate.\n\nScenario: {}",
                arg("scenario")
            ))),
            _ => Err(rmcp::ErrorData::invalid_params(format!("Unknown prompt: {name}"), None)),
        }
    }

    pub(in crate::mcp) async fn read_resource_value(&self, uri: &str) -> Result<ReadResourceResult, rmcp::ErrorData> {
        let conn = self
            .connect()
            .await
            .map_err(|e| rmcp::ErrorData::invalid_params(e, None))?;

        if uri == "tanwords://stats" {
            let counts = json!({
                "words": self.scalar_count("SELECT COUNT(*) FROM words").await.unwrap_or_default(),
                "knownWords": self.scalar_count("SELECT COUNT(*) FROM user_known_words").await.unwrap_or_default(),
                "documents": self.scalar_count("SELECT COUNT(*) FROM documents WHERE protected=0").await.unwrap_or_default(),
                "patterns": self.scalar_count("SELECT COUNT(*) FROM patterns").await.unwrap_or_default(),
                "articles": self.scalar_count("SELECT COUNT(*) FROM reading_articles").await.unwrap_or_default(),
                "rssFeeds": self.scalar_count("SELECT COUNT(*) FROM rss_feeds").await.unwrap_or_default(),
                "rssEntries": self.scalar_count("SELECT COUNT(*) FROM rss_entries").await.unwrap_or_default(),
            });
            return Ok(ReadResourceResult {
                contents: vec![ResourceContents::text(json_text(counts), uri)],
            });
        }

        if let Some(id_str) = uri.strip_prefix("tanwords://vocabulary/") {
            let id: i64 = id_str.parse().map_err(|_| rmcp::ErrorData::invalid_params("Invalid vocabulary ID", None))?;
            let item: Value = crate::db::fetch_one(
                &conn,
                "SELECT id,word,word_type,level,notes,source,created_at FROM words WHERE id=?1",
                [id],
                |row| Ok(json!({
                    "id": row.get::<i64>(0)?,
                    "word": row.get::<String>(1)?,
                    "wordType": row.get::<Option<String>>(2)?,
                    "level": row.get::<Option<String>>(3)?,
                    "notes": row.get::<Option<String>>(4)?,
                    "source": row.get::<Option<String>>(5)?,
                    "createdAt": row.get::<String>(6)?,
                })),
            )
            .await
            .map_err(|_| rmcp::ErrorData::invalid_params("Vocabulary item not found", None))?;
            let definitions: Vec<Value> = crate::db::fetch_all(
                &conn,
                "SELECT pos,zh,en,example_en,example_zh FROM word_definitions WHERE word_id=?1 ORDER BY sort_order",
                [id],
                |row| Ok(json!({"pos":row.get::<String>(0)?,"zh":row.get::<String>(1)?,"en":row.get::<String>(2)?,"exampleEn":row.get::<String>(3)?,"exampleZh":row.get::<String>(4)?})),
            )
            .await
            .unwrap_or_default();
            return Ok(ReadResourceResult {
                contents: vec![ResourceContents::text(
                    json_text(json!({"item": item, "definitions": definitions})),
                    uri,
                )],
            });
        }

        if let Some(id_str) = uri.strip_prefix("tanwords://documents/") {
            let id: i64 = id_str.parse().map_err(|_| rmcp::ErrorData::invalid_params("Invalid document ID", None))?;
            let (title, content): (String, String) = crate::db::fetch_one(
                &conn,
                "SELECT title,content FROM documents WHERE id=?1 AND protected=0",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .await
            .map_err(|_| rmcp::ErrorData::invalid_params("Document not found", None))?;
            return Ok(ReadResourceResult {
                contents: vec![ResourceContents::text(format!("# {title}\n\n{content}"), uri)],
            });
        }

        if let Some(id_str) = uri.strip_prefix("tanwords://patterns/") {
            let id: i64 = id_str.parse().map_err(|_| rmcp::ErrorData::invalid_params("Invalid pattern ID", None))?;
            let mut pattern: Value = crate::db::fetch_one(
                &conn,
                "SELECT id,pattern,zh,note,level,created_at FROM patterns WHERE id=?1",
                [id],
                |row| Ok(json!({"id":row.get::<i64>(0)?,"pattern":row.get::<String>(1)?,"zh":row.get::<String>(2)?,"note":row.get::<String>(3)?,"level":row.get::<Option<String>>(4)?,"createdAt":row.get::<String>(5)?})),
            )
            .await
            .map_err(|_| rmcp::ErrorData::invalid_params("Pattern not found", None))?;
            let examples: Vec<Value> = crate::db::fetch_all(
                &conn,
                "SELECT sentence,source FROM pattern_examples WHERE pattern_id=?1 ORDER BY id",
                [id],
                |row| Ok(json!({"sentence":row.get::<String>(0)?,"source":row.get::<String>(1)?})),
            )
            .await
            .unwrap_or_default();
            pattern["examples"] = json!(examples);
            return Ok(ReadResourceResult {
                contents: vec![ResourceContents::text(json_text(pattern), uri)],
            });
        }

        if let Some(id_str) = uri.strip_prefix("tanwords://articles/") {
            let id: i64 = id_str.parse().map_err(|_| rmcp::ErrorData::invalid_params("Invalid article ID", None))?;
            let (title, content): (String, String) = crate::db::fetch_one(
                &conn,
                "SELECT title,content FROM reading_articles WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .await
            .map_err(|_| rmcp::ErrorData::invalid_params("Article not found", None))?;
            return Ok(ReadResourceResult {
                contents: vec![ResourceContents::text(format!("# {title}\n\n{content}"), uri)],
            });
        }

        Err(rmcp::ErrorData::invalid_params(format!("Unknown resource: {uri}"), None))
    }
}

#[tool_handler]
impl ServerHandler for TanWordsMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some("Use TanWords as the user's local English-learning knowledge base. Documents, vocabulary, patterns and articles are identified by numeric IDs; duplicate document titles are valid.".into()),
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
            ..Default::default()
        }
    }

    async fn list_resources(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListResourcesResult, rmcp::ErrorData> {
        Ok(ListResourcesResult::with_all_items(Self::resource_definitions()))
    }

    async fn list_resource_templates(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListResourceTemplatesResult, rmcp::ErrorData> {
        Ok(ListResourceTemplatesResult::with_all_items(Self::resource_template_definitions()))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ReadResourceResult, rmcp::ErrorData> {
        self.read_resource_value(&request.uri).await
    }

    async fn list_prompts(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListPromptsResult, rmcp::ErrorData> {
        Ok(ListPromptsResult::with_all_items(Self::prompt_definitions()))
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<GetPromptResult, rmcp::ErrorData> {
        let messages = self.prompt_messages(&request.name, request.arguments)?;
        Ok(GetPromptResult { description: None, messages })
    }
}
