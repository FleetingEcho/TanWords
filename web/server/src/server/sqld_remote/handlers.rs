//! HTTP handlers for the per-user dedicated sqld container feature. See the
//! parent [`super`] module for the full design — this file only holds the
//! axum route handlers (`status`/`enable`/`rotate`/`disable`) and the two
//! small private helpers they share (`success_json`, `finish_connect`).
//!
//! All of the actual plumbing (Docker/Caddy admin calls, keypair + token
//! signing, web-session connection switching) lives in [`super`] and is
//! reached here via `use super::{...}` — the bodies are otherwise unchanged
//! from when they were inlined in the parent module.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};

use super::{
    allocate_port, container_name, docker_container_action, docker_container_create,
    docker_container_remove, generate_keypair_der, public_host, resync_caddy_routes, sign_token,
    switch_web_session_to_local, switch_web_session_to_remote,
};
use super::super::{json_error, UserSession, WebState};

pub(in crate::server) async fn sqld_remote_status(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    match state.users.sqld_remote_for(session.user_id).await {
        Ok(Some(profile)) => {
            let host = match public_host(&state) {
                Ok(h) => h,
                Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
            };
            axum::Json(json!({
                "enabled": profile.enabled,
                "url": format!("https://{host}:{}", profile.port),
            }))
            .into_response()
        }
        Ok(None) => axum::Json(json!({ "enabled": false, "url": Value::Null })).into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

fn success_json(host: &str, port: i64, token: &str) -> Response {
    axum::Json(json!({
        "enabled": true,
        "url": format!("https://{host}:{port}"),
        "token": token,
    }))
    .into_response()
}

/// Signs a token for `key_der`, switches this web session onto the
/// container that key belongs to (so browser and Electron share the exact
/// same live data — see the block above), and returns the response the
/// frontend expects. The one place all three enable/rotate paths converge.
async fn finish_connect(state: &WebState, session: &UserSession, host: &str, port: i64, key_der: &[u8]) -> Response {
    let token = match sign_token(key_der) {
        Ok(t) => t,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    if let Err(e) = switch_web_session_to_remote(state, session, &token).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    success_json(host, port, &token)
}

/// Turns this account's data into something a desktop app can connect to
/// directly (Settings > Cloud tab), sharing it live. Re-enabling after a
/// prior `disable` reuses the existing container's data — this only creates
/// a new container (and a new keypair) the very first time.
pub(in crate::server) async fn sqld_remote_enable(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let host = match public_host(&state) {
        Ok(h) => h.to_string(),
        Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
    };
    let existing = match state.users.sqld_remote_for(session.user_id).await {
        Ok(profile) => profile,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };

    if let Some(profile) = existing {
        if profile.enabled {
            // Already on: still make sure Caddy actually has the route (a
            // Caddy restart reloads its static on-disk Caddyfile, which
            // never contains dynamically-pushed per-user vhosts, so this
            // no-op path has to self-heal too, not just the two below).
            if let Err(e) = resync_caddy_routes(&state).await {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
            }
            return finish_connect(&state, &session, &host, profile.port, &profile.key_der).await;
        }
        // Previously provisioned, then disabled: the container and its
        // volume still exist, just stopped — start it back up rather than
        // creating a second one.
        if let Err(e) = docker_container_action(&state, &container_name(session.user_id), "start").await {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        if let Err(e) = state.users.set_sqld_enabled(session.user_id, true).await {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        if let Err(e) = resync_caddy_routes(&state).await {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        return finish_connect(&state, &session, &host, profile.port, &profile.key_der).await;
    }

    // First time: fresh keypair, a newly allocated port, a fresh container.
    let key_der = match generate_keypair_der() {
        Ok(k) => k,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let port = match allocate_port(&state).await {
        Ok(p) => p,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    if let Err(e) = docker_container_create(&state, session.user_id, &key_der).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = docker_container_action(&state, &container_name(session.user_id), "start").await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = state.users.set_sqld_remote(session.user_id, port, &key_der).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = resync_caddy_routes(&state).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    finish_connect(&state, &session, &host, port, &key_der).await
}

/// Invalidates every token signed under the old keypair. The container is
/// recreated (Docker has no way to swap an existing container's env vars in
/// place) but bound to the *same* volume, so the data itself is untouched —
/// only the trusted public key changes. The frontend gates this behind a
/// confirm dialog since it immediately breaks whatever's currently connected.
pub(in crate::server) async fn sqld_remote_rotate(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let host = match public_host(&state) {
        Ok(h) => h.to_string(),
        Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
    };
    let existing = match state.users.sqld_remote_for(session.user_id).await {
        Ok(Some(profile)) => profile,
        Ok(None) => return json_error(StatusCode::BAD_REQUEST, "Remote access isn't enabled yet"),
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };

    let key_der = match generate_keypair_der() {
        Ok(k) => k,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let name = container_name(session.user_id);
    // Stop (SIGTERM, graceful) before removing — `docker_container_remove`'s
    // `force=true` is a SIGKILL against whatever's still running, and forcing
    // a kill against a live sqld primary can lose the tail of its WAL that
    // hadn't been checkpointed yet. Confirmed as a real data-loss bug this
    // session: two rotations in quick succession against the real server
    // silently dropped rows written moments earlier. Stopping first gives
    // sqld its own shutdown path; the volume (and therefore the data) is
    // never touched by either step regardless.
    if let Err(e) = docker_container_action(&state, &name, "stop").await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = docker_container_remove(&state, &name).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = docker_container_create(&state, session.user_id, &key_der).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = docker_container_action(&state, &name, "start").await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = state
        .users
        .set_sqld_remote(session.user_id, existing.port, &key_der)
        .await
    {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    // Port/container name are unchanged, so Caddy's existing route is still
    // correct — no config push needed here.
    finish_connect(&state, &session, &host, existing.port, &key_der).await
}

/// Stops (never removes) the container — data and the allocated port are
/// kept, so a later `enable` is cheap and doesn't orphan a second volume.
pub(in crate::server) async fn sqld_remote_disable(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let existing = match state.users.sqld_remote_for(session.user_id).await {
        Ok(Some(profile)) => profile,
        Ok(None) => return json_error(StatusCode::BAD_REQUEST, "Remote access isn't enabled"),
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    if !existing.enabled {
        return axum::Json(json!({ "enabled": false })).into_response();
    }
    if let Err(e) = docker_container_action(&state, &container_name(session.user_id), "stop").await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = state.users.set_sqld_enabled(session.user_id, false).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = resync_caddy_routes(&state).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    // The container just stopped — a web session still pointed at it would be
    // stranded on a dead connection, so fall back to the plain local file.
    if let Err(e) = switch_web_session_to_local(&state, &session).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    axum::Json(json!({ "enabled": false })).into_response()
}
