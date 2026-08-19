use crate::db::params; use crate::db::Conn; use crate::db::DbResult;
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
}
