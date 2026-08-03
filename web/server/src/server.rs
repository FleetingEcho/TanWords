//! The network-facing axum surface of the web backend.
//!
//! Reuses the core's RPC dispatch exactly like the desktop sidecar
//! (`tanwords_lib::server`) does, but swaps the trust model: email+password
//! login against its own users.db, invite-key-gated registration, and — the
//! structural difference — a per-user runtime pool, so each session's
//! commands run against that user's own database with zero cross-user bleed,
//! including SSE event streams.
//!
//!   POST /api/auth/register          {"email","password","inviteKey"} -> {"token"} (invite-gated, rate-limited)
//!   POST /api/auth/login             {"email","password"} -> {"token"}        (rate-limited)
//!   POST /api/auth/reset-password    {"email","newPassword","inviteKey"} -> 204 (invite-gated)
//!   POST /api/auth/logout            Bearer                                     204
//!   GET  /api/auth/me                Bearer -> {"email"}
//!   POST /invoke/{command}           session, JSON args -> bare JSON | {"error"}
//!   GET  /events                     session, SSE (per-user broadcast)
//!   GET  /api/assets/{id}            session (Bearer or ?token=), document-asset bytes
//!   POST /api/import/upload          session, multipart "file" -> {"path"}
//!   POST /api/import/analyze|apply   session, {"path"} -> dispatch (validated under uploads/)
//!   GET  /api/export/backup          session, optional X-Export-Password -> db file
//!   GET  /api/db/profile             session -> {"connection":...,"remembered":{...}}
//!   POST /api/db/turso/connect       session, {"url","token"} -> descriptor
//!   POST /api/db/turso/disconnect    session -> descriptor (back to per-user local db)
//!   GET  /api/db/turso/remembered    session -> {"url":...,"token_present":bool}
//!   POST /api/ai-proxy/{id}/{*rest}  session, upstream passthrough with injected key
//!   GET  /*                          the SPA (built frontend), index.html fallback

use std::net::{IpAddr, SocketAddr};
use std::path::{Component, PathBuf};
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::multipart::MultipartError;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, Request, State};
use axum::response::Redirect;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use tanwords_lib::db;
use tanwords_lib::db::connection::DbProfile;
use tanwords_lib::rpc::dispatch::dispatch;
use tanwords_lib::rpc::Args;
use tanwords_lib::AppState;

use crate::embedded::Assets;
use crate::auth::{bearer_token, constant_time_eq, RateLimiter};
use crate::config::Config;
use crate::runtime::{RuntimePool, UserRuntime};
use crate::users::UsersDb;

#[derive(Clone)]
struct WebState {
    users: Arc<UsersDb>,
    limiter: Arc<RateLimiter>,
    pool: Arc<RuntimePool>,
    config: Arc<Config>,
    http: reqwest::Client,
    shutdown: tokio::sync::watch::Receiver<()>,
}

/// What `require_session` leaves in request extensions for handlers.
#[derive(Clone)]
struct UserSession {
    user_id: i64,
    email: String,
    token: String,
}

impl WebState {
    /// Resolve the caller's per-user runtime; the error is already a response.
    async fn runtime_for(&self, session: &UserSession) -> Result<Arc<UserRuntime>, Response> {
        self.pool
            .runtime_for(session.user_id)
            .await
            .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, e))
    }
}

fn json_error(status: StatusCode, error: impl Into<String>) -> Response {
    (status, Json(json!({ "error": error.into() }))).into_response()
}

/// `?token=` lookup without pulling in a form-urlencode dependency: session
/// tokens are URL-safe base64 (no `+`, `/`, `=`), so the raw value compare is
/// exact for the only tokens this server ever issues.
fn query_token(request: &Request) -> Option<String> {
    let query = request.uri().query()?;
    for pair in query.split('&') {
        if let Some(value) = pair.strip_prefix("token=") {
            return Some(value.to_string());
        }
    }
    None
}

