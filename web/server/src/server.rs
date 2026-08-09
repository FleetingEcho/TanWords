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
//!   POST /api/auth/reset-password    {"email","newPassword","adminKey"} -> 204 (ADMIN-gated, not invite)
//!   POST /api/auth/logout            Bearer                                     204
//!   GET  /api/auth/me                Bearer -> {"email"}
//!   POST /invoke/{command}           session, JSON args -> bare JSON | {"error"}
//!   GET  /events                     session, SSE (per-user broadcast)
//!   GET  /api/assets/{id}            session (Bearer or ?token=), document-asset bytes
//!   POST /api/import/upload          session, multipart "file" -> {"path"}
//!   POST /api/import/analyze|apply   session, {"path"} -> dispatch (validated under uploads/)
//!   GET  /api/export/backup?source=  session, local|turso + optional X-Export-Password -> db file
//!   GET  /api/db/profile             session -> {"connection":...,"remembered":{...}}
//!   POST /api/db/source              session, {"source":"local"|"turso"} -> descriptor
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
use axum::extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, Query, Request, State};
use axum::response::Redirect;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tower_http::compression::CompressionLayer;

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

/// Hard ceiling on a single import upload. The route disables axum's body
/// limit (a genuine backup can be hundreds of MB), so this is the only thing
/// standing between a logged-in user and the disk.
const MAX_UPLOAD_BYTES: u64 = 512 * 1024 * 1024;

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
///
/// Deliberately not the session token: no handler needs it (logout reads the
/// header itself), and a credential carried around in request extensions is a
/// credential that can end up somewhere it was never meant to go.
#[derive(Clone)]
struct UserSession {
    user_id: i64,
    email: String,
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

/// `?token=` lookup without pulling in a form-urlencode dependency: JWTs use
/// base64url segments (no `+`, `/`, or padding), so the raw value is exact for
/// the only tokens this server ever issues.
fn query_token(request: &Request) -> Option<String> {
    let query = request.uri().query()?;
    for pair in query.split('&') {
        if let Some(value) = pair.strip_prefix("token=") {
            return Some(value.to_string());
        }
    }
    None
}

/// Routes reached by URL rather than by fetch, where the caller has no way to
/// set a header: `EventSource` cannot, and neither can `<img src>`. Only these
/// accept `?token=`.
///
/// It used to be every gated route. A token in a URL is a token in the reverse
/// proxy's access log, in browser history, and in the Referer of anything the
/// page links onward to — so the exception stays as narrow as the two places
/// that actually need it.
fn accepts_query_token(path: &str) -> bool {
    path == "/events" || path.starts_with("/api/assets/")
}

/// The one gate for everything past the auth routes: `Authorization: Bearer`,
/// or `?token=` on the two routes above. Valid sessions land in request
/// extensions as `UserSession`.
async fn require_session(State(state): State<WebState>, mut request: Request, next: Next) -> Response {
    let token = bearer_token(&request).or_else(|| {
        accepts_query_token(request.uri().path())
            .then(|| query_token(&request))
            .flatten()
    });
    let Some(token) = token else {
        return json_error(StatusCode::UNAUTHORIZED, "missing token");
    };
    match state.users.validate(&token).await {
        Ok(Some(user)) => {
            request.extensions_mut().insert(UserSession {
                user_id: user.id,
                email: user.email,
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
    /// Deliberately not the invite key — see Config::admin_key.
    #[serde(rename = "adminKey")]
    admin_key: String,
}

fn valid_email(email: &str) -> bool {
    let email = email.trim();
    email.len() >= 3 && email.len() <= 254 && email.contains('@') && !email.contains(char::is_whitespace)
}

/// The address the rate limiter should count against.
///
/// `ConnectInfo` is the peer that opened the TCP connection, which behind a
/// reverse proxy is the proxy — every user then shares one bucket, and one
/// attacker burning the login budget locks out everybody. So when the operator
/// has declared a proxy (TANWORDS_TRUST_PROXY), take the last hop in
/// `X-Forwarded-For`: entries to its left are supplied by the client and can
/// say anything, the rightmost is the one our own proxy appended.
///
/// Off by default. A server that believes this header without being told to
/// lets any caller forge a fresh identity per request and skip the limiter.
fn client_ip(state: &WebState, headers: &HeaderMap, peer: SocketAddr) -> IpAddr {
    if !state.config.trust_proxy {
        return peer.ip();
    }
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit(',').next())
        .and_then(|v| v.trim().parse::<IpAddr>().ok())
        .unwrap_or_else(|| peer.ip())
}

/// Checks one of the two keys; Some(response) means reject.
///
/// `bucket` names the door and separates the budgets — guessing at the admin
/// key must not be funded by the registration allowance, and vice versa.
fn check_key(
    state: &WebState,
    peer_ip: IpAddr,
    bucket: &str,
    expected: Option<&str>,
    provided: &str,
    closed_message: &str,
) -> Option<Response> {
    // Tight budget on key guessing: 5 tries per 10 minutes.
    if state.limiter.limited(bucket, peer_ip, 5, std::time::Duration::from_secs(600)) {
        return Some(json_error(StatusCode::TOO_MANY_REQUESTS, "too many attempts — try again later"));
    }
    let Some(expected) = expected else {
        return Some(json_error(StatusCode::FORBIDDEN, closed_message.to_string()));
    };
    if provided.is_empty() || !constant_time_eq(provided, expected) {
        state.limiter.record_failure(bucket, peer_ip);
        eprintln!("[tanwords-web] failed {bucket}-key attempt from {peer_ip}");
        return Some(json_error(StatusCode::FORBIDDEN, "invalid key"));
    }
    None
}

async fn login(
    State(state): State<WebState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Response {
    let peer_ip = client_ip(&state, &headers, peer);
    if state.limiter.limited("login", peer_ip, 10, std::time::Duration::from_secs(600)) {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "too many failed logins — try again later");
    }
    match state.users.login(&body.email, &body.password).await {
        Ok(Some((user_id, token))) => {
            state.limiter.clear("login", peer_ip);
            eprintln!("[tanwords-web] login: user {user_id} from {peer_ip}");
            Json(json!({ "token": token })).into_response()
        }
        Ok(None) => {
            state.limiter.record_failure("login", peer_ip);
            // The address, not the address *and* the address they typed: a
            // failed-login log that echoes attacker-supplied strings is a log
            // an attacker can write to.
            eprintln!("[tanwords-web] failed login from {peer_ip}");
            json_error(StatusCode::UNAUTHORIZED, "invalid credentials")
        }
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn register(
    State(state): State<WebState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RegisterBody>,
) -> Response {
    let peer_ip = client_ip(&state, &headers, peer);
    if let Some(reject) = check_key(
        &state, peer_ip, "invite",
        state.config.invite_key.as_deref(), &body.invite_key,
        "registration disabled",
    ) {
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
            state.limiter.clear("invite", peer_ip);
            eprintln!("[tanwords-web] registered user {user_id} from {peer_ip}");
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
    headers: HeaderMap,
    Json(body): Json<ResetBody>,
) -> Response {
    // The ADMIN key, not the invite key. See Config::admin_key: the invite key
    // is in the hands of everyone you invited, and this route sets an
    // arbitrary account's password by email address alone.
    let peer_ip = client_ip(&state, &headers, peer);
    if let Some(reject) = check_key(
        &state, peer_ip, "admin",
        state.config.admin_key.as_deref(), &body.admin_key,
        "password reset disabled",
    ) {
        return reject;
    }
    if body.new_password.len() < 8 {
        return json_error(StatusCode::BAD_REQUEST, "password must be at least 8 characters");
    }
    match state.users.reset_password(&body.email, &body.new_password).await {
        Ok(true) => {
            eprintln!("[tanwords-web] password reset completed from {peer_ip}");
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => json_error(StatusCode::NOT_FOUND, "no such account"),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn logout(State(state): State<WebState>, request: Request) -> Response {
    if let Some(token) = bearer_token(&request) {
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

/// One startup round-trip for the SPA: validates the session (in middleware),
/// returns the lock gate that must be known before painting private content,
/// and starts the heavier per-user database runtime in parallel. The response
/// deliberately does not wait for that runtime — route chunks and settings can
/// download while Turso/local SQLite opens, and the pool's spawn gate makes the
/// first `/invoke` naturally join the same initialization instead of duplicating it.
async fn bootstrap(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let app_lock_enabled = match state.users.app_lock_enabled(session.user_id).await {
        Ok(enabled) => enabled,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };

    let pool = state.pool.clone();
    let user_id = session.user_id;
    tokio::spawn(async move {
        if let Err(error) = pool.runtime_for(user_id).await {
            eprintln!("[tanwords-web] user {user_id}: runtime prewarm failed: {error}");
        }
    });

    Json(json!({
        "email": session.email,
        "appLockEnabled": app_lock_enabled,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct AppLockSetBody {
    current: Option<String>,
    next: String,
}

#[derive(Deserialize)]
struct AppLockPasswordBody {
    password: String,
}

async fn app_lock_status(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    match state.users.app_lock_enabled(session.user_id).await {
        Ok(enabled) => Json(json!({ "enabled": enabled })).into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn app_lock_set(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<AppLockSetBody>,
) -> Response {
    match state
        .users
        .set_app_lock(session.user_id, body.current.as_deref(), &body.next)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) if e == "Current password is incorrect" || e.starts_with("Password must") => {
            json_error(StatusCode::BAD_REQUEST, e)
        }
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn app_lock_disable(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<AppLockPasswordBody>,
) -> Response {
    match state.users.disable_app_lock(session.user_id, &body.password).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) if e == "Current password is incorrect" => json_error(StatusCode::BAD_REQUEST, e),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn app_lock_verify(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<AppLockPasswordBody>,
) -> Response {
    match state.users.verify_app_lock(session.user_id, &body.password).await {
        Ok(valid) => Json(valid).into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ── core RPC (same shapes as the desktop sidecar) ─────────────────────────

async fn invoke_handler(
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
            eprintln!("[tanwords-web] user {} attempted blocked command `{command}` ({reason})", session.user_id);
        }
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
                    return json_error(StatusCode::INTERNAL_SERVER_ERROR, "asset has an unusable remote URL");
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
                        (header::CACHE_CONTROL, "private, max-age=31536000, immutable"),
                        // Belt and braces with the filter above: no sniffing
                        // an octet-stream back into something executable.
                        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                        // A sandboxed CSP so even an image/svg+xml — which can
                        // carry script — has nothing it is allowed to do.
                        (header::CONTENT_SECURITY_POLICY, "default-src 'none'; sandbox"),
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
    let mime = mime.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
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

// ── import / export without OS file dialogs ───────────────────────────────

/// Desktop flow: user picks a file in a native dialog, then the frontend
/// calls `db_import_analyze` / `db_import_apply` with that local path. Web
/// flow: upload the file here first, get back a server-side temp path, then
/// call the very same commands with it.
async fn import_upload(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
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

    // Per user, not one shared folder. `import_step` can then prove a path
    // belongs to *this* caller instead of merely proving it is somewhere under
    // uploads/ — which made cross-user access a matter of learning a uuid
    // rather than a matter of authorization.
    let uploads = uploads_dir(&state, session.user_id);
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
        let mut written: u64 = 0;
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    // The route disables axum's body limit because a real
                    // import can be hundreds of MB; that is not the same as
                    // agreeing to write an unbounded stream to disk. Without
                    // this, any logged-in user can fill the volume.
                    written += chunk.len() as u64;
                    if written > MAX_UPLOAD_BYTES {
                        let _ = tokio::fs::remove_file(&path).await;
                        return json_error(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            format!("upload exceeds the {} MB limit", MAX_UPLOAD_BYTES / 1024 / 1024),
                        );
                    }
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

/// Where this user's uploads live. Per-user so that "is this path an upload?"
/// and "is this path *your* upload?" are the same question.
fn uploads_dir(state: &WebState, user_id: i64) -> PathBuf {
    state.config.data_dir.join("users").join(user_id.to_string()).join("uploads")
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
    // This caller's upload directory, not the shared one: proving a path sits
    // under uploads/ proved nothing about whose upload it was.
    let uploads = uploads_dir(&state, session.user_id).canonicalize();
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

#[derive(Deserialize)]
struct ExportQuery {
    source: Option<String>,
}

/// Runs the same VACUUM-based snapshot the desktop's `db_export_backup`
/// performs — only the destination and source are chosen server-side here. The
/// source is a closed enum, never a client path. An optional
/// `X-Export-Password` header requests the encrypted format; kept out of the
/// URL so it cannot end up in access logs. The temp file is deleted as soon
/// as its bytes have been read into the response.
async fn export_backup(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Query(query): Query<ExportQuery>,
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
    let requested = query.source.as_deref().unwrap_or("active");
    if !matches!(requested, "active" | "local" | "turso") {
        return json_error(StatusCode::BAD_REQUEST, "export source must be `local` or `turso`");
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let active_kind = match runtime.ctx.state::<AppState>().descriptor() {
        Ok(descriptor) => descriptor.kind,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let use_active = requested == "active"
        || (requested == "local" && active_kind == tanwords_lib::db::connection::DbKind::Local)
        || (requested == "turso" && active_kind == tanwords_lib::db::connection::DbKind::Turso);

    let result = if use_active {
        if requested == "turso" {
            if let Err(error) = dispatch(&runtime.ctx, "db_sync_now", Args::new(Value::Null)).await {
                return json_error(StatusCode::BAD_REQUEST, error);
            }
        }
        dispatch(&runtime.ctx, "db_export_backup", Args::new(args)).await
    } else {
        let user_dir = state.pool.user_dir(session.user_id);
        let database = if requested == "local" {
            let profile = DbProfile::Local {
                path: user_dir.join("tanwords.db").to_string_lossy().to_string(),
            };
            tanwords_lib::db::connection::open(&profile, None).await
        } else {
            let turso = match state.users.turso_for(session.user_id).await {
                Ok(Some(profile)) => profile,
                Ok(None) => {
                    return json_error(StatusCode::BAD_REQUEST, "No Turso connection is saved for this account")
                }
                Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
            };
            let profile = DbProfile::Turso {
                path: user_dir.join("turso-replica.db").to_string_lossy().to_string(),
                url: turso.url,
            };
            tanwords_lib::db::connection::open(&profile, Some(&turso.token)).await
        };
        match database {
            Ok(database) => {
                let (registry, app) = tanwords_lib::build_state_for(database, None).await;
                let ctx = tanwords_lib::rpc::Ctx::new(registry, app);
                dispatch(&ctx, "db_export_backup", Args::new(args)).await
            }
            Err(error) => Err(error),
        }
    };
    if let Err(error) = result {
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
    let ext = if password.is_some() { "zip" } else { "db" };
    let source_name = if requested == "active" {
        match active_kind {
            tanwords_lib::db::connection::DbKind::Local => "local",
            tanwords_lib::db::connection::DbKind::Turso => "turso",
        }
    } else {
        requested
    };
    let filename = format!("tanwords-{source_name}-backup-{unix_ts}.{ext}");
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
struct DbSourceBody {
    source: String,
}

/// Selects one of this account's two fixed database files. Paths are derived
/// exclusively from the authenticated user id; the client never supplies one.
/// Switching local deliberately preserves remembered Turso credentials.
async fn db_select_source(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<DbSourceBody>,
) -> Response {
    let source = body.source.trim().to_ascii_lowercase();
    if source != "local" && source != "turso" {
        return json_error(StatusCode::BAD_REQUEST, "database source must be `local` or `turso`");
    }

    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let app_state = runtime.ctx.state::<AppState>();
    let previous = match app_state.descriptor() {
        Ok(descriptor) => if descriptor.kind == tanwords_lib::db::connection::DbKind::Turso { "turso" } else { "local" },
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let user_dir = state.pool.user_dir(session.user_id);
    let database = if source == "local" {
        let profile = DbProfile::Local {
            path: user_dir.join("tanwords.db").to_string_lossy().to_string(),
        };
        match tanwords_lib::db::connection::open(&profile, None).await {
            Ok(db) => db,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        }
    } else {
        let turso = match state.users.turso_for(session.user_id).await {
            Ok(Some(profile)) => profile,
            Ok(None) => return json_error(StatusCode::BAD_REQUEST, "No Turso connection is saved for this account"),
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let profile = DbProfile::Turso {
            path: user_dir.join("turso-replica.db").to_string_lossy().to_string(),
            url: turso.url,
        };
        match tanwords_lib::db::connection::open(&profile, Some(&turso.token)).await {
            Ok(db) => db,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
        }
    };
    let descriptor = database.descriptor();

    if let Err(e) = state.users.set_active_db(session.user_id, &source).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = app_state.replace_db(database) {
        let _ = state.users.set_active_db(session.user_id, previous).await;
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    Json(descriptor).into_response()
}

#[derive(Deserialize)]
struct TursoConnectBody {
    url: String,
    token: String,
}

/// Turso URLs are spelled `libsql://host`; the guard speaks http(s), and the
/// host is what actually gets checked.
fn turso_probe_url(url: &str) -> String {
    match url.strip_prefix("libsql://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    }
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
    if url.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "Please fill in the Turso database URL");
    }
    let previous = match state.users.turso_for(session.user_id).await {
        Ok(profile) => profile,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    // An empty token means "reuse the remembered token", but only for the same
    // URL. Never apply one database's credential to a newly typed endpoint.
    let token = if body.token.trim().is_empty() {
        match previous.as_ref().filter(|profile| profile.url == url) {
            Some(profile) => profile.token.clone(),
            None => return json_error(StatusCode::BAD_REQUEST, "Please fill in the Turso auth token"),
        }
    } else {
        body.token.trim().to_string()
    };
    // Another URL the caller picks and the server dials. libsql speaks to it
    // over HTTP, so the same private-range refusal applies.
    if let Err(e) = tanwords_lib::http_util::guard::resolve_public(&turso_probe_url(&url)).await {
        return json_error(StatusCode::BAD_REQUEST, e);
    }

    // Save first, respawn second: if replacing the live database fails below we
    // restore the old stored profile and the caller sees the original working
    // connection.
    let previous = previous.map(|p| (p.url, p.token));
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

    // `api_base` is set by the user through ai_provider_upsert, so this is a
    // URL of their choosing that the *server* dials — the same SSRF the core's
    // fetch guard exists for. Without this, pointing a "provider" at
    // 169.254.169.254 turns the proxy into a reader for the cloud metadata
    // service, credentials included, and streams the answer back.
    let target = format!("{base}/{rest}");
    if let Err(e) = tanwords_lib::http_util::guard::resolve_public(&target).await {
        return json_error(StatusCode::BAD_REQUEST, e);
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
        .post(&target)
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

/// Headers every response carries.
///
/// Applied as a layer rather than per-handler so a route added later cannot
/// forget them. Values are deliberately conservative — this origin holds the
/// session JWT in localStorage, so an XSS here is a full account takeover
/// and the cheapest defences are worth having on by default.
async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    // Never let a declared Content-Type be second-guessed into something
    // executable.
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    // Nothing here is meaningful inside someone else's frame, and framing it
    // is how a clickjack starts.
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    // Referrer would otherwise carry the path — and on the two routes that
    // still accept ?token=, the token — to whatever the page links to.
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    // The app has no business asking for any of these.
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("geolocation=(), camera=(), microphone=(), payment=(), usb=()"),
    );
    // Only set where it isn't already: the asset route ships its own, much
    // stricter, sandboxed policy.
    if !headers.contains_key(header::CONTENT_SECURITY_POLICY) {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            // 'unsafe-inline'/'unsafe-eval' for styles and scripts because the
            // bundled SPA and its markdown/mermaid rendering need them; the
            // clauses that matter here are the ones nailing down where content
            // may be *loaded from* and, above all, `frame-ancestors 'none'`
            // and `object-src 'none'`. YouTube's privacy-enhanced host is the
            // sole frame source because the document editor renders its embeds
            // in an iframe; without an explicit `frame-src`, `default-src
            // 'self'` blocks every video in the web build.
            HeaderValue::from_static(
                "default-src 'self';                  script-src 'self' 'unsafe-inline' 'unsafe-eval';                  style-src 'self' 'unsafe-inline';                  img-src 'self' data: blob: https:;                  media-src 'self' data: blob: https:;                  font-src 'self' data:;                  connect-src 'self' blob:;                  worker-src 'self' blob:;                  frame-src https://www.youtube-nocookie.com;                  object-src 'none';                  base-uri 'none';                  form-action 'none';                  frame-ancestors 'none'",
            ),
        );
    }
    response
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
        .route("/api/auth/bootstrap", get(bootstrap))
        .route("/api/app-lock/status", get(app_lock_status))
        .route("/api/app-lock/set", post(app_lock_set))
        .route("/api/app-lock/disable", post(app_lock_disable))
        .route("/api/app-lock/verify", post(app_lock_verify))
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
        .route("/api/db/source", post(db_select_source))
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
        // Hashed JS/CSS already cache immutably; compression cuts the initial
        // transfer itself (especially when no reverse proxy is configured).
        // Brotli is preferred by modern browsers, with gzip as the fallback.
        .layer(CompressionLayer::new())
        .layer(middleware::from_fn(security_headers))
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
        if !config.trust_proxy {
            // Worth shouting about: behind a proxy without this, every caller
            // shares one rate-limit bucket, so ten failed logins from anyone
            // lock out everyone.
            eprintln!("[tanwords-web] warning: TANWORDS_TRUST_PROXY is not set. If a reverse proxy sits in front, rate limits count the proxy's address and apply to all users at once.");
        }
    }
    if config.trust_proxy {
        eprintln!("[tanwords-web] X-Forwarded-For is trusted — only correct if nothing can reach this port except your proxy.");
    }
    if config.admin_key.is_none() {
        eprintln!("[tanwords-web] note: TANWORDS_ADMIN_KEY is not set — password reset is closed.");
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
