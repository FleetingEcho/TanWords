use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::config::{load_config, save_config, McpConfig, McpStatus};

use super::tools::{ConnProvider, TanWordsMcp};

#[derive(Default)]
struct RuntimeState {
    cancellation: Option<CancellationToken>,
    task: Option<tokio::task::JoinHandle<()>>,
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
        if let Some(mut task) = task {
            // The rmcp service terminates its sessions when the cancellation
            // token fires, but axum's graceful shutdown still waits for open
            // connections — a client holding an SSE stream open would
            // otherwise hang `stop()` (and every restart) forever. Give it a
            // moment, then force the server down.
            if tokio::time::timeout(Duration::from_secs(2), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
    }

    /// `conn` is resolved per request rather than captured once — see
    /// `ConnProvider` — so switching databases doesn't strand the MCP server
    /// on the old one.
    pub async fn restart(
        &self,
        config: McpConfig,
        conn: ConnProvider,
        app: crate::shim::AppHandle,
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
        let task = tokio::task::spawn(async move {
            let notifier: super::tools::ChangeNotifier = Arc::new(move |event: &str| {
                let _ = app.emit(event, ());
            });
            let service = StreamableHttpService::new(
                move || Ok(TanWordsMcp::new(conn.clone(), notifier.clone())),
                LocalSessionManager::default().into(),
                // Tying the service's own cancellation to the controller's
                // token is what makes `stop()` bounded: without it, active
                // SSE sessions keep their connections (and axum's graceful
                // shutdown with them) alive until the client hangs up.
                StreamableHttpServerConfig {
                    cancellation_token: cancellation.clone(),
                    ..Default::default()
                },
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

#[crate::shim::command]
pub async fn mcp_get_config(
    state: crate::shim::State<'_, crate::AppState>,
    controller: crate::shim::State<'_, McpController>,
) -> Result<Value, String> {
    let conn = crate::db::conn(&state)?;
    let config = load_config(&conn).await;
    Ok(json!({ "config": config, "status": controller.status() }))
}

#[crate::shim::command]
pub async fn mcp_apply_config(
    config: McpConfig,
    app: crate::shim::AppHandle,
    state: crate::shim::State<'_, crate::AppState>,
    controller: crate::shim::State<'_, McpController>,
) -> Result<McpStatus, String> {
    let provider = state_conn_provider(app.clone());
    let status = controller.restart(config.clone(), provider, app).await?;
    let conn = crate::db::conn(&state)?;
    if let Err(e) = save_config(&conn, &config).await {
        // The server is already live on the new settings; if they cannot be
        // persisted, roll it back rather than leave it serving a config that
        // silently reverts on the next launch.
        controller.stop().await;
        return Err(e);
    }
    Ok(status)
}

/// A `ConnProvider` backed by the app's managed `AppState`, so every MCP
/// request reads whichever database is active at that moment.
pub fn state_conn_provider(app: crate::shim::AppHandle) -> ConnProvider {
    Arc::new(move || {
        let state = app
            .try_state::<crate::AppState>()
            .ok_or_else(|| "database is not ready".to_string())?;
        // SeaORM's `Conn` is pool-backed: `conn()` clones the pool, and each
        // query checks out its own connection, so concurrent MCP requests and
        // UI commands don't share a stream the way the old single libsql
        // handle did. The old Turso-specific "fresh connection per request" path
        // is therefore obsolete — one cloned pool handle serves every kind.
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        Ok(guard.conn())
    })
}