/// The one gate for everything past the auth routes: Bearer header, or
/// `?token=` for URLs embedded in markup (`EventSource` cannot set headers,
/// and this server deliberately accepts query auth on every gated route for
/// that reason). Valid sessions land in request extensions as `UserSession`.
async fn require_session(State(state): State<WebState>, mut request: Request, next: Next) -> Response {
    let token = bearer_token(&request).or_else(|| query_token(&request));
    let Some(token) = token else {
        return json_error(StatusCode::UNAUTHORIZED, "missing token");
    };
    match state.users.validate(&token).await {
        Ok(Some(user)) => {
            request.extensions_mut().insert(UserSession {
                user_id: user.id,
                email: user.email,
                token,
            });
            next.run(request).await
        }
        Ok(None) => json_error(StatusCode::UNAUTHORIZED, "invalid or expired token"),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ── auth routes ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct RegisterBody {
    email: String,
    password: String,
    #[serde(rename = "inviteKey")]
    invite_key: String,
}

#[derive(Deserialize)]
struct ResetBody {
    email: String,
    #[serde(rename = "newPassword")]
    new_password: String,
    #[serde(rename = "inviteKey")]
    invite_key: String,
}

fn valid_email(email: &str) -> bool {
    let email = email.trim();
    email.len() >= 3 && email.len() <= 254 && email.contains('@') && !email.contains(char::is_whitespace)
}

/// Invite-key gate shared by register + reset-password. Returns Some(response)
/// when the request must be rejected.
fn check_invite(state: &WebState, peer_ip: IpAddr, provided: &str) -> Option<Response> {
    // Tight budget on invite guessing: 5 tries per 10 minutes.
    if state.limiter.limited("invite", peer_ip, 5, std::time::Duration::from_secs(600)) {
        return Some(json_error(StatusCode::TOO_MANY_REQUESTS, "too many attempts — try again later"));
    }
    let Some(expected) = state.config.invite_key.as_deref() else {
        return Some(json_error(StatusCode::FORBIDDEN, "registration disabled"));
    };
    if provided.is_empty() || !constant_time_eq(provided, expected) {
        state.limiter.record_failure("invite", peer_ip);
        eprintln!("[tanwords-web] failed invite-key attempt from {peer_ip}");
        return Some(json_error(StatusCode::FORBIDDEN, "invalid invite key"));
    }
    None
}

async fn login(
    State(state): State<WebState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<LoginBody>,
) -> Response {
    if state.limiter.limited("login", peer.ip(), 10, std::time::Duration::from_secs(600)) {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "too many failed logins — try again later");
    }
    match state.users.login(&body.email, &body.password).await {
        Ok(Some((user_id, token))) => {
            state.limiter.clear("login", peer.ip());
            eprintln!("[tanwords-web] login: user {user_id} from {}", peer.ip());
            Json(json!({ "token": token })).into_response()
        }
        Ok(None) => {
            state.limiter.record_failure("login", peer.ip());
            eprintln!("[tanwords-web] failed login for `{}` from {}", body.email, peer.ip());
            json_error(StatusCode::UNAUTHORIZED, "invalid credentials")
        }
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn register(
    State(state): State<WebState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<RegisterBody>,
) -> Response {
    if let Some(reject) = check_invite(&state, peer.ip(), &body.invite_key) {
        return reject;
    }
    if !valid_email(&body.email) {
        return json_error(StatusCode::BAD_REQUEST, "invalid email");
    }
    if body.password.len() < 8 {
        return json_error(StatusCode::BAD_REQUEST, "password must be at least 8 characters");
    }
    match state.users.register(&body.email, &body.password).await {
        Ok(user_id) => {
            state.limiter.clear("invite", peer.ip());
            eprintln!("[tanwords-web] registered user {user_id} ({}) from {}", body.email, peer.ip());
            // Registration logs you straight in.
            match state.users.login(&body.email, &body.password).await {
                Ok(Some((_, token))) => Json(json!({ "token": token })).into_response(),
                _ => json_error(StatusCode::INTERNAL_SERVER_ERROR, "registered but auto-login failed"),
            }
        }
        Err(e) if e == "email already registered" => json_error(StatusCode::BAD_REQUEST, e),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn reset_password(
    State(state): State<WebState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<ResetBody>,
) -> Response {
    if let Some(reject) = check_invite(&state, peer.ip(), &body.invite_key) {
        return reject;
    }
    if body.new_password.len() < 8 {
        return json_error(StatusCode::BAD_REQUEST, "password must be at least 8 characters");
    }
    match state.users.reset_password(&body.email, &body.new_password).await {
        Ok(true) => {
            eprintln!("[tanwords-web] password reset for `{}` from {}", body.email, peer.ip());
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => json_error(StatusCode::NOT_FOUND, "no such account"),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn logout(State(state): State<WebState>, request: Request) -> Response {
    if let Some(token) = bearer_token(&request).or_else(|| query_token(&request)) {
        let _ = state.users.logout(&token).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

/// Extension extractor must run after `require_session` has inserted it.
fn session_of(request: &Request) -> UserSession {
    request
        .extensions()
        .get::<UserSession>()
        .expect("require_session runs before handlers")
        .clone()
}

async fn me(request: Request) -> Response {
    let session = session_of(&request);
    Json(json!({ "email": session.email })).into_response()
}

// ── core RPC (same shapes as the desktop sidecar) ─────────────────────────

/// Commands the web build must not expose by name even though the dispatch
/// table contains them. Reasons, per entry: global desktop state (the
/// db_connect/disconnect family is reimplemented per-user below), cross-user
/// shared secret files, or arbitrary server-side filesystem paths.
const BLOCKED_COMMANDS: &[&str] = &[
    "db_switch_path",
    "db_connect_turso",
    "db_disconnect_remote",
    "db_forget_saved_profile",
    "db_get_remembered_turso",
    "db_saved_profile_is_turso",
    "secret_get",
    "secret_set",
    "secret_delete",
    "db_get_db_path",
    "db_export_backup",
    "db_import_analyze",
    "db_import_apply",
    "db_export_document_asset",
    "db_export_document_assets_to_folder",
    "db_export_document_assets_zip",
];

async fn invoke_handler(
    State(state): State<WebState>,
    Path(command): Path<String>,
    axum::Extension(session): axum::Extension<UserSession>,
    body: Bytes,
) -> Response {
    if BLOCKED_COMMANDS.contains(&command.as_str()) {
        return json_error(StatusCode::FORBIDDEN, format!("`{command}` is not available on the web build"));
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
            Err(e) => return json_error(StatusCode::BAD_REQUEST, format!("invalid JSON body: {e}")),
        }
    };
    match dispatch(&runtime.ctx, &command, Args::new(parsed)).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn events_handler(
    State(state): State<WebState>,
    request: Request,
) -> Response {
    let session = session_of(&request);
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    // Per-user broadcast: an event emitted by another user's runtime never
    // reaches this stream, because it never enters *their* AppHandle.
    let receiver = runtime.app.subscribe();
    let stream = tokio_stream::wrappers::BroadcastStream::new(receiver).filter_map(|item| async move {
        let event = item.ok()?;
        let data = json!({ "name": event.name, "payload": event.payload }).to_string();
        Some(Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().data(data)))
    });
    let mut shutdown = state.shutdown;
    // Web reverse proxies cut idle SSE streams; the desktop never needed
    // this. A 15s ping keeps the connection alive through nginx/Caddy.
    Sse::new(stream.take_until(async move {
        let _ = shutdown.changed().await;
    }))
    .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15)).text("ping"))
    .into_response()
}

// ── document assets: bytes by id, never by path ───────────────────────────

async fn asset_handler(
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
    match dispatch(&runtime.ctx, "db_get_document_asset", Args::new(json!({ "id": id }))).await {
        Ok(value) => {
            let mime = value
                .get("mime_type")
                .and_then(Value::as_str)
                .unwrap_or("application/octet-stream");
            // Bucket-backed assets carry a URL instead of bytes. Without this
            // the base64 field is an empty string, which decodes happily to
            // zero bytes — the browser would get a 200 with an empty file and
            // no hint that anything went wrong.
            if let Some(remote) = value.get("remote_url").and_then(Value::as_str) {
                return Redirect::temporary(remote).into_response();
            }
            let Some(data_b64) = value.get("data_base64").and_then(Value::as_str) else {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, "malformed asset row");
            };
            match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data_b64) {
                Ok(bytes) => (
                    [(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "private, max-age=31536000, immutable")],
                    bytes,
                )
                    .into_response(),
                Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "undecodable asset data"),
            }
        }
        Err(error) => json_error(StatusCode::NOT_FOUND, error),
    }
}

// ── import / export without OS file dialogs ───────────────────────────────

/// Desktop flow: user picks a file in a native dialog, then the frontend
/// calls `db_import_analyze` / `db_import_apply` with that local path. Web
/// flow: upload the file here first, get back a server-side temp path, then
/// call the very same commands with it.
async fn import_upload(
    State(state): State<WebState>,
    axum::Extension(_session): axum::Extension<UserSession>,
    mut multipart: Multipart,
) -> Response {
    fn sanitize(name: &str) -> String {
        let cleaned: String = name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
            .collect();
        let cleaned = cleaned.trim_start_matches('.').to_string();
        if cleaned.is_empty() { "import.bin".to_string() } else { cleaned }
    }

    let uploads = state.config.data_dir.join("uploads");
    if let Err(e) = tokio::fs::create_dir_all(&uploads).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("cannot create uploads dir: {e}"));
    }

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => return multipart_error(e),
        };
        if field.name() != Some("file") {
            continue;
        }
        let name = sanitize(field.file_name().unwrap_or("import.bin"));
        let path = uploads.join(format!("{}-{name}", uuid::Uuid::new_v4()));
        let mut file = match tokio::fs::File::create(&path).await {
            Ok(f) => f,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("cannot write upload: {e}")),
        };
        let mut field = field;
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    if let Err(e) = file.write_all(&chunk).await {
                        let _ = tokio::fs::remove_file(&path).await;
                        return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("upload write failed: {e}"));
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&path).await;
                    return multipart_error(e);
                }
            }
        }
        return Json(json!({ "path": path.to_string_lossy() })).into_response();
    }
    json_error(StatusCode::BAD_REQUEST, "multipart field `file` missing")
}

