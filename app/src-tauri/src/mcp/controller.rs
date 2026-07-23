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
use super::tools::TanWordsMcp;

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
