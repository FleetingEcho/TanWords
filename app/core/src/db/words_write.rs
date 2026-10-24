use crate::db::params;
use crate::shim::State;

use crate::db;
use crate::db::words_types::{
    AddWordResult, BatchAddResult, NewVocabWord, WordEnrichmentInput, WordExtras, WORD_STATUSES,
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

    // Seed the list gloss only when the word has none yet. `word_definitions`
    // has no uniqueness constraint, so the `INSERT OR IGNORE` this replaced
    // never ignored anything and appended a duplicate 'other' row on every
    // re-add. Mirrors the guard in `db_add_word_enriched`; an existing empty
    // gloss is backfilled rather than skipped so a bad first add can be fixed
    // by adding the word again.
    let existing_zh: Option<String> = db::fetch_optional(
        &db,
        "SELECT zh FROM word_definitions WHERE word_id = ?1 ORDER BY sort_order LIMIT 1",
        params![word_id],
        |row| row.get(0),
    )
    .await?;
    let needs_gloss = existing_zh
        .as_deref()
        .map(|z| z.trim().is_empty())
        .unwrap_or(true);
    if needs_gloss {
        if existing_zh.is_some() {
            db.execute(
                "UPDATE word_definitions SET zh = ?1 WHERE word_id = ?2 AND (zh IS NULL OR TRIM(zh) = '')",
                params![zh, word_id],
            )
            .await
            .map_err(|e| e.to_string())?;
        } else {
            db.execute(
                "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'other', ?2, 0)",
                params![word_id, zh],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }

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

// ── Learning status (the list's familiar checkbox) ──────────────────────────

/// Applies a status to one word and keeps `user_known_words` in agreement:
/// familiar/mastered words are known, so the reading module stops
/// highlighting them; reverting to "learning" removes only the row this
/// sync wrote (source 'vocab' — a word the user marked directly while
/// reading, source 'marked'/'import', must survive a vocab-side uncheck).
///
/// `updated_at` is deliberately NOT bumped — like `db_set_word_starred`, a
/// familiarity click is a quiet annotation, and under the list's default
/// "recently updated" sort a bump would yank the row to the top.
pub(crate) async fn set_word_status_row(conn: &db::Conn, word_id: i64, status: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE words SET status = ?1 WHERE id = ?2",
        params![status, word_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    let word: Option<String> = db::fetch_optional(
        conn,
        "SELECT word FROM words WHERE id = ?1",
        params![word_id],
        |row| row.get(0),
    )
    .await?;
    let Some(word) = word else { return Ok(()) };

    if status == "familiar" || status == "mastered" {
        // user_known_words.word is lowercase by convention (reading matches
        // lowercased lemma candidates against it).
        conn.execute(
            "INSERT INTO user_known_words (word, source) VALUES (?1, 'vocab') ON CONFLICT(word) DO NOTHING",
            params![word.to_lowercase()],
        )
        .await
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "DELETE FROM user_known_words WHERE word = ?1 AND source = 'vocab'",
            params![word.to_lowercase()],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate_status(status: &str) -> Result<&str, String> {
    if WORD_STATUSES.contains(&status) {
        Ok(status)
    } else {
        Err(format!(
            "invalid status: {status} (expected one of {})",
            WORD_STATUSES.join("/")
        ))
    }
}

/// Replace a word's category tags wholesale (the detail panel's tag editor —
/// a small multi-select, not an incremental add/remove). Empty vec clears
/// the category. Quotes are stripped per tag: the list filter probes
/// `tags LIKE '%"tag"%'` on the serialized JSON, so a `"` inside a tag would
/// break the probe's boundaries. Like the status/star toggles this is a quiet
/// annotation — `updated_at` is deliberately NOT bumped, keeping the
/// recent-sort stable.
#[crate::shim::command]
pub async fn db_set_word_tags(
    word_id: i64,
    tags: Vec<String>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let cleaned: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().replace('"', "").to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let tags_json = serde_json::to_string(&cleaned).map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE words SET tags = ?1 WHERE id = ?2",
        params![tags_json, word_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_set_word_status(
    word_id: i64,
    status: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let status = validate_status(&status)?;
    let db = db::conn(&conn)?;
    set_word_status_row(&db, word_id, status).await
}

#[crate::shim::command]
pub async fn db_set_words_status_batch(
    word_ids: Vec<i64>,
    status: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let status = validate_status(&status)?;
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    for word_id in word_ids {
        set_word_status_row(&tx, word_id, status).await?;
    }
    tx.commit().await.map_err(|e| e.to_string())
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

    // Guard: a garbage/empty explanation must never clobber an existing one.
    // AI explanations are expensive to regenerate — a truncated stream, an
    // aborted bulk run, or a future caller bug must not be able to wipe them
    // by writing near-empty text over a good analysis. New words still
    // accept short text (their first enrichment may legitimately be brief);
    // only the overwrite of an existing explanation is refused.
    let has_existing = db::fetch_optional(
        &tx,
        "SELECT LENGTH(enrichment_text) FROM words WHERE word = ?1",
        params![word.clone()],
        |r| r.get::<Option<i64>>(0),
    )
    .await?;
    if has_existing.flatten().unwrap_or(0) > 0 && enrichment.is_empty_explanation() {
        return Err("refusing to overwrite an existing analysis with an empty explanation".into());
    }

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

// ── Words-only export (CSV / JSON payload for one-click export) ────────────

/// One exported word row: list-visible fields plus the per-definition glosses
/// aggregated as a single string (CSV keeps one row per word; the multi-sense
/// JSON shape below preserves the details).
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedWord {
    pub word: String,
    pub word_type: Option<String>,
    pub level: Option<String>,
    pub zh: String,
    pub status: String,
    pub starred: bool,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[crate::shim::command]
pub async fn db_export_words_json(conn: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = db::conn(&conn)?;
    let rows: Vec<ExportedWord> = db::fetch_all(
        &db,
        "SELECT w.word, w.word_type, w.level,
                COALESCE((SELECT GROUP_CONCAT(d.zh, '; ') FROM
                    (SELECT zh FROM word_definitions WHERE word_id = w.id AND zh IS NOT NULL AND TRIM(zh) != '' ORDER BY sort_order) d),
                 '') as zh,
                COALESCE(w.status, 'learning'), w.starred != 0, COALESCE(w.source, 'manual'), w.created_at, w.updated_at
         FROM words w
         ORDER BY LOWER(w.word)",
        (),
        |row| {
            Ok(ExportedWord {
                word: row.get(0)?,
                word_type: row.get(1)?,
                level: row.get(2)?,
                zh: row.get(3)?,
                status: row.get(4)?,
                starred: row.get(5)?,
                source: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .await?;
    serde_json::to_value(&rows).map_err(|e| e.to_string())
}

/// CSV with a header row; every field is wrapped in double quotes with inner
/// quotes doubled, so commas/newlines inside glosses can't break a column.
#[crate::shim::command]
pub async fn db_export_words_csv(conn: State<'_, AppState>) -> Result<String, String> {
    let words = db_export_words_json(conn).await?;
    let rows: Vec<ExportedWord> = serde_json::from_value(words).map_err(|e| e.to_string())?;
    let mut out = String::from("word,type,level,zh,status,starred,source,created,updated\n");
    for w in &rows {
        let esc = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{}\n",
            esc(&w.word),
            esc(w.word_type.as_deref().unwrap_or("")),
            esc(w.level.as_deref().unwrap_or("")),
            esc(&w.zh),
            esc(&w.status),
            if w.starred { "1" } else { "0" },
            esc(&w.source),
            esc(&w.created_at),
            esc(&w.updated_at),
        ));
    }
    Ok(out)
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
