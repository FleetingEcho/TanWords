//! External-database connection management and Postgres snapshot export.
//!
//! Split out of `settings` for size: everything that *points the app at* an
//! external database (switching the local file, connecting to Turso/Postgres,
//! disconnecting, the now-no-op sync) plus the Postgres→SQLite snapshot
//! machinery those operations need (Postgres has no local replica, so an
//! "export backup" there is a row-by-row copy into a freshly created local
//! file). All items are re-exported by the parent via `pub use connection::*;`
//! so the public surface (`db::settings::…`) and the build-script dispatch
//! path (which collapses this private submodule back to `db::settings`) are
//! unchanged from when these lived directly in `settings.rs`.

use crate::db::params; use crate::db::Conn; use crate::db::Value;
use crate::shim::State;

use crate::db;
use crate::db::connection::{DbDescriptor, DbProfile};
use crate::AppState;

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
    static SCHEMA: &str = include_str!("../../../sql/schema_postgres.sql");
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
