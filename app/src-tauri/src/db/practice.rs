use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db;
use crate::AppState;

#[derive(Serialize)]
pub struct PracticeRecord {
    pub id: i64,
    pub sentence: String,
    pub feedback: String,
    pub verdict: String,
    pub saved: bool,
    pub created_at: String,
}

#[tauri::command]
pub fn db_add_practice(
    pattern_id: i64,
    sentence: String,
    verdict: String,
    feedback: String,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "INSERT INTO pattern_practice (pattern_id, sentence, verdict, feedback) VALUES (?1, ?2, ?3, ?4)",
        params![pattern_id, sentence.trim(), verdict, feedback],
    )
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn db_get_practice(
    pattern_id: i64,
    limit: usize,
    conn: State<'_, AppState>,
) -> Result<Vec<PracticeRecord>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare(
            "SELECT id, sentence, feedback, verdict, saved, created_at
             FROM pattern_practice WHERE pattern_id = ?1
             ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![pattern_id, limit as i64], |row| {
            Ok(PracticeRecord {
                id: row.get(0)?,
                sentence: row.get(1)?,
                feedback: row.get(2)?,
                verdict: row.get(3)?,
                saved: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_practice(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM pattern_practice WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
