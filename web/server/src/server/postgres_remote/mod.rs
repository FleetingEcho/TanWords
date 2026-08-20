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

use tanwords_lib::db::connection::DbProfile;
use tanwords_lib::AppState;

use super::{UserSession, WebState};

mod handlers;
pub(in crate::server) use handlers::{postgres_remote_disable, postgres_remote_enable, postgres_remote_rotate, postgres_remote_status};

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
async fn create_role_and_database(conn: &sea_orm::DatabaseConnection, role: &str, db_name: &str, password: &str) -> Result<(), String> {
    conn.execute_unprepared(&format!("CREATE ROLE \"{role}\" LOGIN PASSWORD '{password}'"))
        .await
        .map_err(|e| format!("Failed to create Postgres role: {e}"))?;
    conn.execute_unprepared(&format!("CREATE DATABASE \"{db_name}\" OWNER \"{role}\""))
        .await
        .map_err(|e| format!("Failed to create Postgres database: {e}"))?;
    Ok(())
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
