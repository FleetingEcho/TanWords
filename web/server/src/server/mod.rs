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
//!   GET  /api/db/remote/status       session -> {"enabled":bool,"url":...}
//!   POST /api/db/remote/enable       session -> {"enabled":true,"url":...,"token":...} (provisions a dedicated sqld container for this account)
//!   POST /api/db/remote/rotate       session -> {"enabled":true,"url":...,"token":...} (new keypair; old tokens stop working; data untouched)
//!   POST /api/db/remote/disable      session -> {"enabled":false} (stops the container; data and the URL are kept for next enable)
//!   POST /api/ai-proxy/{id}/{*rest}  session, upstream passthrough with injected key
//!   GET  /*                          the SPA (built frontend), index.html fallback

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Request, State};
use axum::http::{header, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::Redirect;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tower_http::compression::CompressionLayer;

use tanwords_lib::rpc::dispatch::dispatch;
use tanwords_lib::rpc::Args;

use crate::auth::{bearer_token, RateLimiter};
use crate::browser_proxy;
use crate::config::Config;
use crate::runtime::{RuntimePool, UserRuntime};
use crate::users::UsersDb;

#[derive(Clone)]
pub(crate) struct WebState {
    pub(crate) users: Arc<UsersDb>,
    limiter: Arc<RateLimiter>,
    pool: Arc<RuntimePool>,
    config: Arc<Config>,
    pub(crate) http: reqwest::Client,
    shutdown: tokio::sync::watch::Receiver<()>,
}

/// What `require_session` leaves in request extensions for handlers.
///
/// Deliberately not the session token: no handler needs it (logout reads the
/// header itself), and a credential carried around in request extensions is a
/// credential that can end up somewhere it was never meant to go.
#[derive(Clone)]
pub(crate) struct UserSession {
    pub(crate) user_id: i64,
    pub(crate) email: String,
}

impl WebState {
    /// Resolve the caller's per-user runtime; the error is already a response.
    async fn runtime_for(&self, session: &UserSession) -> Result<Arc<UserRuntime>, Response> {
        self.pool
            .runtime_for(session.user_id)
            .await
            .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, e))
    }

    pub(crate) fn public_host(&self) -> Option<&str> {
        self.config.public_host.as_deref()
    }
}

