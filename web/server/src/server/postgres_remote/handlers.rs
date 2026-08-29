use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use tanwords_lib::db::connection::DbProfile;
use tanwords_lib::rpc::Ctx;

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
    peer_ip: std::net::IpAddr,
) -> Result<(), Response> {
    // This gates the only routes that hand back the live Postgres credential
    // (reveal/rotate), so a guess is worth budgeting: 10 per 10 minutes per
    // address, same as login. Without it, a holder of any session token —
    // which also travels in `?token=` URLs and the tw_proxy cookie — gets
    // unlimited online brute force, and each guess burns ~50-100ms of argon2
    // on the server (a CPU-DoS amplifier).
    if state
        .limiter
        .limited("reauth", peer_ip, 10, std::time::Duration::from_secs(600))
    {
        return Err(json_error(
            StatusCode::TOO_MANY_REQUESTS,
            "too many attempts — try again later",
        ));
    }
    match state.users.verify_account_password(user_id, password).await {
        Ok(true) => {
            state.limiter.clear("reauth", peer_ip);
            Ok(())
        }
        // The bearer session is valid; only the second-factor-style password
        // check failed. Do not answer 401, because the web client correctly
        // treats that as an expired session and logs the user out.
        Ok(false) => {
            state.limiter.record_failure("reauth", peer_ip);
            eprintln!("[tanwords-web] failed account-password re-auth from {peer_ip}");
            Err(json_error(StatusCode::FORBIDDEN, "Current password is incorrect"))
        }
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
    axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<PostgresPasswordBody>,
) -> Response {
    let peer_ip = super::super::auth::client_ip(&state, &headers, peer);
    if let Err(response) = require_account_password(&state, session.user_id, &body.password, peer_ip).await {
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
    // The response must embed an externally reachable URL, so a server
    // without TANWORDS_PUBLIC_HOST cannot fulfill this request. Checking
    // BEFORE any provisioning runs means a mis-configured server rejects
    // with nothing persisted; the old order provisioned the role, migrated
    // the data and switched the session first, then answered 400 — the
    // client showed enable as failed while the account was in fact on
    // Postgres, and the retry takes the existing-profile path, which never
    // reveals the credential first-time provisioning promises.
    if state.public_host().is_none() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "TANWORDS_PUBLIC_HOST is not configured on this server",
        );
    }

    // Serialize the whole enable flow process-wide. The "is there a
    // profile?" read and the provisioning branch must not interleave: a
    // double-clicked toggle makes both requests observe `None`, generate
    // two different passwords, and run two wipe-then-copy imports into the
    // same fresh database — with the last `ALTER ROLE` winning while
    // users.db keeps whichever `set_postgres_remote` landed last, an
    // interleaving that can permanently break every later open. Enables
    // are rare (once per account), so a single gate costs nothing.
    static ENABLE_GATE: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    let _enable_guard = ENABLE_GATE.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;

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
    axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<PostgresPasswordBody>,
) -> Response {
    let peer_ip = super::super::auth::client_ip(&state, &headers, peer);
    if let Err(response) = require_account_password(&state, session.user_id, &body.password, peer_ip).await {
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

    // Re-seal the shared vault key under the *new* password as part of the
    // rotation. The vault key seals R2 config + AI provider keys for
    // cross-device roaming; it's unlocked by a key derived from the Postgres
    // password, so a rotation without this re-seal would orphan every sealed
    // row (the new connection derives a different unlock key and can't
    // decrypt the old vault key row). Cheap — one row re-encrypted, the
    // sealed R2/AI rows are untouched (they're sealed with the vault key
    // itself).
    //
    // This is a saga, not a single transaction: three systems hold the old
    // password (the Postgres role, the vault_key row's seal, users.db) and no
    // cross-system transaction exists. Each step below is ordered so a failure
    // can be *compensated* back to the fully-old-consistent state, and the
    // users.db write is the commit point:
    //
    //   1. ALTER ROLE → new password          (reversible: ALTER ROLE back)
    //   2. LOGIN if disabled                  (reversible: NOLOGIN back) —
    //      a disabled role cannot authenticate the rekey connection
    //   3. re-seal vault old→new              (reversible: re-seal new→old)
    //   4. users.db → new password            (commit point; reversible by
    //      rewriting the old value we still hold in `profile`)
    //   5. NOLOGIN back if disabled           (state already consistent under
    //      the new password; failing here only leaves the role able to log
    //      in, and a retry finishes the job)
    //
    // The old code did step 4 before step 3 and skipped step 3 entirely on a
    // disabled profile or a poisoned AppState mutex — orphaning the vault
    // (every R2/AI secret permanently undecryptable) while still returning
    // 200 with the new connection URL.
    let new_url = internal_url(&state, &profile.role, &profile.db_name, &password);
    let rekey_vault = |url: String, from: String, to: String| async move {
        let profile_db = DbProfile::Postgres { url };
        // A fresh connection, not the account's pooled runtime: the runtime
        // may be on the local fallback DB, and its conn authenticates with
        // whichever password was current when it opened. Opening with `url`
        // (always the role's *current* password) works in every state.
        let database = tanwords_lib::db::connection::open(&profile_db, None).await?;
        let (registry, app) = tanwords_lib::build_state_for(database, None).await;
        let ctx = Ctx::new(registry, app);
        let conn = tanwords_lib::db::conn(&ctx.state::<tanwords_lib::AppState>())?;
        tanwords_lib::secrets::rekey_vault_key(&conn, &from, &to).await
    };

    // (1)
    if let Err(e) = set_role_password(&admin, &profile.role, &password).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    // (2)
    let flipped_login = !profile.enabled;
    if flipped_login {
        if let Err(e) = set_role_login(&admin, &profile.role, true).await {
            if let Err(rb) = set_role_password(&admin, &profile.role, &profile.password).await {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Rotation failed ({e}) and the rollback failed too ({rb}); the Postgres role now has the NEW password — rotate again to recover"),
                );
            }
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
    }
    // (3)
    // "No vault key row to re-seal" is benign — nothing was ever sealed
    // under the old password, so there is nothing to orphan and the rotation
    // continues (the row will be minted lazily under the new password on the
    // next connection). Any other failure rolls back.
    let mut vault_rekeyed = false;
    match rekey_vault(new_url.clone(), profile.password.clone(), password.clone()).await {
        Ok(()) => vault_rekeyed = true,
        Err(e) if e.contains("No vault key row to re-seal") => {}
        Err(e) => {
            // The re-seal write failed before committing, so the vault row is
            // still sealed under the OLD password — only the role password (and
            // LOGIN, if flipped) needs undoing to restore the fully-old state.
            if flipped_login {
                if let Err(rbe) = set_role_login(&admin, &profile.role, false).await {
                    return json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Vault re-seal failed ({e}) and disabling role login failed too ({rbe})"),
                    );
                }
            }
            if let Err(rbe) = set_role_password(&admin, &profile.role, &profile.password).await {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!(
                        "Vault re-seal failed ({e}) and the password rollback failed too ({rbe}); \
                         the Postgres role now has the NEW password — rotate again to recover"
                    ),
                );
            }
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
    }
    // (4) — commit point
    if let Err(e) = state.users.set_postgres_password(session.user_id, &password).await {
        // The vault row is now sealed under the NEW password and the role
        // accepts it — reverse the re-seal before restoring the role
        // password, or the old state would seal the vault under a password
        // the role no longer knows. (Skipped when there was no row to seal.)
        if vault_rekeyed {
            if let Err(rbe) = rekey_vault(new_url.clone(), password.clone(), profile.password.clone()).await {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!(
                        "Persisting the new password failed ({e}) and the vault rollback failed too ({rbe}); \
                         the vault is sealed under the NEW password ({password}) — keep it, it still \
                         unlocks the database, and it is needed to recover the sealed secrets"
                    ),
                );
            }
        }
        if flipped_login {
            if let Err(rbe) = set_role_login(&admin, &profile.role, false).await {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!(
                        "Persisting the new password failed ({e}) and disabling role login failed too ({rbe}) \
                         — the vault was rolled back; retry the rotation"
                    ),
                );
            }
        }
        if let Err(rbe) = set_role_password(&admin, &profile.role, &profile.password).await {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "Persisting the new password failed ({e}) and the password rollback failed too ({rbe}); \
                     the vault was rolled back; retry the rotation"
                ),
            );
        }
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    // (5)
    if flipped_login {
        if let Err(e) = set_role_login(&admin, &profile.role, false).await {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "Password rotated, but restoring NOLOGIN on the disabled role failed ({e}); \
                     the role can currently log in — retry the rotation to finish"
                ),
            );
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
    // to data that was never copied back. Before the copy, every
    // vault-key-sealed secret row is re-sealed under the device key — the
    // local profile the snapshot lands in has no vault key, so without this
    // the user's R2 config and AI provider keys would read as empty for the
    // entire time remote access stays disabled. (The read sites lazily
    // re-seal them under the vault key again on re-enable.) A failure here
    // aborts the disable: secrets silently going missing is worse than
    // staying on Postgres.
    {
        let runtime = match state.pool.runtime_for(session.user_id).await {
            Ok(rt) => rt,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let app_state = runtime.ctx.state::<tanwords_lib::AppState>();
        let conn = match tanwords_lib::db::conn(&app_state) {
            Ok(conn) => conn,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        if let Err(e) = tanwords_lib::secrets::downgrade_vault_rows_to_device_key(&conn).await {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Re-sealing stored credentials for local use failed: {e}"),
            );
        }
    }
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
