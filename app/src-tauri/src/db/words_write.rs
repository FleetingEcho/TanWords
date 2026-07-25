use rusqlite::{params, OptionalExtension};
use tauri::State;

use crate::db;
use crate::db::words_types::{
    AddWordResult, BatchAddResult, NewVocabWord, WordEnrichmentInput, WordExtras,
};
use crate::AppState;

#[tauri::command]
pub fn db_add_word(
    word: String,
    word_type: Option<String>,
    level: Option<String>,
    zh: String,
    conn: State<'_, AppState>,
) -> Result<AddWordResult, String> {
    let db = db::lock_db(&conn)?;

    let inserted = db.execute(
        "INSERT OR IGNORE INTO words (word, word_type, level, word_freq, source) VALUES (?1, ?2, ?3, 1, 'manual')",
        params![word, word_type, level],
    )
    .map_err(|e| e.to_string())?;

    let is_new = inserted > 0;

    let word_id: i64 = if is_new {
        db.last_insert_rowid()
    } else {
        db.query_row(
            "SELECT id FROM words WHERE word = ?1",
            params![&word],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    };

    db.execute(
        "INSERT OR IGNORE INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'other', ?2, 0)",
        params![word_id, zh],
    )
    .map_err(|e| e.to_string())?;

    db.execute(
        "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'word', 0, 2.5)",
        params![word_id],
    )
    .map_err(|e| e.to_string())?;

    if is_new {
        db.execute(
            "INSERT INTO daily_streaks (date, words_added) VALUES (date('now'), 1)
             ON CONFLICT(date) DO UPDATE SET words_added = words_added + 1",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(AddWordResult { id: word_id, is_new })
}

#[tauri::command]
pub fn db_delete_word(
    word_id: i64,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM words WHERE id = ?1", params![word_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_words_batch(
    word_ids: Vec<i64>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for word_id in word_ids {
        tx.execute("DELETE FROM words WHERE id = ?1", params![word_id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_set_word_starred(
    word_id: i64,
    starred: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "UPDATE words SET starred = ?1 WHERE id = ?2",
        params![starred, word_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_add_word_enriched(
    word: String,
    zh: String,
    word_type: Option<String>,
    enrichment: WordEnrichmentInput,
    conn: State<'_, AppState>,
) -> Result<AddWordResult, String> {
    let db = db::lock_db(&conn)?;

    db.execute_batch("BEGIN").map_err(|e| e.to_string())?;

    let inserted = db.execute(
        "INSERT OR IGNORE INTO words (word, word_type, level, word_freq, source) VALUES (?1, ?2, ?3, 1, 'ai')",
        params![word, word_type, enrichment.level],
    ).map_err(|e| e.to_string())?;

    let is_new = inserted > 0;

    let word_id: i64 = if is_new {
        db.last_insert_rowid()
    } else {
        db.query_row("SELECT id FROM words WHERE word = ?1", params![&word], |row| row.get(0))
            .map_err(|e| e.to_string())?
    };

    // Don't clobber a level/word_type a caller (e.g. Reading) already supplied.
    if !is_new {
        db.execute(
            "UPDATE words SET level = COALESCE(level, ?1), word_type = COALESCE(word_type, ?2) WHERE id = ?3",
            params![enrichment.level, word_type, word_id],
        ).map_err(|e| e.to_string())?;
    }

    // Seed (or backfill) a short gloss for quiz cards. Prefer the AI-parsed gloss, but
    // fall back to the caller-supplied `zh` (e.g. the word itself) so a model that
    // returns no usable gloss still leaves the word with *some* gloss instead of a
    // permanently blank list entry. Only skip existing definitions that already carry
    // a non-empty gloss — otherwise a word whose very first definition row landed empty
    // (e.g. an earlier failed enrichment) could never be fixed by re-analyzing, since
    // the row's mere existence would keep blocking every future write.
    let existing_zh: Option<String> = db.query_row(
        "SELECT zh FROM word_definitions WHERE word_id = ?1 ORDER BY sort_order LIMIT 1",
        params![word_id],
        |row| row.get(0),
    ).optional().map_err(|e| e.to_string())?;
    let needs_gloss = existing_zh.as_deref().map(|z| z.trim().is_empty()).unwrap_or(true);
    if needs_gloss {
        let gloss = enrichment.zh_short.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or(zh.as_str());
        if existing_zh.is_some() {
            db.execute(
                "UPDATE word_definitions SET zh = ?1 WHERE word_id = ?2 AND (zh IS NULL OR TRIM(zh) = '')",
                params![gloss, word_id],
            ).map_err(|e| e.to_string())?;
        } else {
            db.execute(
                "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'other', ?2, 0)",
                params![word_id, gloss],
            ).map_err(|e| e.to_string())?;
        }
    }

    db.execute(
        "UPDATE words SET enrichment_text = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![enrichment.text, word_id],
    ).map_err(|e| e.to_string())?;

    db.execute(
        "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'word', 0, 2.5)",
        params![word_id],
    ).map_err(|e| e.to_string())?;

    if is_new {
        db.execute(
            "INSERT INTO daily_streaks (date, words_added) VALUES (date('now'), 1) ON CONFLICT(date) DO UPDATE SET words_added = words_added + 1",
            [],
        ).map_err(|e| e.to_string())?;
    }

    db.execute_batch("COMMIT").map_err(|e| e.to_string())?;

    Ok(AddWordResult { id: word_id, is_new })
}

// ── Word Notes & Chat ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_get_word_extras(
    word_id: i64,
    conn: State<'_, AppState>,
) -> Result<WordExtras, String> {
    let db = db::lock_db(&conn)?;
    let notes: String = db.query_row(
        "SELECT COALESCE(user_notes, '') FROM words WHERE id = ?1",
        params![word_id],
        |row| row.get(0),
    ).unwrap_or_default();
    let messages: String = db.query_row(
        "SELECT messages FROM word_chats WHERE word_id = ?1",
        params![word_id],
        |row| row.get(0),
    ).unwrap_or_else(|_| "[]".to_string());
    Ok(WordExtras { notes, messages })
}

#[tauri::command]
pub fn db_save_word_notes(
    word_id: i64,
    notes: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "UPDATE words SET user_notes = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![notes, word_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_save_word_chat(
    word_id: i64,
    messages: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "INSERT INTO word_chats (word_id, messages, updated_at)
         VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(word_id) DO UPDATE SET messages = ?2, updated_at = CURRENT_TIMESTAMP",
        params![word_id, messages],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Batch add (used by AI Chat vocabulary tools + future batch import) ──────

#[tauri::command]
pub fn db_add_words_batch(
    words: Vec<NewVocabWord>,
    source: String,
    tag: Option<String>,
    conn: State<'_, AppState>,
) -> Result<BatchAddResult, String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;

    let mut added = 0i64;
    let mut skipped = 0i64;

    let tags_json = tag
        .filter(|t| !t.trim().is_empty())
        .map(|t| serde_json::json!([t]).to_string())
        .unwrap_or_else(|| "[]".to_string());

    for w in &words {
        let word_lower = w.word.trim().to_lowercase();
        if word_lower.is_empty() {
            continue;
        }
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO words (word, word_type, level, word_freq, source, tags) VALUES (?1, ?2, ?3, 1, ?4, ?5)",
                params![word_lower, w.word_type, w.level, source, tags_json],
            )
            .map_err(|e| e.to_string())?;

        if inserted > 0 {
            added += 1;
            let word_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT OR IGNORE INTO word_definitions (word_id, pos, zh, example_en, sort_order) VALUES (?1, 'other', ?2, ?3, 0)",
                params![word_id, w.zh, w.context],
            )
            .map_err(|e| e.to_string())?;
        } else {
            skipped += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(BatchAddResult { added, skipped })
}
