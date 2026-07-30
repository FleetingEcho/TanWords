//! The axum HTTP surface that replaces Tauri IPC — see `rpc` for command
//! dispatch and the camelCase argument shim.
//!
//!   POST /invoke/{command}   bearer token in the `Authorization` header
//!   GET  /events             `?token=` query param (browser `EventSource`
//!                             cannot set custom headers)
//!   GET  /asset?path=&token= `?token=` query param, same reason — it also
//!                             backs `<audio src>` / `<img src>`
//!
//! The exact shapes here (header vs. query auth, `{ "error": .. }` on
//! failure, bare JSON on success) are dictated by `app/src/bridge/core.ts`
//! and `app/src/bridge/event.ts`, which are already written against them.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, Request, State as AxumState},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::sse::{Event as SseEvent, Sse},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::stream::StreamExt;
use serde_json::{json, Value};
use tower::ServiceExt;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeFile;

use crate::rpc::dispatch::dispatch;
use crate::rpc::{Args, Ctx};
use crate::shim::{AppHandle, Registry};

#[derive(Clone)]
struct ServerState {
    ctx: Ctx,
}

/// Random 32-byte bearer token, base64url-encoded. Generated fresh per
/// process launch — this is not the saved MCP token (`mcp::mcp_generate_token`),
/// it gates a different surface with a different lifetime (this process only).
fn generate_token() -> String {
    use base64::Engine;
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn query_map(req_uri: &axum::http::Uri) -> HashMap<String, String> {
    req_uri
        .query()
        .map(|q| url::form_urlencoded::parse(q.as_bytes()).into_owned().collect())
        .unwrap_or_default()
}

/// Guards `/invoke/*`: the frontend sends `Authorization: Bearer <token>` —
/// same shape as `mcp::controller::require_token`.
async fn require_bearer_token(
    AxumState(token): AxumState<Arc<String>>,
    request: Request,
    next: Next,
) -> Response {
    let supplied = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let expected = format!("Bearer {token}");
    if supplied == Some(expected.as_str()) {
        next.run(request).await
    } else {
        (StatusCode::UNAUTHORIZED, Json(json!({ "error": "missing or invalid token" }))).into_response()
    }
}

/// Guards `/events` and `/asset`: both are consumed as plain URLs
/// (`EventSource`, `<audio src>`) which cannot carry a custom header, so the
/// token travels as `?token=`.
async fn require_query_token(
    AxumState(token): AxumState<Arc<String>>,
    request: Request,
    next: Next,
) -> Response {
    let supplied = query_map(request.uri()).get("token").cloned();
    if supplied.as_deref() == Some(token.as_str()) {
        next.run(request).await
    } else {
        (StatusCode::UNAUTHORIZED, "missing or invalid token").into_response()
    }
}

async fn invoke_handler(
    AxumState(state): AxumState<ServerState>,
    Path(command): Path<String>,
    body: Bytes,
) -> Response {
    let parsed: Value = if body.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("invalid JSON body: {e}") })),
                )
                    .into_response()
            }
        }
    };

    match dispatch(&state.ctx, &command, Args::new(parsed)).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response(),
    }
}

async fn events_handler(
    AxumState(state): AxumState<ServerState>,
) -> Sse<impl futures_util::Stream<Item = Result<SseEvent, std::convert::Infallible>>> {
    let receiver = state.ctx.app().subscribe();
    let stream = tokio_stream::wrappers::BroadcastStream::new(receiver).filter_map(|item| async move {
        let event = item.ok()?;
        let data = json!({ "name": event.name, "payload": event.payload }).to_string();
        Some(Ok(SseEvent::default().data(data)))
    });
    Sse::new(stream)
}

/// Range-capable file serving — the HTTP replacement for `convertFileSrc`.
/// `path` is whatever absolute path the frontend was handed (document
/// assets, local docs, TTS/model files, music library files); there is no
/// extra scope check here beyond "the bearer token is valid", matching the
/// old `assetProtocol.scope: ["**"]` in tauri.conf.json.
async fn asset_handler(req: Request) -> Response {
    let params = query_map(req.uri());
    let Some(path) = params.get("path") else {
        return (StatusCode::BAD_REQUEST, "missing `path` query parameter").into_response();
    };
    if !std::path::Path::new(path).is_file() {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    let service = ServeFile::new(path);
    match service.oneshot(req).await {
        Ok(response) => response.into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

/// Opens the port, prints the handshake line, then serves until the process
/// exits. Electron's supervisor reads exactly one line of stdout — the
/// `{"port":N,"token":".."}` JSON — before treating the sidecar as ready, so
/// nothing else may reach stdout before it.
pub async fn serve(registry: Arc<Registry>, app_handle: AppHandle) {
    let ctx = Ctx::new(registry, app_handle);
    let token = Arc::new(generate_token());

    let invoke_routes = Router::new()
        .route("/invoke/{command}", post(invoke_handler))
        .layer(middleware::from_fn_with_state(token.clone(), require_bearer_token));

    let query_token_routes = Router::new()
        .route("/events", get(events_handler))
        .route("/asset", get(asset_handler))
        .layer(middleware::from_fn_with_state(token.clone(), require_query_token));

    // The renderer is served from Electron's `app://` scheme (a real,
    // CORS-enforcing origin, unlike Tauri's webview) — without this,
    // Chromium blocks every `fetch`/`EventSource` call to this loopback
    // server. Wide open is fine here: the bearer/query token above is the
    // actual access gate (per-process, unguessable, never sent to a real
    // remote origin), not the browser's same-origin policy.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app: Router<()> = Router::new()
        .merge(invoke_routes)
        .merge(query_token_routes)
        .layer(cors)
        .with_state(ServerState { ctx });

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .expect("failed to bind sidecar port");
    let port = listener.local_addr().expect("listener has no local addr").port();

    // MUST be the first thing this process writes to stdout.
    println!("{}", json!({ "port": port, "token": token.as_str() }));
    {
        use std::io::Write;
        let _ = std::io::stdout().flush();
    }

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_on_stdin_eof())
        .await
        .expect("sidecar server exited unexpectedly");
}

/// Electron's supervisor asks for a graceful shutdown (rather than SIGKILL,
/// which would cut off an in-flight Turso background sync — see migration
/// plan §8.7) by closing this process's stdin. Resolves once stdin reaches
/// EOF, which axum uses to stop accepting new connections and let in-flight
/// requests finish. Also resolves on SIGTERM/SIGINT (Ctrl+C, `kill`) so the
/// sidecar shuts down cleanly if run standalone or the pipe is torn down
/// abruptly instead of closed.
async fn shutdown_on_stdin_eof() {
    let stdin_eof = async {
        use tokio::io::AsyncReadExt;
        let mut stdin = tokio::io::stdin();
        let mut buf = [0u8; 64];
        loop {
            match stdin.read(&mut buf).await {
                Ok(0) => break,       // EOF: the parent closed our stdin.
                Ok(_) => continue,    // Stray bytes are ignored, not commands.
                Err(_) => break,
            }
        }
    };

    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
        tokio::select! {
            _ = stdin_eof => {}
            _ = sigterm.recv() => {}
            _ = tokio::signal::ctrl_c() => {}
        }
    }
    #[cfg(not(unix))]
    {
        tokio::select! {
            _ = stdin_eof => {}
            _ = tokio::signal::ctrl_c() => {}
        }
    }
}