fn multipart_error(e: MultipartError) -> Response {
    json_error(StatusCode::BAD_REQUEST, format!("invalid multipart body: {e}"))
}

/// The desktop's import flow runs `db_import_analyze`/`db_import_apply` on a
/// user-picked local path. On web those two commands are blocked from general
/// invoke (they'd read arbitrary server paths) and re-exposed here, validated
/// to only accept paths this server minted under `uploads/`.
async fn import_step(
    State(state): State<WebState>,
    Path(step): Path<String>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(args): Json<Value>,
) -> Response {
    if step != "analyze" && step != "apply" {
        return json_error(StatusCode::NOT_FOUND, "not found");
    }
    let Some(path) = args.get("path").and_then(Value::as_str) else {
        return json_error(StatusCode::BAD_REQUEST, "missing path");
    };
    let uploads = state.config.data_dir.join("uploads").canonicalize();
    let candidate = std::path::Path::new(path).canonicalize();
    let (Ok(uploads), Ok(candidate)) = (uploads, candidate) else {
        return json_error(StatusCode::BAD_REQUEST, "unknown upload path");
    };
    if !candidate.starts_with(&uploads) {
        return json_error(StatusCode::FORBIDDEN, "path must be a server-issued upload");
    }
    // The underlying commands take `sourcePath`; our public route spells it
    // `path`. Rewrite before dispatch (Args camelCase→snake_case handles the
    // rest).
    let mut forwarded = args.clone();
    if let Some(obj) = forwarded.as_object_mut() {
        if let Some(v) = obj.remove("path") {
            obj.insert("sourcePath".to_string(), v);
        }
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let command = format!("db_import_{step}");
    match dispatch(&runtime.ctx, &command, Args::new(forwarded)).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

/// Runs the same VACUUM-based snapshot the desktop's `db_export_backup`
/// performs — only the destination is chosen server-side here. An optional
/// `X-Export-Password` header requests the encrypted format; kept out of the
/// URL so it cannot end up in access logs. The temp file is deleted as soon
/// as its bytes have been read into the response.
async fn export_backup(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    headers: HeaderMap,
) -> Response {
    let exports = state.config.data_dir.join("exports");
    if let Err(e) = tokio::fs::create_dir_all(&exports).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("cannot create exports dir: {e}"));
    }
    let password = headers
        .get("x-export-password")
        .and_then(|v| v.to_str().ok())
        .filter(|p| !p.trim().is_empty());
    let path = exports.join(format!("tanwords-backup-{}.tmp", uuid::Uuid::new_v4()));

    let mut args = json!({ "dest": path.to_string_lossy() });
    if let Some(password) = password {
        args["password"] = Value::from(password);
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    if let Err(error) = dispatch(&runtime.ctx, "db_export_backup", Args::new(args)).await {
        let _ = tokio::fs::remove_file(&path).await;
        return json_error(StatusCode::BAD_REQUEST, error);
    }
    let bytes = tokio::fs::read(&path).await;
    let _ = tokio::fs::remove_file(&path).await;
    let Ok(bytes) = bytes else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "export vanished before it could be served");
    };
    let unix_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let ext = if password.is_some() { "twbackup" } else { "db" };
    let filename = format!("tanwords-backup-{unix_ts}.{ext}");
    (
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
        ],
        bytes,
    )
        .into_response()
}

