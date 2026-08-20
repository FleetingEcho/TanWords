//! Per-user self-service Postgres access: a web account can turn on a
//! Settings toggle and get its own role+database inside the single shared
//! `postgres` service (see `deploy/compose.yml`), reachable directly by any
//! Postgres client (a desktop app's Cloud tab, `psql`, ...) — independent of
//! logging into the web app, but *also* the same storage this account's own
//! web session switches onto the moment the toggle is on (see
//! `switch_web_session_to_postgres` below).
//!
//! Replaces the old per-user dedicated `sqld` Docker container design: no
//! container lifecycle, no port allocation, no Caddy admin-API push — one
//! `CREATE ROLE`/`CREATE DATABASE` against the shared instance is the entire
//! "provisioning" step, and `ALTER ROLE ... NOLOGIN` is "disable".

use rand::RngCore;
use sea_orm::{ConnectionTrait, Database};
use serde_json::json;

use tanwords_lib::db::connection::DbProfile;
use tanwords_lib::rpc::dispatch::dispatch;
use tanwords_lib::rpc::{Args, Ctx};
use tanwords_lib::AppState;

use super::{UserSession, WebState};

mod handlers;
pub(in crate::server) use handlers::{
    postgres_remote_disable, postgres_remote_enable, postgres_remote_reveal,
    postgres_remote_rotate, postgres_remote_status,
};

fn role_and_db_name(user_id: i64) -> (String, String) {
    let name = format!("tanwords_user_{user_id}");
    (name.clone(), name)
}

/// Hex, not base64: this ends up both inside a single-quoted SQL literal
/// (`ALTER ROLE ... PASSWORD '...'`) and inside a `postgres://` URL — hex has
/// no character that's special to either.
fn generate_password() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

async fn admin_conn(state: &WebState) -> Result<sea_orm::DatabaseConnection, String> {
    let url = state
        .postgres_admin_url()
        .ok_or("Postgres remote access is not configured on this server")?;
    Database::connect(url)
        .await
        .map_err(|e| format!("Failed to reach the shared Postgres instance: {e}"))
}

/// `role`/`db_name` are always this function's own `tanwords_user_{id}`
/// output — never client-supplied — so building these statements with
/// `format!` carries no injection risk.
///
/// Neither `CREATE ROLE` nor `CREATE DATABASE` support `IF NOT EXISTS` in
/// Postgres, but this must still be safe to call twice: if a previous enable
/// got the role/database created and then failed during the data migration
/// below, the retry re-enters this same first-time-provisioning path. An
/// "already exists" error from either statement is therefore expected on a
/// retry, not a real failure — anything else still is.
async fn create_role_and_database(conn: &sea_orm::DatabaseConnection, role: &str, db_name: &str, password: &str) -> Result<(), String> {
    if let Err(e) = conn.execute_unprepared(&format!("CREATE ROLE \"{role}\" LOGIN PASSWORD '{password}'")).await {
        if !e.to_string().contains("already exists") {
            return Err(format!("Failed to create Postgres role: {e}"));
        }
        // The role already existed (a retry) — still make sure it has this
        // attempt's password and can log in.
        conn.execute_unprepared(&format!("ALTER ROLE \"{role}\" LOGIN PASSWORD '{password}'"))
            .await
            .map_err(|e| format!("Failed to update existing Postgres role: {e}"))?;
    }
    if let Err(e) = conn.execute_unprepared(&format!("CREATE DATABASE \"{db_name}\" OWNER \"{role}\"")).await {
        if !e.to_string().contains("already exists") {
            return Err(format!("Failed to create Postgres database: {e}"));
        }
    }
    Ok(())
}

/// First-time provisioning only: copies the account's existing local
/// `tanwords.db` into the freshly created (and by now schema-initialized)
/// Postgres database, so enabling remote access doesn't silently strand the
/// user's real data behind an empty cloud database. A no-op for a brand new
/// account with no local file yet. Reuses the same wipe-then-copy machinery
/// as a manual full-overwrite import (`db_import_overwrite`); its wipe-first
/// design also makes this safe to retry from scratch after a failure.
async fn migrate_local_data_to_postgres(state: &WebState, user_id: i64, url: &str) -> Result<(), String> {
    let local_path = state.pool.user_dir(user_id).join("tanwords.db");
    if !local_path.exists() {
        return Ok(());
    }

    let profile = DbProfile::Postgres { url: url.to_string() };
    let database = tanwords_lib::db::connection::open(&profile, None).await?;
    let (registry, app) = tanwords_lib::build_state_for(database, None).await;
    let ctx = Ctx::new(registry, app);

    dispatch(
        &ctx,
        "db_import_overwrite",
        Args::new(json!({
            "sourcePath": local_path.to_string_lossy(),
            "password": null,
        })),
    )
    .await
    .map(|_| ())
    .map_err(|e| format!("Failed to copy your local data into Postgres: {e}"))
}

