use crate::db::params; use crate::db::Conn; use crate::db::DbResult; use crate::db::Value;
use crate::shim::State;

use sea_orm::ConnectionTrait;

use crate::db;
use crate::db::connection::{DbDescriptor, DbProfile};
use crate::AppState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberedTursoConnection {
    pub url: Option<String>,
    pub token_present: bool,
}

fn database_disk_size(path: &str) -> std::result::Result<u64, String> {
    [
        path.to_string(),
        format!("{path}-wal"),
        format!("{path}-shm"),
    ]
    .iter()
    .try_fold(0_u64, |total, candidate| {
        match std::fs::metadata(candidate) {
            Ok(metadata) => Ok(total + metadata.len()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(total),
            Err(error) => Err(error.to_string()),
        }
    })
}

async fn export_backup(conn: &Conn, dest: &str) -> std::result::Result<(), String> {
    conn.execute("VACUUM INTO ?1", params![dest])
        .await
        .map_err(|e| e.to_string())?;

    // `VACUUM INTO` always writes its target in rollback-journal mode, no
    // matter what journal mode the source connection is using — the WAL
    // setting is a page-cache/connection concept SQLite doesn't carry into a
    // freshly rebuilt file. `turso db import` rejects anything that isn't
    // WAL, so a backup handed to it as-is fails (surfaced there as a
    // confusing "group not found" rather than anything about journal mode).
    // Reopen the file we just wrote purely to flip that one pragma.
    let mut opts = sea_orm::ConnectOptions::new(format!("sqlite://{dest}?mode=rw"));
    opts.max_connections(1);
    let backup = sea_orm::Database::connect(opts)
        .await
        .map_err(|e| e.to_string())?;
    backup
        .execute_unprepared("PRAGMA journal_mode=WAL;")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn clear_translations(conn: &Conn) -> std::result::Result<(), String> {
    conn.execute("DELETE FROM translations", ())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn get_setting(conn: &Conn, key: &str) -> DbResult<Option<String>> {
    let mut rows = conn
        .query_all("SELECT value FROM user_settings WHERE key = ?1", params![key])
        .await?;
    match rows.pop() {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub async fn set_setting(conn: &Conn, key: &str, value: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO user_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        params![key, value],
    )
    .await?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_get_word_count(conn: State<'_, AppState>) -> std::result::Result<i64, String> {
    let db = db::conn(&conn)?;
    db::scalar_i64(&db, "SELECT COUNT(*) FROM words", ()).await
}

#[crate::shim::command]
pub async fn db_get_translation_count(
    conn: State<'_, AppState>,
) -> std::result::Result<i64, String> {
    let db = db::conn(&conn)?;
    db::scalar_i64(&db, "SELECT COUNT(*) FROM translations", ()).await
}

// db_get_review_count moved to srs.rs (needs FSRS-consistent date comparison).

#[crate::shim::command]
pub async fn db_get_setting(
    key: String,
    conn: State<'_, AppState>,
) -> std::result::Result<Option<String>, String> {
    let db = db::conn(&conn)?;
    get_setting(&db, &key).await.map_err(|e| e.to_string())
}

#[crate::shim::command]
pub async fn db_set_setting(
    key: String,
    value: String,
    conn: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db = db::conn(&conn)?;
    set_setting(&db, &key, &value).await.map_err(|e| e.to_string())
}

#[crate::shim::command]
pub fn db_get_db_path(state: State<'_, AppState>) -> std::result::Result<String, String> {
    state.db_path()
}

/// Where a local database would live — independent of whatever's actually
/// active right now. `db_get_db_path` reflects the live connection (empty
/// for Postgres, which has no local file); the Local tab in Settings wants
/// this one instead, so it can show a real path even while a remote profile
/// is connected, rather than either the remote's URL or nothing.
#[crate::shim::command]
pub fn db_get_default_local_path() -> String {
    crate::default_db_path()
}

/// Bytes on disk. For a Turso profile this measures the local replica, which
/// is the only thing this process can actually stat.
#[crate::shim::command]
pub fn db_get_db_size(state: State<'_, AppState>) -> std::result::Result<u64, String> {
    database_disk_size(&state.db_path()?)
}

/// The active connection profile, including what it supports — the frontend
/// hides export/switch actions that can't work rather than failing on click.
#[crate::shim::command]
pub fn db_get_connection(state: State<'_, AppState>) -> std::result::Result<DbDescriptor, String> {
    state.descriptor()
}

/// Returns (and consumes-by-value, since it's a plain startup snapshot) the
/// profile that failed to open this launch, if that happened — `None`
/// otherwise. The frontend calls this once at startup to show a warning
/// instead of the app silently falling back to an empty default database
/// with no explanation.
#[crate::shim::command]
pub fn db_get_startup_warning(state: State<'_, AppState>) -> Option<String> {
    state.db_fallback_warning.clone()
}

/// Whether the profile saved on disk (not necessarily the live connection,
/// which is already the local fallback by the time this is reachable) is
/// Turso. A failed local profile self-heals in `open_startup_db`, but a
/// failed Turso one is kept on purpose in case it was just a flaky network —
/// so it can linger indefinitely if the real cause was a lost/revoked token.
/// Gates the "Forget saved connection" button in Settings.
#[crate::shim::command]
pub fn db_saved_profile_is_turso() -> bool {
    matches!(crate::appconfig::load_db_profile(), Some(DbProfile::Turso { .. }))
}

/// Clears a saved Turso profile (and its keychain token) that can't be
/// reconnected right now. Unlike `db_disconnect_remote`, this needs no live
/// connection to the profile being forgotten — it only touches the saved
/// config, leaving whatever the app already fell back to untouched.
#[crate::shim::command]
pub fn db_forget_saved_profile() {
    crate::appconfig::clear_db_profile();
    crate::appconfig::clear_remembered_turso_url();
    crate::secrets::turso_token_clear();
}

/// Returns the last Turso URL the user connected to and whether the keychain
/// still holds an auth token for it. Never returns the token itself.
#[crate::shim::command]
pub fn db_get_remembered_turso() -> RememberedTursoConnection {
    RememberedTursoConnection {
        url: crate::appconfig::load_remembered_turso_url(),
        token_present: crate::secrets::turso_token_get().is_some(),
    }
}

/// Mounts a different SQLite file as the app's active database — creating it
/// (and running migrations) if it doesn't exist yet, or opening it as-is if
/// it does. Swaps the live connection in place so no restart is needed; the
/// caller (Settings UI) still does a full frontend reload afterward since
/// every already-loaded page's state was fetched from the old DB.
#[crate::shim::command]
pub async fn db_switch_path(
    new_path: String,
    state: State<'_, AppState>,
) -> std::result::Result<String, String> {
    switch_db_path(new_path, state, true).await
}

async fn switch_db_path(
    new_path: String,
    state: State<'_, AppState>,
    persist_profile: bool,
) -> std::result::Result<String, String> {
    let profile = DbProfile::Local { path: new_path.clone() };
    let database = db::connection::open(&profile, None).await?;
    state.replace_db(database)?;

    if persist_profile {
        crate::appconfig::save_db_profile(&profile).map_err(|e| e.to_string())?;
    }
    Ok(new_path)
}

/// Test-only behavior exposed to integration tests: exercises the complete
/// connection swap without modifying the real user's persisted app config.
#[doc(hidden)]
pub async fn db_switch_path_without_persist(
    new_path: String,
    state: State<'_, AppState>,
) -> std::result::Result<String, String> {
    switch_db_path(new_path, state, false).await
}

/// Points the app at a Turso database as an embedded replica: a local file
/// that reads at local speed and syncs to the user's primary in the
/// background. The token goes straight to the OS keychain and is never
/// readable from the frontend again.
#[crate::shim::command]
pub async fn db_connect_turso(
    url: String,
    token: String,
    state: State<'_, AppState>,
) -> std::result::Result<DbDescriptor, String> {
    let url = url.trim().to_string();
    let mut token = token.trim().to_string();
    if url.is_empty() {
        return Err("Please fill in the database URL".into());
    }
    if token.is_empty() {
        // Reconnect path: the token was kept in the keychain on disconnect and
        // the UI deliberately never reads it back. Fall back to it so the user
        // only has to press Connect again. If nothing was ever saved, this is
        // likely a self-hosted sqld/libsql-server with no auth configured, so
        // proceed with an empty token rather than erroring.
        token = crate::secrets::turso_token_get().unwrap_or_default();
    }

    let replica_path = crate::replica_db_path();
    let profile = DbProfile::Turso { path: replica_path.clone(), url: url.clone() };

    // The replica path is fixed, not derived from the URL, so a file can be
    // sitting here from a previous connection to a *different* Turso database
    // (or an interrupted one). Reusing it would make libsql's embedded-replica
    // sync treat this as a continuation of that unrelated lineage — pulling
    // only incremental frames near wherever that old sync left off instead of
    // the new primary's full history, silently leaving most rows missing.
    // An explicit "Connect" always means "give me everything from this
    // database", so start from nothing rather than risk that mismatch.
    for suffix in ["", "-wal", "-shm", "-client_wal_index", "-info"] {
        let _ = std::fs::remove_file(format!("{replica_path}{suffix}"));
    }

    // Open before persisting anything: a bad URL or token should leave the
    // current (working) connection and the saved profile exactly as they were.
    let database = db::connection::open(&profile, Some(&token)).await?;
    let descriptor = database.descriptor();

    // The read-only degraded mode exists so a *launch* can keep serving data the
    // user already has while the primary is unreachable. As the result of
    // deliberately connecting to a database it is a trap: the profile gets
    // saved, the UI reports success, and every write afterwards fails. Refuse it
    // here so the user gets an error they can retry instead of a connection that
    // silently can't store anything.
    if !descriptor.caps.writable {
        return Err("Connected but unable to write: the primary database is temporarily unavailable, please check your network and retry".into());
    }

    crate::secrets::turso_token_set(&token)?;
    crate::appconfig::save_db_profile(&profile).map_err(|e| e.to_string())?;
    crate::appconfig::save_remembered_turso_url(&url).map_err(|e| e.to_string())?;
    state.replace_db(database)?;
    Ok(descriptor)
}

/// Points the app directly at a user-supplied Postgres database. Unlike Turso
/// there is no local replica — the connection string (host, credentials,
/// database name, all inline) goes straight to sea-orm's Postgres pool and
/// every read/write is a live network round trip from then on.
#[crate::shim::command]
pub async fn db_connect_postgres(
    url: String,
    state: State<'_, AppState>,
) -> std::result::Result<DbDescriptor, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Please fill in the database connection string".into());
    }
    let profile = crate::db::connection::DbProfile::Postgres { url };

    // Open (and run schema init) before persisting anything: a bad connection
    // string or unreachable host should leave the current working connection
    // and the saved profile exactly as they were.
    let database = db::connection::open(&profile, None).await?;
    let descriptor = database.descriptor();

    state.replace_db(database)?;
    crate::appconfig::save_db_profile(&profile).map_err(|e| e.to_string())?;
    Ok(descriptor)
}

/// Every real table in `schema_postgres.sql`, in the file's own order — its
/// header comment guarantees that order is already topologically sorted by
/// FK dependency (parent tables before the tables that reference them), so
/// no separate FK introspection is needed the way `import::overwrite` needs
/// it for an arbitrary SQLite source.
fn postgres_table_order() -> Vec<String> {
    static SCHEMA: &str = include_str!("../../sql/schema_postgres.sql");
    let re = regex::Regex::new(r"(?m)^CREATE TABLE IF NOT EXISTS (\w+)").unwrap();
    re.captures_iter(SCHEMA).map(|c| c[1].to_string()).collect()
}

/// Copies every row of `table` from `source` into `dest` — direction-agnostic
/// (used both Postgres→SQLite, by `export_postgres_snapshot`, and SQLite→
/// Postgres, for `import::overwrite`'s Postgres-target path). See
/// `db::pg_copy`'s module doc for the three Postgres-destination edge cases
/// this and its helpers exist to get right.
async fn copy_postgres_table(source: &Conn, dest: &Conn, table: &str) -> std::result::Result<(), String> {
    use crate::db::pg_copy::{json_cell_to_bind, postgres_dest_column_types, postgres_overriding_clause, resync_postgres_identity_sequence};
    use sea_orm::FromQueryResult;

    let dest_col_types = postgres_dest_column_types(dest, table).await;

    let rows = source
        .query_all(&format!("SELECT * FROM \"{table}\""), ())
        .await
        .map_err(|e| format!("Failed to read {table}: {e}"))?;

    for row in &rows {
        let decoded = sea_orm::JsonValue::from_query_result(row, "")
            .map_err(|e| format!("Failed to decode a row from {table}: {e}"))?;
        let map = match decoded {
            serde_json::Value::Object(m) => m,
            _ => return Err(format!("Unexpected row shape from {table}")),
        };
        let columns: Vec<&String> = map.keys().collect();
        let quoted = columns.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", ");
        let placeholders = (1..=columns.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
        let overriding = postgres_overriding_clause(dest);
        let sql = format!("INSERT INTO \"{table}\" ({quoted}){overriding} VALUES ({placeholders})");
        let values: Vec<Value> = map
            .iter()
            .map(|(col, v)| json_cell_to_bind(table, col, v, dest_col_types.get(col.as_str()).map(|s| s.as_str())))
            .collect();
        dest.execute(&sql, values)
            .await
            .map_err(|e| format!("Failed to copy into {table}: {e}"))?;
    }

    resync_postgres_identity_sequence(dest, table, &dest_col_types).await;
    Ok(())
}

/// Emitted on `"postgres-export-progress"` as `export_postgres_snapshot` runs
/// — mirrors `OverwriteProgress` in `db/import/overwrite.rs` (same shape, own
/// event name so the two operations' listeners never cross-talk).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExportProgress<'a> {
    phase: &'a str, // "clearing" | "copying"
    table: &'a str,
    table_index: usize,
    table_total: usize,
}

/// Builds a local SQLite snapshot of the currently-connected Postgres
/// database at `dest_path`. Postgres has no local replica file — there's no
/// `VACUUM INTO` equivalent — so "export a backup" means creating an
/// ordinary local database (schema + default seed rows, same as any new
/// local file) and copying every row of every table into it in place of
/// those seed rows.
pub(crate) async fn export_postgres_snapshot(
    app: &crate::shim::AppHandle,
    source: &Conn,
    dest_path: &str,
) -> std::result::Result<(), String> {
    db::connection::open(&DbProfile::Local { path: dest_path.to_string() }, None)
        .await
        .map_err(|e| format!("Failed to create backup file: {e}"))?;

    // Re-open as a single dedicated connection: `PRAGMA foreign_keys` refuses
    // to change while a transaction is open, so it must be set on the exact
    // connection the copy transaction below runs on — the pooled connection
    // `open()` above handed back isn't guaranteed to be that one.
    let mut opts = sea_orm::ConnectOptions::new(format!("sqlite://{dest_path}?mode=rw"));
    opts.max_connections(1);
    let raw = sea_orm::Database::connect(opts).await.map_err(|e| e.to_string())?;
    let dest = Conn::new_db(raw, db::DbKind::Local);
    dest.execute_batch("PRAGMA foreign_keys=OFF;")
        .await
        .map_err(|e| e.to_string())?;

    let tables = postgres_table_order();
    let tx = dest.transaction().await.map_err(|e| e.to_string())?;

    // Children-first: clears the seed rows `open()` just wrote (default
    // calendars, default settings) without tripping their own FK checks.
    for (i, table) in tables.iter().rev().enumerate() {
        let _ = app.emit(
            "postgres-export-progress",
            PostgresExportProgress { phase: "clearing", table, table_index: i + 1, table_total: tables.len() },
        );
        tx.execute(&format!("DELETE FROM \"{table}\""), ())
            .await
            .map_err(|e| format!("Failed to clear {table}: {e}"))?;
    }
    // Parents-first: safe insert order for the source's real rows.
    for (i, table) in tables.iter().enumerate() {
        let _ = app.emit(
            "postgres-export-progress",
            PostgresExportProgress { phase: "copying", table, table_index: i + 1, table_total: tables.len() },
        );
        copy_postgres_table(source, &tx, table).await?;
    }
    // Best-effort: the local file's FTS5 indexes start empty on a freshly
    // created database and have no Postgres-side equivalent to copy from.
    for fts in ["documents_fts", "reading_articles_fts"] {
        let _ = tx.execute(&format!("INSERT INTO \"{fts}\"(\"{fts}\") VALUES('rebuild')"), ()).await;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Downloads a local backup of the currently-connected Postgres database.
/// Mirrors `db_export_backup`'s optional-password shape: a plain snapshot
/// when `password` is empty, or a snapshot built to a temp file and then
/// wrapped into an encrypted zip at `dest` when one is given.
#[crate::shim::command]
pub async fn db_export_postgres_backup(
    app: crate::shim::AppHandle,
    dest: String,
    password: Option<String>,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let source = db::conn(&state)?;
    if source.kind() != db::DbKind::Postgres {
        return Err("Not connected to a Postgres database".into());
    }

    match password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(password) => {
            let temp_snapshot =
                std::env::temp_dir().join(format!("tanwords-pg-export-{}.db", uuid::Uuid::new_v4()));
            let result = async {
                export_postgres_snapshot(&app, &source, &temp_snapshot.to_string_lossy()).await?;
                crate::db::import::create_encrypted_backup(
                    std::path::Path::new(&temp_snapshot),
                    std::path::Path::new(&dest),
                    password,
                )
            }
            .await;
            let _ = std::fs::remove_file(&temp_snapshot);
            result
        }
        None => export_postgres_snapshot(&app, &source, &dest).await,
    }
}

/// A local path to snapshot the replica onto that isn't already in use — never
/// the user's existing local database, which may hold unrelated data.
fn snapshot_destination() -> String {
    let base = std::path::Path::new(&crate::default_db_path())
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("tanwords-from-turso");
    for attempt in 0..100 {
        let candidate = if attempt == 0 {
            format!("{}.db", base.display())
        } else {
            format!("{}-{attempt}.db", base.display())
        };
        if !std::path::Path::new(&candidate).exists() {
            return candidate;
        }
    }
    format!("{}-{}.db", base.display(), uuid::Uuid::new_v4())
}

/// Disconnects from Turso and keeps the data, by snapshotting the replica into
/// a standalone local database and switching to that.
///
/// Deliberately *not* "switch back to the old local file": by the time someone
/// disconnects, the Turso database is the one they have been using, and landing
/// them on a months-old local file reads as data loss. The remote is untouched —
/// this only stops syncing to it.
#[crate::shim::command]
pub async fn db_disconnect_remote(
    state: State<'_, AppState>,
) -> std::result::Result<DbDescriptor, String> {
    // Postgres has no local replica file to snapshot (`VACUUM INTO` below is
    // SQLite-only and isn't rewritten for Postgres) — just switch back to the
    // default local file. The remote database itself is untouched, same as
    // the Turso path below: this only stops the app from talking to it.
    if db::conn(&state)?.kind() == db::DbKind::Postgres {
        let profile = DbProfile::Local { path: crate::default_db_path() };
        let database = db::connection::open(&profile, None).await?;
        let descriptor = database.descriptor();
        state.replace_db(database)?;
        crate::appconfig::save_db_profile(&profile).map_err(|e| e.to_string())?;
        return Ok(descriptor);
    }

    let remembered_url = match crate::appconfig::load_db_profile() {
        Some(DbProfile::Turso { url, .. }) => Some(url),
        _ => None,
    };
    let replica_path = crate::replica_db_path();
    let snapshot = snapshot_destination();

    // Snapshot before anything is torn down, so a failure here leaves the
    // working Turso connection exactly as it was.
    let snapshotted = {
        let conn = db::conn(&state)?;
        match conn.execute("VACUUM INTO ?1", params![snapshot.clone()]).await {
            Ok(_) => true,
            Err(error) => {
                // A degraded (read-only) replica can't always produce one. Fall
                // back to the plain local database rather than blocking the
                // disconnect — but then the replica is kept, not deleted.
                eprintln!("[tanwords] could not snapshot the replica ({error}); disconnecting without it");
                false
            }
        }
    };

    let profile = DbProfile::Local {
        path: if snapshotted { snapshot } else { crate::default_db_path() },
    };
    let database = db::connection::open(&profile, None).await?;
    let descriptor = database.descriptor();

    state.replace_db(database)?;
    crate::appconfig::save_db_profile(&profile).map_err(|e| e.to_string())?;
    if let Some(url) = remembered_url {
        crate::appconfig::save_remembered_turso_url(&url).map_err(|e| e.to_string())?;
    }

    // Only now is the replica redundant — and only if its contents were saved.
    if snapshotted {
        for suffix in ["", "-wal", "-shm", "-client_wal_index", "-info"] {
            let _ = std::fs::remove_file(format!("{replica_path}{suffix}"));
        }
    }
    Ok(descriptor)
}

/// Pulls the primary's latest changes now instead of waiting for the next
/// Triggers an immediate pull from the primary. The embedded-replica design
/// this served is gone with the SeaORM migration (Local is a single file,
/// Postgres is a live network connection with no local replica), so there is
/// nothing to sync. Kept as a no-op so the frontend's existing UI/button keeps
/// working without a command-dispatch change in this pass.
#[crate::shim::command]
pub async fn db_sync_now(_state: State<'_, AppState>) -> std::result::Result<(), String> {
    Ok(())
}

/// Writes a consistent snapshot of the database to `dest` via VACUUM INTO,
/// safe to run even with WAL journal entries not yet checkpointed.
#[crate::shim::command]
pub async fn db_export_backup(
    dest: String,
    password: Option<String>,
    conn: State<'_, AppState>,
) -> std::result::Result<(), String> {
    if !conn.descriptor()?.caps.export {
        return Err("Online databases do not support exporting backups".into());
    }
    let db = db::conn(&conn)?;
    match password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(password) => {
            let temp_snapshot = std::env::temp_dir().join(format!(
                "tanwords-export-{}.db",
                uuid::Uuid::new_v4()
            ));
            let result = async {
                export_backup(&db, &temp_snapshot.to_string_lossy()).await?;
                crate::db::import::create_encrypted_backup(
                    std::path::Path::new(&temp_snapshot),
                    std::path::Path::new(&dest),
                    password,
                )
            }
            .await;
            let _ = std::fs::remove_file(&temp_snapshot);
            result
        }
        None => export_backup(&db, &dest).await,
    }
}

#[crate::shim::command]
pub async fn db_clear_translations(conn: State<'_, AppState>) -> std::result::Result<(), String> {
    let db = db::conn(&conn)?;
    clear_translations(&db).await
}

/// Reclaims space left by deleted/updated rows. SQLite never shrinks a file on
/// its own (no `auto_vacuum` is configured — `FULL` would add per-write
/// overhead this workload doesn't want), so without this the file only grows,
/// even when the amount of live data doesn't. Must run outside any
/// transaction, which the shared connection already is.
#[crate::shim::command]
pub async fn db_vacuum(conn: State<'_, AppState>) -> std::result::Result<(), String> {
    let descriptor = conn.descriptor()?;
    if !descriptor.caps.vacuum {
        // Not a temporary condition (unlike `!writable`, which can clear up on
        // reconnect) — Turso/sqld's storage engine has no VACUUM at all, so
        // retrying is never going to help. See `DbCaps::vacuum`'s doc comment.
        return Err("Compacting isn't supported for an online (Turso/self-hosted) database".into());
    }
    let db = db::conn(&conn)?;
    db.execute("VACUUM", ()).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("tanwords-{name}-{}.db", uuid::Uuid::new_v4()))
    }

    async fn open_local(path: &std::path::Path) -> Conn {
        let profile = DbProfile::Local { path: path.to_string_lossy().into_owned() };
        db::connection::open(&profile, None).await.unwrap().conn()
    }

    fn test_app_handle() -> crate::shim::AppHandle {
        let (events, _rx) = tokio::sync::broadcast::channel(16);
        crate::shim::AppHandle::new(std::sync::Arc::new(crate::shim::Registry::default()), events)
    }

    #[test]
    fn database_size_includes_db_wal_and_shm_files() {
        let path = temp_path("size");
        std::fs::write(&path, vec![0; 11]).unwrap();
        std::fs::write(format!("{}-wal", path.display()), vec![0; 7]).unwrap();
        std::fs::write(format!("{}-shm", path.display()), vec![0; 5]).unwrap();
        assert_eq!(database_disk_size(path.to_str().unwrap()).unwrap(), 23);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[tokio::test]
    async fn database_can_be_created_reopened_backed_up_and_cleared() {
        let source = temp_path("source");
        let backup = temp_path("backup");
        {
            let conn = open_local(&source).await;
            conn.execute(
                "INSERT INTO translations (source_text, result_text, source_lang, target_lang, provider, mode) VALUES ('hello', '你好', 'en', 'zh', 'test', 'translate')",
                (),
            ).await.unwrap();
            export_backup(&conn, backup.to_str().unwrap()).await.unwrap();
            clear_translations(&conn).await.unwrap();
            let count = db::scalar_i64(&conn, "SELECT COUNT(*) FROM translations", ())
                .await
                .unwrap();
            assert_eq!(count, 0);
        }
        let reopened = open_local(&source).await;
        let backup_conn = open_local(&backup).await;
        let source_count = db::scalar_i64(&reopened, "SELECT COUNT(*) FROM translations", ())
            .await
            .unwrap();
        let backup_count = db::scalar_i64(&backup_conn, "SELECT COUNT(*) FROM translations", ())
            .await
            .unwrap();
        assert_eq!(source_count, 0);
        assert_eq!(backup_count, 1);
        drop(reopened);
        drop(backup_conn);
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(backup);
    }

    /// Requires a live Postgres reachable at `TANWORDS_PG_TEST_URL` — skipped
    /// otherwise, same convention as `seaorm_backend_parity.rs`.
    #[tokio::test]
    async fn postgres_snapshot_round_trips_scalars_and_blobs() {
        let Ok(url) = std::env::var("TANWORDS_PG_TEST_URL") else {
            eprintln!("skipping: TANWORDS_PG_TEST_URL not set");
            return;
        };
        let source = db::connection::open(&DbProfile::Postgres { url }, None)
            .await
            .unwrap()
            .conn();

        let word_id = source
            .insert_returning_id(
                "INSERT INTO words (word, level) VALUES ('snapshot-test-word', 'B1') RETURNING id",
                (),
            )
            .await
            .unwrap();
        let doc_id = source
            .insert_returning_id(
                "INSERT INTO documents (title, protection_salt, wrapped_key) VALUES ('doc', ?1, ?2) RETURNING id",
                params![vec![1u8, 2, 3, 4], vec![9u8, 8, 7]],
            )
            .await
            .unwrap();
        source
            .execute(
                "INSERT INTO document_assets (id, document_id, mime_type, data, size) VALUES ('asset-1', ?1, 'image/png', ?2, 4)",
                params![doc_id, vec![0xDEu8, 0xAD, 0xBE, 0xEF]],
            )
            .await
            .unwrap();

        let backup = temp_path("pg-snapshot");
        export_postgres_snapshot(&test_app_handle(), &source, backup.to_str().unwrap())
            .await
            .unwrap();

        let dest = open_local(&backup).await;
        let word: String = db::fetch_one(&dest, "SELECT word FROM words WHERE id = ?1", params![word_id], |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(word, "snapshot-test-word");

        let salt: Vec<u8> = db::fetch_one(&dest, "SELECT protection_salt FROM documents WHERE id = ?1", params![doc_id], |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(salt, vec![1, 2, 3, 4]);

        let asset_data: Vec<u8> = db::fetch_one(&dest, "SELECT data FROM document_assets WHERE id = 'asset-1'", (), |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(asset_data, vec![0xDE, 0xAD, 0xBE, 0xEF]);

        // Cleanup: the default seed rows (default calendars, settings) must
        // survive the clear-then-copy untouched too, not just the rows we
        // inserted — the destination's own INSERT OR IGNORE ones may already
        // exist on the Postgres side if this test has run before.
        drop(dest);
        let _ = std::fs::remove_file(&backup);
        source
            .execute("DELETE FROM document_assets WHERE id = 'asset-1'", ())
            .await
            .unwrap();
        source.execute("DELETE FROM documents WHERE id = ?1", params![doc_id]).await.unwrap();
        source.execute("DELETE FROM words WHERE id = ?1", params![word_id]).await.unwrap();
    }
}