pub(crate) fn json_error(status: StatusCode, error: impl Into<String>) -> Response {
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

/// The Browser-page filtering proxy sets an HttpOnly `tw_proxy` cookie on the
/// top-level page load so the subresource requests the returned HTML makes
/// stay authenticated without a token in every URL. This reads that cookie —
/// only on proxy paths — as a session token equivalent.
fn proxy_cookie_token(request: &Request) -> Option<String> {
    if !request.uri().path().starts_with("/api/browser/proxy") {
        return None;
    }
    for cookie in request.headers().get_all(header::COOKIE).iter() {
        if let Ok(s) = cookie.to_str() {
            for pair in s.split(';') {
                let pair = pair.trim();
                if let Some(value) = pair.strip_prefix("tw_proxy=") {
                    return Some(value.to_string());
                }
            }
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
    path == "/events" || path.starts_with("/api/assets/") || path.starts_with("/api/browser/proxy")
}

/// The one gate for everything past the auth routes: `Authorization: Bearer`,
/// or `?token=` on the two routes above. Valid sessions land in request
/// extensions as `UserSession`.
async fn require_session(
    State(state): State<WebState>,
    mut request: Request,
    next: Next,
) -> Response {
    let token = bearer_token(&request)
        .or_else(|| {
            accepts_query_token(request.uri().path())
                .then(|| query_token(&request))
                .flatten()
        })
        .or_else(|| proxy_cookie_token(&request));
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

mod ai;
mod auth;
mod backup;
mod db;
mod sqld_remote;
mod static_files;

use self::ai::ai_proxy;
use self::auth::{
    app_lock_disable, app_lock_set, app_lock_status, app_lock_verify, bootstrap, login, logout, me,
    register, reset_password, session_of,
};
use self::backup::{export_backup, import_step, import_upload};
use self::db::{
    db_profile, db_select_source, turso_connect, turso_disconnect, turso_forget, turso_remembered,
};
use self::sqld_remote::{sqld_remote_disable, sqld_remote_enable, sqld_remote_rotate, sqld_remote_status};
use self::static_files::spa_handler;

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
    match dispatch(&runtime.ctx, &command, Args::new(parsed)).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn events_handler(State(state): State<WebState>, request: Request) -> Response {
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

/// Headers every response carries.
///
/// Applied as a layer rather than per-handler so a route added later cannot
/// forget them. Values are deliberately conservative — this origin holds the
/// session JWT in localStorage, so an XSS here is a full account takeover
/// and the cheapest defences are worth having on by default.
async fn security_headers(request: Request, next: Next) -> Response {
    // The browser proxy's responses must be frameable by this app's shell — the
    // Browser page embeds `/api/browser/proxy?u=…` in an iframe. That includes
    // *error* responses: a 401 from the auth middleware ahead of the proxy, or
    // a 400/502 `json_error` from the proxy itself, set no framing headers of
    // their own, so without a permissive default here they would inherit the
    // app shell's `DENY` / `frame-ancestors 'none'` and the iframe would blank
    // with a CSP violation instead of showing the error. Success responses
    // (HTML/CSS) set their own framing headers (see browser_proxy.rs), which the
    // `contains_key` guards below respect. Everything outside the proxy stays
    // unframeable — clickjack protection for the app shell itself.
    let proxy_path = request.uri().path().starts_with("/api/browser/proxy");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    // Never let a declared Content-Type be second-guessed into something
    // executable.
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    // Nothing here is meaningful inside someone else's frame, and framing it
    // is how a clickjack starts. Respect a handler-set value: the browser
    // proxy sets SAMEORIGIN so the app shell can frame proxied pages, while
    // everything else stays DENY. For proxy paths the default is also
    // SAMEORIGIN so error responses (which set nothing) still frame.
    if !headers.contains_key(header::X_FRAME_OPTIONS) {
        headers.insert(
            header::X_FRAME_OPTIONS,
            if proxy_path {
                HeaderValue::from_static("SAMEORIGIN")
            } else {
                HeaderValue::from_static("DENY")
            },
        );
    }
    // Referrer would otherwise carry the path — and on the two routes that
    // still accept ?token=, the token — to whatever the page links to.
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    // The app has no business asking for any of these.
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("geolocation=(), camera=(), microphone=(), payment=(), usb=()"),
    );
    // Only set where it isn't already: the asset route ships its own, much
    // stricter, sandboxed policy, and the proxy ships `frame-ancestors 'self'`
    // on its HTML/CSS responses. For proxy *error* responses that set none,
    // fall back to `frame-ancestors 'self'` so the iframe can render the error
    // instead of being blanked by the app shell's `'none'`.
    if !headers.contains_key(header::CONTENT_SECURITY_POLICY) {
        if proxy_path {
            headers.insert(
                header::CONTENT_SECURITY_POLICY,
                HeaderValue::from_static("frame-ancestors 'self'"),
            );
        } else {
            headers.insert(
                header::CONTENT_SECURITY_POLICY,
                // 'unsafe-inline'/'unsafe-eval' for styles and scripts because the
                // bundled SPA and its markdown/mermaid rendering need them; the
                // clauses that matter here are the ones nailing down where content
                // may be *loaded from* and, above all, `frame-ancestors 'none'`
                // and `object-src 'none'`. `frame-src` lists the frames the app shell
                // is allowed to embed: `'self'` for the web Browser page's
                // same-origin proxy iframe (`/api/browser/proxy?u=…`), and
                // YouTube's privacy-enhanced host for the document editor's embeds.
                // (The proxy response carries its own `frame-ancestors 'self'` —
                // see browser_proxy.rs — so only this app can frame it.)
                HeaderValue::from_static(
                    "default-src 'self';                  script-src 'self' 'unsafe-inline' 'unsafe-eval';                  style-src 'self' 'unsafe-inline';                  img-src 'self' data: blob: https:;                  media-src 'self' data: blob: https:;                  font-src 'self' data:;                  connect-src 'self' blob:;                  worker-src 'self' blob:;                  frame-src 'self' https://www.youtube-nocookie.com;                  object-src 'none';                  base-uri 'none';                  form-action 'none';                  frame-ancestors 'none'",
                ),
            );
        }
    }
    response
}

// ── bring-up ──────────────────────────────────────────────────────────────

pub async fn serve(
    config: Config,
    users: Arc<UsersDb>,
    pool: Arc<RuntimePool>,
) -> Result<(), String> {
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
        .route("/api/auth/reset-password", post(reset_password))
        // Public: the browser-proxy Service Worker script. Static JS, no
        // secrets, and the browser's SW update fetch may not carry the
        // tw_proxy cookie, so it must not require a session.
        .route("/api/browser/proxy-sw.js", get(browser_proxy::proxy_sw));

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
        .route(
            "/invoke/{command}",
            post(invoke_handler).layer(DefaultBodyLimit::max(192 * 1024 * 1024)),
        )
        // Import files can be hundreds of MB; axum's default 2MB body limit
        // would reject them before the handler runs.
        .route(
            "/api/import/upload",
            post(import_upload).layer(DefaultBodyLimit::disable()),
        )
        .route("/api/import/{step}", post(import_step))
        .route("/api/export/backup", get(export_backup))
        .route("/api/ai-proxy/{provider_id}/{*rest}", post(ai_proxy))
        .route("/api/db/profile", get(db_profile))
        .route("/api/db/source", post(db_select_source))
        .route("/api/db/turso/connect", post(turso_connect))
        .route("/api/db/turso/disconnect", post(turso_disconnect))
        .route("/api/db/turso/remembered", get(turso_remembered))
        .route("/api/db/turso/forget", post(turso_forget))
        .route("/api/db/remote/status", get(sqld_remote_status))
        .route("/api/db/remote/enable", post(sqld_remote_enable))
        .route("/api/db/remote/rotate", post(sqld_remote_rotate))
        .route("/api/db/remote/disable", post(sqld_remote_disable))
        .route(
            "/api/browser/proxy",
            axum::routing::any(browser_proxy::browser_proxy)
                .layer(DefaultBodyLimit::max(browser_proxy::PROXY_BODY_LIMIT)),
        )
        // Consumed as URLs (EventSource, <img src>) as well as fetch — the
        // session middleware accepts ?token= on every gated route.
        .route("/events", get(events_handler))
        .route("/api/assets/{id}", get(asset_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_session,
        ));

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

    let ip: IpAddr = config.host.parse().map_err(|_| {
        format!(
            "TANWORDS_HOST `{}` is not an IP address (use e.g. 127.0.0.1 or 0.0.0.0)",
            config.host
        )
    })?;
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

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
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
