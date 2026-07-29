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
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpService,
};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::config::{load_config, save_config, McpConfig, McpStatus};
use tauri::Emitter;

use super::tools::{ConnProvider, TanWordsMcp};

#[derive(Default)]
struct RuntimeState {
    cancellation: Option<CancellationToken>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    status: McpStatus,
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

    /// Generic over the Tauri runtime so tests can drive it with the mock one.
    /// `conn` is resolved per request rather than captured once — see
    /// `ConnProvider` — so switching databases doesn't strand the MCP server
    /// on the old one.
    pub async fn restart<R: tauri::Runtime>(
        &self,
        config: McpConfig,
        conn: ConnProvider,
        app: tauri::AppHandle<R>,
    ) -> Result<McpStatus, String> {
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
            let notifier: super::tools::ChangeNotifier = Arc::new(move |event: &str| {
                let _ = app.emit(event, ());
            });
            let service = StreamableHttpService::new(
                move || Ok(TanWordsMcp::new(conn.clone(), notifier.clone())),
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
pub async fn mcp_get_config(
    state: tauri::State<'_, crate::AppState>,
    controller: tauri::State<'_, McpController>,
) -> Result<Value, String> {
    let conn = crate::db::conn(&state)?;
    let config = load_config(&conn).await;
    Ok(json!({ "config": config, "status": controller.status() }))
}

#[tauri::command]
pub async fn mcp_apply_config(
    config: McpConfig,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    controller: tauri::State<'_, McpController>,
) -> Result<McpStatus, String> {
    let provider = state_conn_provider(app.clone());
    let status = controller.restart(config.clone(), provider, app).await?;
    let conn = crate::db::conn(&state)?;
    save_config(&conn, &config).await?;
    Ok(status)
}

/// A `ConnProvider` backed by the app's managed `AppState`, so every MCP
/// request reads whichever database is active at that moment.
pub fn state_conn_provider<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> ConnProvider {
    use tauri::Manager;
    Arc::new(move || {
        let state = app
            .try_state::<crate::AppState>()
            .ok_or_else(|| "database is not ready".to_string())?;
        // On Turso, a *fresh* connection per request rather than a clone of
        // the app's shared handle: a clone is the same Hrana stream, and MCP
        // requests (including add_words' transaction) running concurrently
        // with UI commands on one stream fail with "Stream already in use".
        // Local profiles keep the shared handle — one local connection
        // serializes fine, and `:memory:` must not be reopened.
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        if guard.kind() == crate::db::DbKind::Local {
            return Ok(guard.conn());
        }
        let database = guard.database();
        drop(guard);
        database.connect().map_err(|e| e.to_string())
    })
}
