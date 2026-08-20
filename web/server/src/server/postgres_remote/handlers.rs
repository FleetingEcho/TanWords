use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use super::super::{json_error, UserSession, WebState};
use super::{
    admin_conn, create_role_and_database, external_url, generate_password, internal_url,
    migrate_local_data_to_postgres, role_and_db_name, set_role_login, set_role_password,
    snapshot_postgres_to_local, switch_web_session_to_local, switch_web_session_to_postgres,
};

#[derive(Deserialize)]
pub(in crate::server) struct PostgresPasswordBody {
    password: String,
}

async fn require_account_password(
    state: &WebState,
    user_id: i64,
    password: &str,
) -> Result<(), Response> {
    match state.users.verify_account_password(user_id, password).await {
        Ok(true) => Ok(()),
        // The bearer session is valid; only the second-factor-style password
        // check failed. Do not answer 401, because the web client correctly
        // treats that as an expired session and logs the user out.
        Ok(false) => Err(json_error(StatusCode::FORBIDDEN, "Current password is incorrect")),
        Err(e) => Err(json_error(StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

pub(in crate::server) async fn postgres_remote_status(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let profile = match state.users.postgres_remote_for(session.user_id).await {
        Ok(profile) => profile,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let Some(profile) = profile.filter(|p| p.enabled) else {
        return Json(json!({ "enabled": false, "url": null })).into_response();
    };
    match external_url(&state, &profile.role, &profile.db_name, None) {
        Ok(url) => Json(json!({ "enabled": true, "url": url })).into_response(),
        Err(e) => json_error(StatusCode::BAD_REQUEST, e),
    }
}

/// Returns the full, still-current connection string only after an explicit
/// account-password check. The password is already sealed in users.db, so a
/// lost browser copy never requires rotating the Postgres role and breaking
/// every other connected client.
pub(in crate::server) async fn postgres_remote_reveal(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<PostgresPasswordBody>,
) -> Response {
    if let Err(response) = require_account_password(&state, session.user_id, &body.password).await {
        return response;
    }
    let profile = match state.users.postgres_remote_for(session.user_id).await {
        Ok(profile) => profile,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let Some(profile) = profile.filter(|p| p.enabled) else {
        return json_error(StatusCode::BAD_REQUEST, "Remote access isn't enabled yet");
    };
    match external_url(&state, &profile.role, &profile.db_name, Some(&profile.password)) {
        Ok(url) => Json(json!({ "enabled": true, "url": url })).into_response(),
        Err(e) => json_error(StatusCode::BAD_REQUEST, e),
    }
}

/// Provisions on first call, re-enables (`LOGIN`) if it was disabled, and is
/// a harmless no-op if already enabled — in every case the account's live
/// session is switched onto this Postgres database (see the module doc).
/// Only first-time provisioning returns the full credential here. Existing
/// profiles use `postgres_remote_reveal`, which re-checks the account
/// password without rotating the Postgres role.
pub(in crate::server) async fn postgres_remote_enable(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let existing = match state.users.postgres_remote_for(session.user_id).await {
        Ok(profile) => profile,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };

    let (role, db_name, password, newly_provisioned) = match existing {
        Some(profile) => {
            if !profile.enabled {
                let admin = match admin_conn(&state).await {
                    Ok(conn) => conn,
                    Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
                };
                if let Err(e) = set_role_login(&admin, &profile.role, true).await {
                    return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
                }
                if let Err(e) = state.users.set_postgres_enabled(session.user_id, true).await {
                    return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
                }
            }
            (profile.role, profile.db_name, profile.password, false)
        }
        None => {
            let (role, db_name) = role_and_db_name(session.user_id);
            let password = generate_password();
            let admin = match admin_conn(&state).await {
                Ok(conn) => conn,
                Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
            };
            if let Err(e) = create_role_and_database(&admin, &role, &db_name, &password).await {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
            }
            // Before persisting anything: applies the schema to the fresh
            // database and copies the account's existing local data into it,
            // so enabling doesn't strand real data behind an empty cloud
            // database. Left unpersisted on failure so a retry re-enters
            // this same first-time path (create_role_and_database tolerates
            // the role/database already existing).
            let url = internal_url(&state, &role, &db_name, &password);
            if let Err(e) = migrate_local_data_to_postgres(&state, session.user_id, &url).await {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
            }
            if let Err(e) = state
                .users
                .set_postgres_remote(session.user_id, &role, &db_name, &password)
                .await
            {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
            }
            (role, db_name, password, true)
        }
    };

    if let Err(e) = switch_web_session_to_postgres(&state, &session, &role, &db_name, &password).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    // A repeat enable must not double as an unauthenticated credential reveal.
    // The dedicated reveal route performs the account-password check.
    let exposed_password = newly_provisioned.then_some(password.as_str());
    match external_url(&state, &role, &db_name, exposed_password) {
        Ok(url) => Json(json!({ "enabled": true, "url": url })).into_response(),
        Err(e) => json_error(StatusCode::BAD_REQUEST, e),
    }
}

/// Requires an existing profile. Generates a fresh password; the old one
/// stops working immediately (`ALTER ROLE ... PASSWORD`), which invalidates
/// any client still holding it — same intent as the retired sqld container's
/// keypair rotation.
pub(in crate::server) async fn postgres_remote_rotate(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(body): Json<PostgresPasswordBody>,
) -> Response {
    if let Err(response) = require_account_password(&state, session.user_id, &body.password).await {
        return response;
    }
    let existing = match state.users.postgres_remote_for(session.user_id).await {
        Ok(profile) => profile,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let Some(profile) = existing else {
        return json_error(StatusCode::BAD_REQUEST, "Remote access isn't enabled yet");
    };

    let password = generate_password();
    let admin = match admin_conn(&state).await {
        Ok(conn) => conn,
        Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
    };
    if let Err(e) = set_role_password(&admin, &profile.role, &password).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = state
        .users
        .set_postgres_password(session.user_id, &password)
        .await
    {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    // Re-seal the shared vault key under the *new* password before the session
    // is re-opened with it. The vault key seals R2 config + AI provider keys
    // for cross-device roaming; it's unlocked by a key derived from the
    // Postgres password, so a rotation without this re-seal would orphan every
    // sealed row (the new connection derives a different unlock key and can't
    // decrypt the old vault key row). Cheap — one row re-encrypted, the sealed
    // R2/AI rows are untouched (they're sealed with the vault key itself).
    if profile.enabled {
        let runtime = match state.pool.runtime_for(session.user_id).await {
            Ok(rt) => rt,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let app_state = runtime.ctx.state::<tanwords_lib::AppState>();
        if let Ok(conn) = tanwords_lib::db::conn(&app_state) {
            if let Err(e) = tanwords_lib::secrets::rekey_vault_key(&conn, &profile.password, &password).await {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
            }
        }
    }

    if profile.enabled {
        // A live session holding the old password needs a fresh connection —
        // the pool doesn't otherwise notice its credential just changed.
        if let Err(e) =
            switch_web_session_to_postgres(&state, &session, &profile.role, &profile.db_name, &password).await
        {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
    }

    match external_url(&state, &profile.role, &profile.db_name, Some(&password)) {
        Ok(url) => Json(json!({ "enabled": true, "url": url })).into_response(),
        Err(e) => json_error(StatusCode::BAD_REQUEST, e),
    }
}

/// Copies the account's current Postgres data back into its local
/// `tanwords.db` (no loss of anything written while Postgres was active),
/// then revokes `LOGIN` (the role/database themselves are kept — cheap to
/// re-enable) and switches the live session back to local.
pub(in crate::server) async fn postgres_remote_disable(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let existing = match state.users.postgres_remote_for(session.user_id).await {
        Ok(profile) => profile,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let Some(profile) = existing else {
        return json_error(StatusCode::BAD_REQUEST, "Remote access isn't enabled yet");
    };
    if !profile.enabled {
        return Json(json!({ "enabled": false })).into_response();
    }

    // Snapshotted first, while the role can still log in: if this fails,
    // remote access stays enabled and untouched rather than risking access
    // to data that was never copied back.
    if let Err(e) = snapshot_postgres_to_local(&state, &session).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    let admin = match admin_conn(&state).await {
        Ok(conn) => conn,
        Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
    };
    if let Err(e) = set_role_login(&admin, &profile.role, false).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = state.users.set_postgres_enabled(session.user_id, false).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Err(e) = switch_web_session_to_local(&state, &session).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    Json(json!({ "enabled": false })).into_response()
}
