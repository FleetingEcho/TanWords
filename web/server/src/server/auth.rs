use std::net::{IpAddr, SocketAddr};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use super::{json_error, UserSession, WebState};
use crate::auth::{bearer_token, constant_time_eq};

// ── auth routes ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub(super) struct LoginBody {
    email: String,
    password: String,
}

#[derive(Deserialize)]
pub(super) struct RegisterBody {
    email: String,
    password: String,
    #[serde(rename = "inviteKey")]
    invite_key: String,
}

#[derive(Deserialize)]
pub(super) struct ResetBody {
    email: String,
    #[serde(rename = "newPassword")]
    new_password: String,
    /// Deliberately not the invite key — see Config::admin_key.
    #[serde(rename = "adminKey")]
    admin_key: String,
}

fn valid_email(email: &str) -> bool {
    let email = email.trim();
    email.len() >= 3
        && email.len() <= 254
        && email.contains('@')
        && !email.contains(char::is_whitespace)
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
    if state
        .limiter
        .limited(bucket, peer_ip, 5, std::time::Duration::from_secs(600))
    {
        return Some(json_error(
            StatusCode::TOO_MANY_REQUESTS,
            "too many attempts — try again later",
        ));
    }
    let Some(expected) = expected else {
        return Some(json_error(
            StatusCode::FORBIDDEN,
            closed_message.to_string(),
        ));
    };
    if provided.is_empty() || !constant_time_eq(provided, expected) {
        state.limiter.record_failure(bucket, peer_ip);
        eprintln!("[tanwords-web] failed {bucket}-key attempt from {peer_ip}");
        return Some(json_error(StatusCode::FORBIDDEN, "invalid key"));
    }
    None
}

pub(super) async fn login(
    State(state): State<WebState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Response {
    let peer_ip = client_ip(&state, &headers, peer);
    if state
        .limiter
        .limited("login", peer_ip, 10, std::time::Duration::from_secs(600))
    {
        return json_error(
            StatusCode::TOO_MANY_REQUESTS,
            "too many failed logins — try again later",
        );
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

pub(super) async fn register(
    State(state): State<WebState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RegisterBody>,
) -> Response {
    let peer_ip = client_ip(&state, &headers, peer);
    if let Some(reject) = check_key(
        &state,
        peer_ip,
        "invite",
        state.config.invite_key.as_deref(),
        &body.invite_key,
        "registration disabled",
    ) {
        return reject;
    }
    if !valid_email(&body.email) {
        return json_error(StatusCode::BAD_REQUEST, "invalid email");
    }
    if body.password.len() < 8 {
        return json_error(
            StatusCode::BAD_REQUEST,
            "password must be at least 8 characters",
        );
    }
    match state.users.register(&body.email, &body.password).await {
        Ok(user_id) => {
            state.limiter.clear("invite", peer_ip);
            eprintln!("[tanwords-web] registered user {user_id} from {peer_ip}");
            // Registration logs you straight in.
            match state.users.login(&body.email, &body.password).await {
                Ok(Some((_, token))) => Json(json!({ "token": token })).into_response(),
                _ => json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "registered but auto-login failed",
                ),
            }
        }
        Err(e) if e == "email already registered" => json_error(StatusCode::BAD_REQUEST, e),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

pub(super) async fn reset_password(
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
        &state,
        peer_ip,
        "admin",
        state.config.admin_key.as_deref(),
        &body.admin_key,
        "password reset disabled",
    ) {
        return reject;
    }
    if body.new_password.len() < 8 {
        return json_error(
            StatusCode::BAD_REQUEST,
            "password must be at least 8 characters",
        );
    }
    match state
        .users
        .reset_password(&body.email, &body.new_password)
        .await
    {
        Ok(true) => {
            eprintln!("[tanwords-web] password reset completed from {peer_ip}");
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => json_error(StatusCode::NOT_FOUND, "no such account"),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

pub(super) async fn logout(State(state): State<WebState>, request: Request) -> Response {
    if let Some(token) = bearer_token(&request) {
        let _ = state.users.logout(&token).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

/// Extension extractor must run after `require_session` has inserted it.
pub(super) fn session_of(request: &Request) -> UserSession {
    request
        .extensions()
        .get::<UserSession>()
        .expect("require_session runs before handlers")
        .clone()
}

pub(super) async fn me(request: Request) -> Response {
    let session = session_of(&request);
    Json(json!({ "email": session.email })).into_response()
}

/// One startup round-trip for the SPA: validates the session (in middleware),
/// returns the lock gate that must be known before painting private content,
/// and starts the heavier per-user database runtime in parallel. The response
/// deliberately does not wait for that runtime — route chunks and settings can
/// download while Turso/local SQLite opens, and the pool's spawn gate makes the
/// first `/invoke` naturally join the same initialization instead of duplicating it.
pub(super) async fn bootstrap(
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
pub(super) struct AppLockSetBody {
    current: Option<String>,
    next: String,
}

#[derive(Deserialize)]
pub(super) struct AppLockPasswordBody {
    password: String,
}

pub(super) async fn app_lock_status(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    match state.users.app_lock_enabled(session.user_id).await {
        Ok(enabled) => Json(json!({ "enabled": enabled })).into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

pub(super) async fn app_lock_set(
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

pub(super) async fn app_lock_disable(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<AppLockPasswordBody>,
) -> Response {
    match state
        .users
        .disable_app_lock(session.user_id, &body.password)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) if e == "Current password is incorrect" => json_error(StatusCode::BAD_REQUEST, e),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

pub(super) async fn app_lock_verify(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<AppLockPasswordBody>,
) -> Response {
    match state
        .users
        .verify_app_lock(session.user_id, &body.password)
        .await
    {
        Ok(valid) => Json(valid).into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}