// ── per-user DB connection routes (web replacements for the blocked commands) ──

/// Shape compatible with what the desktop's DataSection reads: the live
/// descriptor plus the remembered-connection info the core used to expose as
/// separate commands. No secrets ever leave this route.
async fn db_profile(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let remembered = match state.users.remembered_turso(session.user_id).await {
        Ok((url, token_present)) => json!({ "url": url, "token_present": token_present }),
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    match dispatch(&runtime.ctx, "db_get_connection", Args::new(Value::Null)).await {
        Ok(connection) => Json(json!({ "connection": connection, "remembered": remembered })).into_response(),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

#[derive(Deserialize)]
struct TursoConnectBody {
    url: String,
    token: String,
}

/// Per-user db_connect_turso. Differences from the desktop command: the
/// replica path is scoped to this user's directory, and the profile persists
/// to users.db (AES-sealed token), never to the global appconfig/keychain.
async fn turso_connect(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<TursoConnectBody>,
) -> Response {
    let url = body.url.trim().to_string();
    let token = body.token.trim().to_string();
    if url.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "Please fill in the Turso database URL");
    }
    if token.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "Please fill in the Turso auth token");
    }

    // Save first, respawn second: if the open fails below we restore the old
    // stored profile and the caller sees the original working connection.
    let previous = match state.users.turso_for(session.user_id).await {
        Ok(p) => p.map(|p| (p.url, p.token)),
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let replica = state
        .pool
        .user_dir(session.user_id)
        .join("turso-replica.db");
    // New connection target = fresh replica, same lineage reasoning as the
    // desktop command's wipe (see db_connect_turso).
    for suffix in ["", "-wal", "-shm", "-client_wal_index", "-info"] {
        let _ = std::fs::remove_file(format!("{}{}", replica.display(), suffix));
    }
    let profile = DbProfile::Turso {
        path: replica.to_string_lossy().to_string(),
        url: url.clone(),
    };
    let database = match tanwords_lib::db::connection::open(&profile, Some(&token)).await {
        Ok(db) => db,
        Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
    };
    let descriptor = database.descriptor();

    if let Err(e) = state.users.set_turso(session.user_id, &url, &token).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let app_state = runtime.ctx.state::<AppState>();
    if let Err(e) = app_state.replace_db(database) {
        // Restore the stored profile so the next spawn reproduces the old state.
        match previous {
            Some((old_url, old_token)) => {
                let _ = state.users.set_turso(session.user_id, &old_url, &old_token).await;
            }
            None => {
                let _ = state.users.clear_turso(session.user_id).await;
            }
        }
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    Json(descriptor).into_response()
}

/// Back to the per-user local database; users.db forgets the Turso profile.
async fn turso_disconnect(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let local_path = state
        .pool
        .user_dir(session.user_id)
        .join("tanwords.db")
        .to_string_lossy()
        .to_string();
    let database = match tanwords_lib::db::connection::open(&DbProfile::Local { path: local_path }, None).await {
        Ok(db) => db,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let descriptor = database.descriptor();
    if let Err(e) = state.users.clear_turso(session.user_id).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let app_state = runtime.ctx.state::<AppState>();
    if let Err(e) = app_state.replace_db(database) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    Json(descriptor).into_response()
}

/// Shape-compatible with the desktop's `db_get_remembered_turso` command
/// result (`RememberedTursoConnection`), sourced from users.db instead of
/// appconfig+keychain.
async fn turso_remembered(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    match state.users.remembered_turso(session.user_id).await {
        Ok((url, token_present)) => Json(json!({ "url": url, "tokenPresent": token_present })).into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// Clears the user's saved Turso profile WITHOUT touching the live
/// connection the way `turso_disconnect` does. Mirrors the desktop's
/// `db_forget_saved_profile`: for a stuck/dead saved profile the user wants
/// gone.
async fn turso_forget(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    match state.users.clear_turso(session.user_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ── AI provider proxy (keys stay on the server) ───────────────────────────

/// Forwards provider API calls with the credential injected from the
/// encrypted `ai_providers` row, mirroring exactly how the desktop renderer's
/// providers authenticate (`x-api-key` for Anthropic, Bearer otherwise).
/// The response body — typically an SSE token stream — is proxied through
/// unbuffered, status included.
async fn ai_proxy(
    State(state): State<WebState>,
    Path((provider_id, rest)): Path<(String, String)>,
    axum::Extension(session): axum::Extension<UserSession>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let app_state = runtime.ctx.state::<AppState>();
    let conn = match db::conn(&app_state) {
        Ok(c) => c,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let device = tanwords_lib::appconfig::device_id();
    let providers = match db::ai_providers::list(&conn, &device).await {
        Ok(p) => p,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let Some(provider) = providers.into_iter().find(|p| p.id == provider_id) else {
        return json_error(StatusCode::NOT_FOUND, format!("unknown provider `{provider_id}`"));
    };
    let api_key = match db::ai_providers::key(&conn, &device, &provider_id).await {
        Ok(k) => k,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };

    let base = if !provider.api_base.trim().is_empty() {
        provider.api_base.trim_end_matches('/').to_string()
    } else if provider_id == "openai" {
        "https://api.openai.com/v1".to_string()
    } else if provider_id == "claude" {
        "https://api.anthropic.com".to_string()
    } else {
        return json_error(StatusCode::BAD_REQUEST, format!("provider `{provider_id}` has no base URL configured"));
    };

    let rest = rest.trim_start_matches('/');
    if rest.is_empty() || rest.contains("..") {
        return json_error(StatusCode::BAD_REQUEST, "invalid upstream path");
    }

    // Build a fresh header set: forward content intent, inject credentials —
    // never forward the caller's own Authorization/Cookie/Host headers, so a
    // web client cannot talk to the provider with anything but the stored key.
    let mut up_headers = reqwest::header::HeaderMap::new();
    if let Some(ct) = headers.get(header::CONTENT_TYPE) {
        up_headers.insert(reqwest::header::CONTENT_TYPE, ct.clone());
    }
    if let Some(accept) = headers.get(header::ACCEPT) {
        up_headers.insert(reqwest::header::ACCEPT, accept.clone());
    }
    let is_anthropic = provider_id == "claude";
    match HeaderValue::from_str(&api_key) {
        Ok(key_value) => {
            if is_anthropic {
                up_headers.insert("x-api-key", key_value);
                let version = headers
                    .get("anthropic-version")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("2023-06-01");
                if let Ok(v) = HeaderValue::from_str(version) {
                    up_headers.insert("anthropic-version", v);
                }
                if let Some(beta) = headers.get("anthropic-beta") {
                    up_headers.insert("anthropic-beta", beta.clone());
                }
            } else if !api_key.is_empty() {
                if let Ok(v) = HeaderValue::from_str(&format!("Bearer {api_key}")) {
                    up_headers.insert(reqwest::header::AUTHORIZATION, v);
                }
            }
        }
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "stored API key is not a valid header value"),
    }

    let upstream = match state
        .http
        .post(format!("{base}/{rest}"))
        .headers(up_headers)
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return json_error(StatusCode::BAD_GATEWAY, format!("upstream request failed: {e}")),
    };

    let status = StatusCode::from_u16(upstream.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let mut builder = Response::builder().status(status);
    if let Some(ct) = upstream.headers().get(reqwest::header::CONTENT_TYPE) {
        builder = builder.header(header::CONTENT_TYPE, ct);
    }
    // Pass the stream straight through: buffering an OpenAI/Anthropic SSE
    // completion would leave the chat UI blank until the model finished.
    builder
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "failed to build upstream response"))
}

// ── the SPA ───────────────────────────────────────────────────────────────

/// Minimal extension->MIME map; the frontend build only emits a handful.
fn content_type_for(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

/// Resolves a request path inside the dist dir; `..` is rejected up front.
fn resolve_dist(web_dist: &std::path::Path, uri_path: &str) -> Option<PathBuf> {
    let mut out = web_dist.to_path_buf();
    for component in std::path::Path::new(uri_path.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

async fn spa_handler(State(state): State<WebState>, request: Request) -> Response {
    if request.method() != axum::http::Method::GET && request.method() != axum::http::Method::HEAD {
        return json_error(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    let path = request.uri().path().to_string();

    // Unknown API-shaped paths must not silently return the app shell.
    for prefix in ["/api/", "/invoke/", "/events"] {
        if path.starts_with(prefix) {
            return json_error(StatusCode::NOT_FOUND, "not found");
        }
    }

    let (bytes, content_type, cache): (Vec<u8>, &'static str, &'static str) =
        if let Some(dist) = state.config.web_dist.as_ref() {
            let mut is_index = false;
            let mut is_hashed_asset = path.starts_with("/assets/");
            let mut file = match resolve_dist(dist, &path) {
                Some(f) if f.is_file() => f,
                _ => {
                    // SPA fallback: client-side routes get index.html.
                    is_index = true;
                    is_hashed_asset = false;
                    dist.join("index.html")
                }
            };
            if !is_index && file == *dist {
                is_index = true;
                file = dist.join("index.html");
            }

            let bytes = match tokio::fs::read(&file).await {
                Ok(bytes) => bytes,
                Err(_) => {
                    return json_error(
                        StatusCode::NOT_FOUND,
                        "not found (is the frontend built into TANWORDS_WEB_DIST?)",
                    );
                }
            };
            let content_type = content_type_for(&file);
            let cache = if is_index {
                "no-store"
            } else if is_hashed_asset {
                "public, max-age=31536000, immutable"
            } else {
                "public, max-age=3600"
            };
            (bytes, content_type, cache)
        } else {
            let relative = path.trim_start_matches('/');
            let mut is_index = false;
            let mut is_hashed_asset = path.starts_with("/assets/");
            let data = Assets::get(relative).or_else(|| {
                is_index = true;
                is_hashed_asset = false;
                Assets::get("index.html")
            });
            let Some(data) = data else {
                return json_error(
                    StatusCode::NOT_FOUND,
                    "not found (is the frontend built into TANWORDS_WEB_DIST?)",
                );
            };
            let served_path = if is_index { "index.html" } else { relative };
            let content_type = content_type_for(std::path::Path::new(served_path));
            let cache = if is_index {
                "no-store"
            } else if is_hashed_asset {
                "public, max-age=31536000, immutable"
            } else {
                "public, max-age=3600"
            };
            (data.data.into_owned(), content_type, cache)
        };

    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, cache),
        ],
        bytes,
    )
        .into_response()
}

// ── bring-up ──────────────────────────────────────────────────────────────

pub async fn serve(config: Config, users: Arc<UsersDb>, pool: Arc<RuntimePool>) -> Result<(), String> {
    let config = Arc::new(config);
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(());
    let state = WebState {
        users,
        limiter: Arc::new(RateLimiter::new()),
        pool,
        config: config.clone(),
        http: reqwest::Client::new(),
        shutdown: shutdown_rx,
    };

    let auth_routes = Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/register", post(register))
        .route("/api/auth/reset-password", post(reset_password));

    let protected = Router::new()
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        // Same reason as the import route below: attachments ride along as
        // base64 in the JSON body, well past axum's 2 MB default.
        .route("/invoke/{command}", post(invoke_handler).layer(DefaultBodyLimit::max(192 * 1024 * 1024)))
        // Import files can be hundreds of MB; axum's default 2MB body limit
        // would reject them before the handler runs.
        .route("/api/import/upload", post(import_upload).layer(DefaultBodyLimit::disable()))
        .route("/api/import/{step}", post(import_step))
        .route("/api/export/backup", get(export_backup))
        .route("/api/ai-proxy/{provider_id}/{*rest}", post(ai_proxy))
        .route("/api/db/profile", get(db_profile))
        .route("/api/db/turso/connect", post(turso_connect))
        .route("/api/db/turso/disconnect", post(turso_disconnect))
        .route("/api/db/turso/remembered", get(turso_remembered))
        .route("/api/db/turso/forget", post(turso_forget))
        // Consumed as URLs (EventSource, <img src>) as well as fetch — the
        // session middleware accepts ?token= on every gated route.
        .route("/events", get(events_handler))
        .route("/api/assets/{id}", get(asset_handler))
        .layer(middleware::from_fn_with_state(state.clone(), require_session));

    let app: Router = Router::new()
        .merge(auth_routes)
        .merge(protected)
        .fallback(spa_handler)
        .with_state(state);

    let ip: IpAddr = config
        .host
        .parse()
        .map_err(|_| format!("TANWORDS_HOST `{}` is not an IP address (use e.g. 127.0.0.1 or 0.0.0.0)", config.host))?;
    let addr = SocketAddr::new(ip, config.port);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("cannot bind {addr}: {e}"))?;

    eprintln!("[tanwords-web] listening on http://{addr}");
    eprintln!("[tanwords-web] data dir: {}", config.data_dir.display());
    match &config.web_dist {
        Some(dist) => eprintln!("[tanwords-web] serving SPA from: {}", dist.display()),
        None => eprintln!("[tanwords-web] serving embedded SPA (app/out/renderer)"),
    }
    if config.host == "0.0.0.0" {
        eprintln!("[tanwords-web] warning: bound to all interfaces — put an HTTPS reverse proxy in front before exposing beyond a trusted LAN.");
    }

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            // Wakes every open /events stream so graceful shutdown is not
            // held open by idle SSE connections.
            let _ = shutdown_tx.send(());
        })
        .await
        .map_err(|e| e.to_string())
}

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler");
        tokio::select! {
            _ = ctrl_c => {}
            _ = sigterm.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = ctrl_c.await;
    }
}
