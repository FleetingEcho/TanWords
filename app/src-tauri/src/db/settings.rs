use rusqlite::{Connection, Result};
use tauri::State;

use crate::db;
use crate::AppState;

fn database_disk_size(path: &str) -> Result<u64, String> {
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

fn export_backup(conn: &Connection, dest: &str) -> Result<(), String> {
    conn.execute("VACUUM INTO ?1", rusqlite::params![dest])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn clear_translations(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM translations", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM user_settings WHERE key = ?1")?;
    let mut rows = stmt.query(rusqlite::params![key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn db_get_word_count(conn: State<'_, AppState>) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    db.query_row("SELECT COUNT(*) FROM words", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_translation_count(conn: State<'_, AppState>) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    db.query_row("SELECT COUNT(*) FROM translations", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

// db_get_review_count moved to srs.rs (needs FSRS-consistent date comparison).

#[tauri::command]
pub fn db_get_setting(key: String, conn: State<'_, AppState>) -> Result<Option<String>, String> {
    let db = db::lock_db(&conn)?;
    get_setting(&db, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_set_setting(key: String, value: String, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    set_setting(&db, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_db_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.db_path.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn db_get_db_size(state: State<'_, AppState>) -> Result<u64, String> {
    let path = state.db_path.lock().map_err(|e| e.to_string())?.clone();
    database_disk_size(&path)
}

/// Returns (and consumes-by-value, since it's a plain startup snapshot) the
/// path of a previously-saved custom DB location that failed to open this
/// launch, if that happened — `None` otherwise. The frontend calls this once
/// at startup to show a warning instead of the app silently falling back to
/// an empty default database with no explanation.
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
pub fn db_switch_path(new_path: String, state: State<'_, AppState>) -> Result<String, String> {
    switch_db_path(new_path, state, true)
}

fn switch_db_path(
    new_path: String,
    state: State<'_, AppState>,
    persist_override: bool,
) -> Result<String, String> {
    let path = std::path::PathBuf::from(&new_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let new_conn = Connection::open(&new_path).map_err(|e| e.to_string())?;
    db::init_db(&new_conn).map_err(|e| e.to_string())?;

    {
        let mut conn_guard = state.db.lock().map_err(|e| e.to_string())?;
        *conn_guard = new_conn;
    }
    {
        let mut path_guard = state.db_path.lock().map_err(|e| e.to_string())?;
        *path_guard = new_path.clone();
    }

    if persist_override {
        crate::appconfig::save_db_path_override(&new_path).map_err(|e| e.to_string())?;
    }
    Ok(new_path)
}

/// Test-only behavior exposed to integration tests: exercises the complete
/// connection swap without modifying the real user's persisted app config.
#[doc(hidden)]
pub fn db_switch_path_without_persist(
    new_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    switch_db_path(new_path, state, false)
}

/// Writes a consistent snapshot of the database to `dest` via VACUUM INTO,
/// safe to run even with WAL journal entries not yet checkpointed.
#[tauri::command]
pub fn db_export_backup(dest: String, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    export_backup(&db, &dest)
}

#[tauri::command]
pub fn db_clear_translations(conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    clear_translations(&db)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("tanwords-{name}-{}.db", uuid::Uuid::new_v4()))
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

    #[test]
    fn database_can_be_created_reopened_backed_up_and_cleared() {
        let source = temp_path("source");
        let backup = temp_path("backup");
        {
            let conn = Connection::open(&source).unwrap();
            db::init_db(&conn).unwrap();
            conn.execute(
                "INSERT INTO translations (source_text, result_text, source_lang, target_lang, provider, mode) VALUES ('hello', '你好', 'en', 'zh', 'test', 'translate')",
                [],
            ).unwrap();
            export_backup(&conn, backup.to_str().unwrap()).unwrap();
            clear_translations(&conn).unwrap();
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM translations", [], |row| row.get(0))
                .unwrap();
            assert_eq!(count, 0);
        }
        let reopened = Connection::open(&source).unwrap();
        let backup_conn = Connection::open(&backup).unwrap();
        let source_count: i64 = reopened
            .query_row("SELECT COUNT(*) FROM translations", [], |row| row.get(0))
            .unwrap();
        let backup_count: i64 = backup_conn
            .query_row("SELECT COUNT(*) FROM translations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(source_count, 0);
        assert_eq!(backup_count, 1);
        drop(reopened);
        drop(backup_conn);
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(backup);
    }
}