async fn set_role_login(conn: &sea_orm::DatabaseConnection, role: &str, login: bool) -> Result<(), String> {
    let clause = if login { "LOGIN" } else { "NOLOGIN" };
    conn.execute_unprepared(&format!("ALTER ROLE \"{role}\" {clause}"))
        .await
        .map_err(|e| format!("Failed to update Postgres role: {e}"))?;
    Ok(())
}

async fn set_role_password(conn: &sea_orm::DatabaseConnection, role: &str, password: &str) -> Result<(), String> {
    conn.execute_unprepared(&format!("ALTER ROLE \"{role}\" PASSWORD '{password}'"))
        .await
        .map_err(|e| format!("Failed to rotate Postgres password: {e}"))?;
    Ok(())
}

/// Reachable from inside the compose network — what the web server itself
/// (and its per-user runtimes) connects through.
fn internal_url(state: &WebState, role: &str, db_name: &str, password: &str) -> String {
    format!(
        "postgres://{role}:{password}@{}:{}/{db_name}?sslmode=require",
        state.postgres_host(),
        state.postgres_port(),
    )
}

/// Reachable from the internet — what's shown to the user for a desktop
/// app / `psql` to connect with directly.
fn external_url(state: &WebState, role: &str, db_name: &str, password: Option<&str>) -> Result<String, String> {
    let host = state
        .public_host()
        .ok_or("TANWORDS_PUBLIC_HOST is not configured on this server")?;
    match password {
        Some(password) => Ok(format!("postgres://{role}:{password}@{host}:5432/{db_name}?sslmode=require")),
        None => Ok(format!("postgres://{role}@{host}:5432/{db_name}?sslmode=require")),
    }
}

/// Switches this account's own web session onto its Postgres database —
/// enabling remote access also means "this is where your data lives now"
/// (see the module doc). No local-replica file to wipe: a Postgres profile
/// connects directly.
async fn switch_web_session_to_postgres(state: &WebState, session: &UserSession, role: &str, db_name: &str, password: &str) -> Result<(), String> {
    let profile = DbProfile::Postgres { url: internal_url(state, role, db_name, password) };
    let database = tanwords_lib::db::connection::open(&profile, None).await?;
    state.users.set_active_db(session.user_id, "postgres").await?;
    let runtime = state.pool.runtime_for(session.user_id).await?;
    runtime.ctx.state::<AppState>().replace_db(database)
}

/// Copies the account's *current* Postgres data back into its local
/// `tanwords.db`, overwriting whatever's there — the mirror of
/// `migrate_local_data_to_postgres`, run before `postgres_remote_disable`
/// switches the session back to local so disabling never looks like data
/// loss (any edits made while on Postgres would otherwise be left behind in
/// a stale local file). Uses the account's own already-live Postgres
/// runtime as the source, via the same `db_export_postgres_backup` command
/// the desktop app's manual "export backup" uses.
async fn snapshot_postgres_to_local(state: &WebState, session: &UserSession) -> Result<(), String> {
    let local_path = state
        .pool
        .user_dir(session.user_id)
        .join("tanwords.db")
        .to_string_lossy()
        .to_string();
    let runtime = state.pool.runtime_for(session.user_id).await?;
    dispatch(
        &runtime.ctx,
        "db_export_postgres_backup",
        Args::new(json!({ "dest": local_path, "password": null })),
    )
    .await
    .map(|_| ())
    .map_err(|e| format!("Failed to copy your Postgres data back to local: {e}"))
}

async fn switch_web_session_to_local(state: &WebState, session: &UserSession) -> Result<(), String> {
    let path = state
        .pool
        .user_dir(session.user_id)
        .join("tanwords.db")
        .to_string_lossy()
        .to_string();
    let database = tanwords_lib::db::connection::open(&DbProfile::Local { path }, None).await?;
    state.users.set_active_db(session.user_id, "local").await?;
    let runtime = state.pool.runtime_for(session.user_id).await?;
    runtime.ctx.state::<AppState>().replace_db(database)
}
