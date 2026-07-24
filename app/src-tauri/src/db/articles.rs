use rusqlite::params;
use tauri::State;

use crate::db;
use crate::AppState;

#[tauri::command]
pub fn db_save_article_analysis(
    title: String,
    source_url: String,
    origin: String,
    content: String,
    analysis_markdown: String,
    hn_item_id: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;

    db.execute(
        "INSERT INTO articles (title, source_url, origin, content, analysis_markdown, hn_item_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![title, source_url, origin, content, analysis_markdown, hn_item_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn db_add_known_words(
    words: Vec<String>,
    source: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for word in &words {
        tx.execute(
            "INSERT OR IGNORE INTO user_known_words (word, source) VALUES (?1, ?2)",
            params![word.to_lowercase(), source],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_get_known_words(conn: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare("SELECT word FROM user_known_words ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut result = vec![];
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
