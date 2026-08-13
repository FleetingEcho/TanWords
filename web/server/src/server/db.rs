use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use tanwords_lib::db::connection::DbProfile;
use tanwords_lib::rpc::dispatch::dispatch;
use tanwords_lib::rpc::Args;
use tanwords_lib::AppState;

use super::{json_error, UserSession, WebState};

// ── per-user DB connection routes (web replacements for the blocked commands) ──

/// Shape compatible with what the desktop's DataSection reads: the live
/// descriptor plus the remembered-connection info the core used to expose as
/// separate commands. No secrets ever leave this route.
pub(super) async fn db_profile(
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
        Ok(connection) => {
            Json(json!({ "connection": connection, "remembered": remembered })).into_response()
        }
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

#[derive(Deserialize)]
pub(super) struct DbSourceBody {
    source: String,
}

/// Selects one of this account's two fixed database files. Paths are derived
/// exclusively from the authenticated user id; the client never supplies one.
/// Switching local deliberately preserves remembered Turso credentials.
pub(super) async fn db_select_source(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<DbSourceBody>,
) -> Response {
    let source = body.source.trim().to_ascii_lowercase();
    if source != "local" && source != "turso" {
        return json_error(
            StatusCode::BAD_REQUEST,
            "database source must be `local` or `turso`",
        );
    }

    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let app_state = runtime.ctx.state::<AppState>();
    let previous = match app_state.descriptor() {
        Ok(descriptor) => {
            if descriptor.kind == tanwords_lib::db::connection::DbKind::Turso {
                "turso"
            } else {
                "local"
            }
        }
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
            Ok(None) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "No Turso connection is saved for this account",
                )
            }
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let profile = DbProfile::Turso {
            path: user_dir
                .join("turso-replica.db")
                .to_string_lossy()
                .to_string(),
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
pub(super) struct TursoConnectBody {
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
pub(super) async fn turso_connect(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<TursoConnectBody>,
) -> Response {
    let url = body.url.trim().to_string();
    if url.is_empty() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "Please fill in the Turso database URL",
        );
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
            None => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "Please fill in the Turso auth token",
                )
            }
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
                let _ = state
                    .users
                    .set_turso(session.user_id, &old_url, &old_token)
                    .await;
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
pub(super) async fn turso_disconnect(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let local_path = state
        .pool
        .user_dir(session.user_id)
        .join("tanwords.db")
        .to_string_lossy()
        .to_string();
    let database = match tanwords_lib::db::connection::open(
        &DbProfile::Local { path: local_path },
        None,
    )
    .await
    {
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
pub(super) async fn turso_remembered(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    match state.users.remembered_turso(session.user_id).await {
        Ok((url, token_present)) => {
            Json(json!({ "url": url, "tokenPresent": token_present })).into_response()
        }
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// Clears the user's saved Turso profile WITHOUT touching the live
/// connection the way `turso_disconnect` does. Mirrors the desktop's
/// `db_forget_saved_profile`: for a stuck/dead saved profile the user wants
/// gone.
pub(super) async fn turso_forget(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    match state.users.clear_turso(session.user_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}
