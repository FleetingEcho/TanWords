use rusqlite::{Connection, Result};
use tauri::State;

use crate::AppState;
use crate::db;

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

    crate::appconfig::save_db_path_override(&new_path).map_err(|e| e.to_string())?;
    Ok(new_path)
}

/// Writes a consistent snapshot of the database to `dest` via VACUUM INTO,
/// safe to run even with WAL journal entries not yet checkpointed.
#[tauri::command]
pub fn db_export_backup(dest: String, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("VACUUM INTO ?1", rusqlite::params![dest])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_clear_translations(conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM translations", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
