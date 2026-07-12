use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db;
use crate::AppState;

#[derive(Serialize)]
pub struct PatternListItem {
    pub id: i64,
    pub pattern: String,
    pub zh: String,
    pub function_tag: String,
    pub level: Option<String>,
    pub example_count: i64,
    pub has_analysis: bool,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct PatternExample {
    pub id: i64,
    pub sentence: String,
    pub source: String,
    pub article_id: Option<i64>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct PatternDetail {
    pub id: i64,
    pub pattern: String,
    pub zh: String,
    pub function_tag: String,
    pub level: Option<String>,
    pub note: String,
    pub analysis: Option<String>,
    pub created_at: String,
    pub examples: Vec<PatternExample>,
}

/// Deserialized from the frontend's `exampleJson` param (see `NewPattern` in
/// useDB.types.ts) — `article_id` is optional because a pattern can be
/// hand-added without a source article.
#[derive(Deserialize)]
struct NewExample {
    sentence: String,
    #[serde(default)]
    source: String,
    #[serde(rename = "articleId")]
    article_id: Option<i64>,
}

/// Add a pattern, or fold into an existing one with the same skeleton text.
///
/// Dedup is case-insensitive + trim on `pattern` — this is what makes the
/// library "one skeleton, many real-article examples" instead of one row per
/// article: accepting the same pattern from a second article appends an
/// example rather than creating a duplicate entry.
#[tauri::command]
pub fn db_add_pattern(
    pattern: String,
    zh: String,
    note: String,
    level: Option<String>,
    function_tag: String,
    example_json: Option<String>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let pattern = pattern.trim().to_string();
    if pattern.is_empty() {
        return Err("pattern text is empty".to_string());
    }
    let example: Option<NewExample> = match example_json {
        Some(j) => Some(serde_json::from_str(&j).map_err(|e| e.to_string())?),
        None => None,
    };

    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;

    let existing: Option<(i64, String, String, Option<String>)> = tx
        .query_row(
            "SELECT id, zh, note, level FROM patterns WHERE LOWER(TRIM(pattern)) = LOWER(?1)",
            params![pattern],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let pattern_id = if let Some((id, old_zh, old_note, old_level)) = existing {
        // Backfill empty fields from the new call without clobbering existing content.
        let next_zh = if old_zh.is_empty() { zh } else { old_zh };
        let next_note = if old_note.is_empty() { note } else { old_note };
        let next_level = old_level.or(level);
        tx.execute(
            "UPDATE patterns SET zh = ?1, note = ?2, level = ?3 WHERE id = ?4",
            params![next_zh, next_note, next_level, id],
        )
        .map_err(|e| e.to_string())?;
        id
    } else {
        tx.execute(
            "INSERT INTO patterns (pattern, zh, note, level, function_tag) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![pattern, zh, note, level, function_tag],
        )
        .map_err(|e| e.to_string())?;
        tx.last_insert_rowid()
    };

    if let Some(ex) = example {
        let sentence = ex.sentence.trim().to_string();
        if !sentence.is_empty() {
            let dup: Option<i64> = tx
                .query_row(
                    "SELECT id FROM pattern_examples WHERE pattern_id = ?1 AND TRIM(sentence) = ?2",
                    params![pattern_id, sentence],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if dup.is_none() {
                tx.execute(
                    "INSERT INTO pattern_examples (pattern_id, sentence, source, article_id) VALUES (?1, ?2, ?3, ?4)",
                    params![pattern_id, sentence, ex.source, ex.article_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(pattern_id)
}

#[tauri::command]
pub fn db_get_patterns(
    function_tag: Option<String>,
    conn: State<'_, AppState>,
) -> Result<Vec<PatternListItem>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare(
            "SELECT p.id, p.pattern, p.zh, p.function_tag, p.level,
                    (SELECT COUNT(*) FROM pattern_examples e WHERE e.pattern_id = p.id),
                    p.analysis IS NOT NULL,
                    p.created_at
             FROM patterns p
             WHERE ?1 IS NULL OR p.function_tag = ?1
             ORDER BY p.id DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![function_tag], |row| {
            Ok(PatternListItem {
                id: row.get(0)?,
                pattern: row.get(1)?,
                zh: row.get(2)?,
                function_tag: row.get(3)?,
                level: row.get(4)?,
                example_count: row.get(5)?,
                has_analysis: row.get(6)?,
                created_at: row.get(7)?,
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
pub fn db_get_pattern_detail(id: i64, conn: State<'_, AppState>) -> Result<PatternDetail, String> {
    let db = db::lock_db(&conn)?;

    let (pattern, zh, function_tag, level, note, analysis, created_at) = db
        .query_row(
            "SELECT pattern, zh, function_tag, level, note, analysis, created_at FROM patterns WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, sentence, source, article_id, created_at
             FROM pattern_examples WHERE pattern_id = ?1 ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id], |row| {
            Ok(PatternExample {
                id: row.get(0)?,
                sentence: row.get(1)?,
                source: row.get(2)?,
                article_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut examples = vec![];
    for row in rows {
        examples.push(row.map_err(|e| e.to_string())?);
    }

    Ok(PatternDetail {
        id,
        pattern,
        zh,
        function_tag,
        level,
        note,
        analysis,
        created_at,
        examples,
    })
}

#[tauri::command]
pub fn db_update_pattern_analysis(
    id: i64,
    analysis: String,
    function_tag: Option<String>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "UPDATE patterns SET analysis = ?1, function_tag = COALESCE(?2, function_tag) WHERE id = ?3",
        params![analysis, function_tag, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_pattern(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM pattern_examples WHERE pattern_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM patterns WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Add a single example sentence to an existing pattern. Deduplicates on
/// identical (pattern_id, trimmed sentence) — returns the existing id if
/// already present.
#[tauri::command]
pub fn db_add_pattern_example(
    pattern_id: i64,
    sentence: String,
    source: String,
    article_id: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    let trimmed = sentence.trim();

    // Check for duplicate
    let existing: Option<i64> = db
        .query_row(
            "SELECT id FROM pattern_examples WHERE pattern_id = ?1 AND TRIM(sentence) = ?2",
            params![pattern_id, trimmed],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(id) = existing {
        return Ok(id);
    }

    db.execute(
        "INSERT INTO pattern_examples (pattern_id, sentence, source, article_id) VALUES (?1, ?2, ?3, ?4)",
        params![pattern_id, trimmed, source, article_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}
