use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db;
use crate::AppState;

const RECENT_LIMIT: i64 = 50;

#[derive(Serialize)]
pub struct SearchHistoryItem {
    pub word: String,
    pub searched_at: String,
    pub in_vocab: bool,
}

/// Records a dictionary lookup, or bumps it to the top if the word was
/// searched before — the list is "recent distinct words", not a raw log.
///
/// Re-searching deletes and re-inserts rather than updating searched_at in
/// place: CURRENT_TIMESTAMP is only second-resolution, so two lookups within
/// the same second would tie and sort arbitrarily. A fresh autoincrement id
/// is a reliable recency order regardless of clock resolution.
#[tauri::command]
pub fn db_add_search_history(word: String, conn: State<'_, AppState>) -> Result<(), String> {
    let word = word.trim().to_lowercase();
    if word.is_empty() {
        return Ok(());
    }
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM search_history WHERE word = ?1", params![word])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO search_history (word, searched_at) VALUES (?1, CURRENT_TIMESTAMP)",
        params![word],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// The most recent lookups, each flagged with whether the word is (now, not
/// necessarily at search time) in the vocabulary — computed fresh on every
/// read so it can't go stale if the word was added via a different route.
#[tauri::command]
pub fn db_get_search_history(
    conn: State<'_, AppState>,
) -> Result<Vec<SearchHistoryItem>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare(
            "SELECT sh.word, sh.searched_at,
                    EXISTS(SELECT 1 FROM words w WHERE w.word = sh.word) AS in_vocab
             FROM search_history sh
             ORDER BY sh.searched_at DESC, sh.id DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![RECENT_LIMIT], |row| {
            Ok(SearchHistoryItem {
                word: row.get(0)?,
                searched_at: row.get(1)?,
                in_vocab: row.get::<_, i64>(2)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = vec![];
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn db_clear_search_history(conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM search_history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
