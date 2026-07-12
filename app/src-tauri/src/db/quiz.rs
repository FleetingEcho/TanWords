use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::db;

#[derive(Serialize)]
pub struct QuizWordItem {
    pub id: i64,
    pub word: String,
    pub zh: String,
}

#[tauri::command]
pub fn db_get_quiz_words(
    limit: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<Vec<QuizWordItem>, String> {
    let db = db::lock_db(&conn)?;
    let limit = limit.unwrap_or(10);

    let mut stmt = db
        .prepare(
            "SELECT w.id, w.word, COALESCE((SELECT wd.zh FROM word_definitions wd WHERE wd.word_id = w.id ORDER BY wd.sort_order LIMIT 1), '') as zh
             FROM words w
             LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
             WHERE sr.next_review_at <= datetime('now') OR sr.next_review_at IS NULL
             ORDER BY RANDOM()
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(QuizWordItem {
                id: row.get(0)?,
                word: row.get(1)?,
                zh: row.get(2)?,
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
pub fn db_save_quiz_result(
    word_id: i64,
    is_correct: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;

    let existing: Option<(i64, f64, i64)> = db
        .query_row(
            "SELECT srs_level, srs_ease, review_count FROM srs_records WHERE entity_id = ?1 AND entity_type = 'word'",
            params![word_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    if let Some((level, ease, count)) = existing {
        let quality = if is_correct { 4 } else { 1 };
        let new_ease = (ease + (0.1 - (5.0 - quality as f64) * (0.08 + (5.0 - quality as f64) * 0.02))).max(1.3);
        let new_level = if is_correct {
            if count == 0 { 1 }
            else if count == 1 { 6 }
            else { (level as f64 * new_ease).round() as i64 }
        } else {
            1
        };
        let new_level = new_level.min(365);

        db.execute(
            "UPDATE srs_records SET srs_level = ?1, srs_ease = ?2, review_count = review_count + 1, last_reviewed_at = datetime('now'), next_review_at = datetime('now', '+' || ?3 || ' days') WHERE entity_id = ?4 AND entity_type = 'word'",
            params![new_level, new_ease, new_level, word_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let quality = if is_correct { 4 } else { 1 };
        let new_ease = (2.5 + (0.1 - (5.0 - quality as f64) * (0.08 + (5.0 - quality as f64) * 0.02))).max(1.3);
        let new_level = if is_correct { 1 } else { 1 };

        db.execute(
            "INSERT INTO srs_records (entity_id, entity_type, srs_level, srs_ease, review_count, last_reviewed_at, next_review_at) VALUES (?1, 'word', ?2, ?3, 1, datetime('now'), datetime('now', '+' || ?4 || ' days'))",
            params![word_id, new_level, new_ease, new_level],
        )
        .map_err(|e| e.to_string())?;
    }

    db.execute(
        "INSERT INTO daily_streaks (date, quiz_done) VALUES (date('now'), 1)
         ON CONFLICT(date) DO UPDATE SET quiz_done = quiz_done + 1",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
