use crate::db::params;
use crate::shim::State;

use crate::db;
use crate::db::words_types::{
    AddWordResult, BatchAddResult, NewVocabWord, WordEnrichmentInput, WordExtras,
};
use crate::AppState;

#[crate::shim::command]
pub async fn db_add_word(
    word: String,
    word_type: Option<String>,
    level: Option<String>,
    zh: String,
    conn: State<'_, AppState>,
) -> Result<AddWordResult, String> {
    let db = db::conn(&conn)?;

    // `INSERT … ON CONFLICT(word) DO NOTHING RETURNING id` is the portable
    // replacement for libsql's `INSERT OR IGNORE` + `last_insert_rowid()`: it
    // returns the new id on insert and no row on a (word) conflict. Both
    // SQLite ≥3.35 and Postgres support this exact shape.
    let inserted_id = db::fetch_optional(
        &db,
        "INSERT INTO words (word, word_type, level, word_freq, source) VALUES (?1, ?2, ?3, 1, 'manual')
         ON CONFLICT(word) DO NOTHING RETURNING id",
        params![word.clone(), word_type, level],
        |r| r.get::<i64>(0),
    )
    .await?;

    let is_new = inserted_id.is_some();

    let word_id: i64 = match inserted_id {
        Some(id) => id,
        None => {
            db::fetch_one(
                &db,
                "SELECT id FROM words WHERE word = ?1",
                params![word],
                |row| row.get(0),
            )
            .await?
        }
    };

    db.execute(
        "INSERT OR IGNORE INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'other', ?2, 0)",
        params![word_id, zh],
    )
    .await
    .map_err(|e| e.to_string())?;

    db.execute(
        "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'word', 0, 2.5)",
        params![word_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    if is_new {
        db.execute(
            "INSERT INTO daily_streaks (\"date\", words_added) VALUES (date('now'), 1)
             ON CONFLICT(\"date\") DO UPDATE SET words_added = daily_streaks.words_added + 1",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(AddWordResult { id: word_id, is_new })
}

#[crate::shim::command]
pub async fn db_delete_word(word_id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute("DELETE FROM words WHERE id = ?1", params![word_id])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_delete_words_batch(
    word_ids: Vec<i64>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    for word_id in word_ids {
        tx.execute("DELETE FROM words WHERE id = ?1", params![word_id])
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[crate::shim::command]
pub async fn db_set_word_starred(
    word_id: i64,
    starred: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE words SET starred = ?1 WHERE id = ?2",
        params![starred as i64, word_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_add_word_enriched(
    word: String,
    zh: String,
    word_type: Option<String>,
    enrichment: WordEnrichmentInput,
    conn: State<'_, AppState>,
) -> Result<AddWordResult, String> {
    let db = db::txn_conn(&conn).await?;

    // A real transaction handle, rather than the raw BEGIN/COMMIT statements
    // this used to issue: the older form left the connection stuck inside an
    // open transaction whenever an intermediate `?` bailed out early.
    let tx = db.transaction().await.map_err(|e| e.to_string())?;

    let inserted_id = db::fetch_optional(
        &tx,
        "INSERT INTO words (word, word_type, level, word_freq, source) VALUES (?1, ?2, ?3, 1, 'ai')
         ON CONFLICT(word) DO NOTHING RETURNING id",
        params![word.clone(), word_type.clone(), enrichment.level.clone()],
        |r| r.get::<i64>(0),
    )
    .await?;

    let is_new = inserted_id.is_some();

    let word_id: i64 = if let Some(id) = inserted_id {
        id
    } else {
        db::fetch_one(
            &tx,
            "SELECT id FROM words WHERE word = ?1",
            params![word],
            |row| row.get(0),
        )
        .await?
    };

    // Don't clobber a level/word_type a caller (e.g. Reading) already supplied.
    if !is_new {
        tx.execute(
            "UPDATE words SET level = COALESCE(level, ?1), word_type = COALESCE(word_type, ?2) WHERE id = ?3",
            params![enrichment.level.clone(), word_type, word_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    // Seed (or backfill) a short gloss for quiz cards. Prefer the AI-parsed gloss, but
    // fall back to the caller-supplied `zh` (e.g. the word itself) so a model that
    // returns no usable gloss still leaves the word with *some* gloss instead of a
    // permanently blank list entry. Only skip existing definitions that already carry
    // a non-empty gloss — otherwise a word whose very first definition row landed empty
    // (e.g. an earlier failed enrichment) could never be fixed by re-analyzing, since
    // the row's mere existence would keep blocking every future write.
    let existing_zh: Option<String> = db::fetch_optional(
        &tx,
        "SELECT zh FROM word_definitions WHERE word_id = ?1 ORDER BY sort_order LIMIT 1",
        params![word_id],
        |row| row.get(0),
    )
    .await?;
    let needs_gloss = existing_zh.as_deref().map(|z| z.trim().is_empty()).unwrap_or(true);
    if needs_gloss {
        let gloss = enrichment
            .zh_short
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(zh.as_str())
            .to_string();
        if existing_zh.is_some() {
            tx.execute(
                "UPDATE word_definitions SET zh = ?1 WHERE word_id = ?2 AND (zh IS NULL OR TRIM(zh) = '')",
                params![gloss, word_id],
            )
            .await
            .map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'other', ?2, 0)",
                params![word_id, gloss],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    tx.execute(
        "UPDATE words SET enrichment_text = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![enrichment.text, word_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'word', 0, 2.5)",
        params![word_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    if is_new {
        tx.execute(
            "INSERT INTO daily_streaks (\"date\", words_added) VALUES (date('now'), 1) ON CONFLICT(\"date\") DO UPDATE SET words_added = daily_streaks.words_added + 1",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(AddWordResult { id: word_id, is_new })
}

// ── Word Notes & Chat ─────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn db_get_word_extras(
    word_id: i64,
    conn: State<'_, AppState>,
) -> Result<WordExtras, String> {
    let db = db::conn(&conn)?;
    let notes: String = db::fetch_optional(
        &db,
        "SELECT COALESCE(user_notes, '') FROM words WHERE id = ?1",
        params![word_id],
        |row| row.get(0),
    )
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    let messages: String = db::fetch_optional(
        &db,
        "SELECT messages FROM word_chats WHERE word_id = ?1",
        params![word_id],
        |row| row.get(0),
    )
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "[]".to_string());
    Ok(WordExtras { notes, messages })
}

#[crate::shim::command]
pub async fn db_save_word_notes(
    word_id: i64,
    notes: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE words SET user_notes = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![notes, word_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_save_word_chat(
    word_id: i64,
    messages: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "INSERT INTO word_chats (word_id, messages, updated_at)
         VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(word_id) DO UPDATE SET messages = ?2, updated_at = CURRENT_TIMESTAMP",
        params![word_id, messages],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Batch add (used by AI Chat vocabulary tools + future batch import) ──────

#[crate::shim::command]
pub async fn db_add_words_batch(
    words: Vec<NewVocabWord>,
    source: String,
    tag: Option<String>,
    conn: State<'_, AppState>,
) -> Result<BatchAddResult, String> {
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;

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
        let inserted_id = db::fetch_optional(
            &tx,
            "INSERT INTO words (word, word_type, level, word_freq, source, tags) VALUES (?1, ?2, ?3, 1, ?4, ?5)
             ON CONFLICT(word) DO NOTHING RETURNING id",
            params![
                word_lower,
                w.word_type.clone(),
                w.level.clone(),
                source.clone(),
                tags_json.clone()
            ],
            |r| r.get::<i64>(0),
        )
        .await?;

        if let Some(word_id) = inserted_id {
            added += 1;
            tx.execute(
                "INSERT OR IGNORE INTO word_definitions (word_id, pos, zh, example_en, sort_order) VALUES (?1, 'other', ?2, ?3, 0)",
                params![word_id, w.zh.clone(), w.context.clone()],
            )
            .await
            .map_err(|e| e.to_string())?;
        } else {
            skipped += 1;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(BatchAddResult { added, skipped })
}
