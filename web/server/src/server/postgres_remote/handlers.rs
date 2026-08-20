use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use super::super::{json_error, UserSession, WebState};
use super::{
    admin_conn, create_role_and_database, external_url, generate_password, internal_url,
    migrate_local_data_to_postgres, role_and_db_name, set_role_login, set_role_password,
    snapshot_postgres_to_local, switch_web_session_to_local, switch_web_session_to_postgres,
};

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

/// Provisions on first call, re-enables (`LOGIN`) if it was disabled, and is
/// a harmless no-op-plus-redisplay if already enabled — in every case the
/// account's live session is switched onto this Postgres database (see the
/// module doc) and the current password is returned. Unlike the retired
/// sqld container's bearer token (regenerated fresh every call because
/// nothing stored it), the password is a real stored credential, so
/// re-displaying it on a repeat "enable" is just a convenience, not a
/// rotation — use `postgres_remote_rotate` to actually invalidate it.
pub(in crate::server) async fn postgres_remote_enable(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let existing = match state.users.postgres_remote_for(session.user_id).await {
        Ok(profile) => profile,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };

    let (role, db_name, password) = match existing {
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
            (profile.role, profile.db_name, profile.password)
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
            (role, db_name, password)
        }
    };

    if let Err(e) = switch_web_session_to_postgres(&state, &session, &role, &db_name, &password).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    match external_url(&state, &role, &db_name, Some(&password)) {
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
) -> Response {
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
