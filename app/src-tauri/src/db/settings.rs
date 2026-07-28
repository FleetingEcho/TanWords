use libsql::{params, Connection, Result};
use tauri::State;

use crate::db;
use crate::db::connection::{DbDescriptor, DbProfile};
use crate::AppState;

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

async fn export_backup(conn: &Connection, dest: &str) -> std::result::Result<(), String> {
    conn.execute("VACUUM INTO ?1", params![dest])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn clear_translations(conn: &Connection) -> std::result::Result<(), String> {
    conn.execute("DELETE FROM translations", ())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut rows = conn
        .query("SELECT value FROM user_settings WHERE key = ?1", params![key])
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub async fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)",
        params![key, value],
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn db_get_word_count(conn: State<'_, AppState>) -> std::result::Result<i64, String> {
    let db = db::conn(&conn)?;
    db::scalar_i64(&db, "SELECT COUNT(*) FROM words", ()).await
}

#[tauri::command]
pub async fn db_get_translation_count(
    conn: State<'_, AppState>,
) -> std::result::Result<i64, String> {
    let db = db::conn(&conn)?;
    db::scalar_i64(&db, "SELECT COUNT(*) FROM translations", ()).await
}

// db_get_review_count moved to srs.rs (needs FSRS-consistent date comparison).

#[tauri::command]
pub async fn db_get_setting(
    key: String,
    conn: State<'_, AppState>,
) -> std::result::Result<Option<String>, String> {
    let db = db::conn(&conn)?;
    get_setting(&db, &key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_set_setting(
    key: String,
    value: String,
    conn: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db = db::conn(&conn)?;
    set_setting(&db, &key, &value).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_db_path(state: State<'_, AppState>) -> std::result::Result<String, String> {
    state.db_path()
}

/// Bytes on disk. For a Turso profile this measures the local replica, which
/// is the only thing this process can actually stat.
#[tauri::command]
pub fn db_get_db_size(state: State<'_, AppState>) -> std::result::Result<u64, String> {
    database_disk_size(&state.db_path()?)
}

/// The active connection profile, including what it supports — the frontend
/// hides export/switch actions that can't work rather than failing on click.
#[tauri::command]
pub fn db_get_connection(state: State<'_, AppState>) -> std::result::Result<DbDescriptor, String> {
    state.descriptor()
}

/// Returns (and consumes-by-value, since it's a plain startup snapshot) the
/// profile that failed to open this launch, if that happened — `None`
/// otherwise. The frontend calls this once at startup to show a warning
/// instead of the app silently falling back to an empty default database
/// with no explanation.
#[tauri::command]
pub fn db_get_startup_warning(state: State<'_, AppState>) -> Option<String> {
    state.db_fallback_warning.clone()
}

/// Mounts a different SQLite file as the app's active database — creating it
/// (and running migrations) if it doesn't exist yet, or opening it as-is if
/// it does. Swaps the live connection in place so no restart is needed; the
/// caller (Settings UI) still does a full frontend reload afterward since
/// every already-loaded page's state was fetched from the old DB.
#[tauri::command]
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
#[tauri::command]
pub async fn db_connect_turso(
    url: String,
    token: String,
    state: State<'_, AppState>,
) -> std::result::Result<DbDescriptor, String> {
    let url = url.trim().to_string();
    let token = token.trim().to_string();
    if url.is_empty() {
        return Err("请填写 Turso 数据库 URL".into());
    }
    if token.is_empty() {
        return Err("请填写 Turso auth token".into());
    }

    let profile = DbProfile::Turso {
        path: crate::replica_db_path(),
        url,
    };
    // Open before persisting anything: a bad URL or token should leave the
    // current (working) connection and the saved profile exactly as they were.
    let database = db::connection::open(&profile, Some(&token)).await?;
    let descriptor = database.descriptor();

    crate::secrets::turso_token_set(&token)?;
    crate::appconfig::save_db_profile(&profile).map_err(|e| e.to_string())?;
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
#[tauri::command]
pub async fn db_disconnect_remote(
    state: State<'_, AppState>,
) -> std::result::Result<DbDescriptor, String> {
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
    crate::secrets::turso_token_clear();

    // Only now is the replica redundant — and only if its contents were saved.
    if snapshotted {
        for suffix in ["", "-wal", "-shm", "-client_wal_index", "-info"] {
            let _ = std::fs::remove_file(format!("{replica_path}{suffix}"));
        }
    }
    Ok(descriptor)
}

/// Pulls the primary's latest changes now instead of waiting for the next
/// background sync — for the "another device just added words" case.
#[tauri::command]
pub async fn db_sync_now(state: State<'_, AppState>) -> std::result::Result<(), String> {
    // Take an owned handle and drop the guard before awaiting — the state
    // mutex is a std one and must never be held across a suspend point.
    let handle = {
        let database = state.db.lock().map_err(|e| e.to_string())?;
        database.sync_handle()
    };
    match handle {
        Some(database) => database.sync().await.map(|_| ()).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Writes a consistent snapshot of the database to `dest` via VACUUM INTO,
/// safe to run even with WAL journal entries not yet checkpointed.
#[tauri::command]
pub async fn db_export_backup(
    dest: String,
    conn: State<'_, AppState>,
) -> std::result::Result<(), String> {
    if !conn.descriptor()?.caps.export {
        return Err("在线数据库不支持导出备份".into());
    }
    let db = db::conn(&conn)?;
    export_backup(&db, &dest).await
}

#[tauri::command]
pub async fn db_clear_translations(conn: State<'_, AppState>) -> std::result::Result<(), String> {
    let db = db::conn(&conn)?;
    clear_translations(&db).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("tanwords-{name}-{}.db", uuid::Uuid::new_v4()))
    }

    async fn open_local(path: &std::path::Path) -> Connection {
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
