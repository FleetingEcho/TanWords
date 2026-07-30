use std::sync::Arc;

use libsql::Connection;
use rmcp::{
    handler::server::router::tool::ToolRouter,
    model::{ServerCapabilities, ServerInfo},
    tool_handler, ServerHandler,
};

mod articles;
mod documents;
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
                + Self::articles_tool_router(),
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
}

#[tool_handler]
impl ServerHandler for TanWordsMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo { instructions: Some("Use TanWords as the user's local English-learning knowledge base. Documents are identified by numeric ID; duplicate titles are valid.".into()), capabilities: ServerCapabilities::builder().enable_tools().build(), ..Default::default() }
    }
}
