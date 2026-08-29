//! Request handlers split out from the server root: the core RPC invoke
//! endpoint, the per-user SSE event stream, and document-asset byte serving.
//!
//! These share `WebState`/`UserSession`/`json_error` with the server root
//! (see `mod.rs`) and are wired into the router by `serve`.

use axum::body::Bytes;
use axum::extract::{Path, Request, State};
use axum::http::{header, StatusCode};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use futures_util::StreamExt;
use serde_json::{json, Value};

use tanwords_lib::rpc::dispatch::dispatch;
use tanwords_lib::rpc::Args;

use super::auth::session_of;
use super::{json_error, UserSession, WebState};

// ── core RPC (same shapes as the desktop sidecar) ─────────────────────────

pub(super) async fn invoke_handler(
    State(state): State<WebState>,
    Path(command): Path<String>,
    axum::Extension(session): axum::Extension<UserSession>,
    body: Bytes,
) -> Response {
    // Allowlist — see commands.rs for why this is not a denylist. Unknown
    // names fall through to the same refusal as blocked ones: the caller
    // learns nothing about which commands exist.
    if !crate::commands::is_allowed(&command) {
        if let Some(reason) = crate::commands::block_reason(&command) {
            eprintln!(
                "[tanwords-web] user {} attempted blocked command `{command}` ({reason})",
                session.user_id
            );
        }
        return json_error(
            StatusCode::FORBIDDEN,
            format!("`{command}` is not available on the web build"),
        );
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let parsed: Value = if body.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => {
                return json_error(StatusCode::BAD_REQUEST, format!("invalid JSON body: {e}"))
            }
        }
    };
    if let Err(reason) = crate::commands::validate_model_path(&command, &parsed).await {
        return json_error(StatusCode::BAD_REQUEST, reason.to_string());
    }
    match dispatch(&runtime.ctx, &command, Args::new(parsed)).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

pub(super) async fn events_handler(State(state): State<WebState>, request: Request) -> Response {
    let session = session_of(&request);
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    // Per-user broadcast: an event emitted by another user's runtime never
    // reaches this stream, because it never enters *their* AppHandle.
    let receiver = runtime.app.subscribe();
    let stream =
        tokio_stream::wrappers::BroadcastStream::new(receiver).filter_map(|item| async move {
            let event = item.ok()?;
            let data = json!({ "name": event.name, "payload": event.payload }).to_string();
            Some(Ok::<SseEvent, std::convert::Infallible>(
                SseEvent::default().data(data),
            ))
        });
    let mut shutdown = state.shutdown;
    // Web reverse proxies cut idle SSE streams; the desktop never needed
    // this. A 15s ping keeps the connection alive through nginx/Caddy.
    Sse::new(stream.take_until(async move {
        let _ = shutdown.changed().await;
    }))
    .keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("ping"),
    )
    .into_response()
}

// ── document assets: bytes by id, never by path ───────────────────────────

pub(super) async fn asset_handler(
    State(state): State<WebState>,
    Path(id): Path<String>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    // Asset ids are uuids; reject anything else before it reaches SQL params.
    if id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return json_error(StatusCode::BAD_REQUEST, "invalid asset id");
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    // Route through the same command the desktop uses: it applies document
    // privacy (encrypted assets of locked documents stay sealed) for free.
    match dispatch(
        &runtime.ctx,
        "db_get_document_asset",
        Args::new(json!({ "id": id })),
    )
    .await
    {
        Ok(value) => {
            // The stored mime is whatever was attached at upload time. Served
            // back verbatim on this origin, `text/html` would be a script the
            // browser runs with the app's own privileges — same origin as the
            // session JWT in localStorage. Anything that isn't a plain
            // media type is downgraded to an opaque download.
            let mime = value
                .get("mime_type")
                .and_then(Value::as_str)
                .filter(|m| is_inline_safe_mime(m))
                .unwrap_or("application/octet-stream");
            // Bucket-backed assets carry a URL instead of bytes. Without this
            // the base64 field is an empty string, which decodes happily to
            // zero bytes — the browser would get a 200 with an empty file and
            // no hint that anything went wrong.
            if let Some(remote) = value.get("remote_url").and_then(Value::as_str) {
                // Only ever to a real web address: this value comes from the
                // R2 settings the user supplied, and an open redirect to
                // `javascript:` or `data:` would run on this origin.
                if !remote.starts_with("https://") && !remote.starts_with("http://") {
                    return json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "asset has an unusable remote URL",
                    );
                }
                return Redirect::temporary(remote).into_response();
            }
            let Some(data_b64) = value.get("data_base64").and_then(Value::as_str) else {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, "malformed asset row");
            };
            match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data_b64) {
                Ok(bytes) => (
                    [
                        (header::CONTENT_TYPE, mime),
                        (
                            header::CACHE_CONTROL,
                            "private, max-age=31536000, immutable",
                        ),
                        // Belt and braces with the filter above: no sniffing
                        // an octet-stream back into something executable.
                        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                        // A sandboxed CSP so even an image/svg+xml — which can
                        // carry script — has nothing it is allowed to do.
                        (
                            header::CONTENT_SECURITY_POLICY,
                            "default-src 'none'; sandbox",
                        ),
                    ],
                    bytes,
                )
                    .into_response(),
                Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "undecodable asset data"),
            }
        }
        Err(error) => json_error(StatusCode::NOT_FOUND, error),
    }
}

/// Media types safe to hand back with their own Content-Type. Everything else
/// — `text/html`, `application/xhtml+xml`, anything unrecognised — is served
/// as an opaque download instead of being rendered on this origin.
fn is_inline_safe_mime(mime: &str) -> bool {
    let mime = mime
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        // SVG is deliberately absent: it is a document format that can carry
        // script, not a picture format.
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif" | "image/bmp"
        | "image/x-icon" | "image/tiff" => true,
        "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/wav" | "audio/webm" | "audio/aac"
        | "audio/flac" => true,
        "video/mp4" | "video/webm" | "video/ogg" | "video/quicktime" => true,
        "application/pdf" => true,
        "text/plain" => true,
        _ => false,
    }
}
