use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::{db, AppState};

#[derive(Serialize)]
pub struct SavePatternResult {
    pattern_id: i64,
    created: bool,
}

#[derive(Serialize)]
pub struct PatternExampleItem {
    id: i64,
    sentence: String,
    source: String,
}

#[derive(Serialize)]
pub struct PatternItem {
    id: i64,
    pattern: String,
    zh: String,
    note: String,
    level: Option<String>,
    created_at: String,
    examples: Vec<PatternExampleItem>,
}

#[tauri::command]
pub fn db_list_patterns(conn: State<'_, AppState>) -> Result<Vec<PatternItem>, String> {
    let db = db::lock_db(&conn)?;
    let mut s = db
        .prepare("SELECT id,pattern,zh,note,level,created_at FROM patterns ORDER BY created_at DESC, id DESC")
        .map_err(|e| e.to_string())?;
    let mut patterns = s
        .query_map([], |r| {
            Ok(PatternItem {
                id: r.get(0)?,
                pattern: r.get(1)?,
                zh: r.get(2)?,
                note: r.get(3)?,
                level: r.get(4)?,
                created_at: r.get(5)?,
                examples: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut es = db
        .prepare("SELECT id,pattern_id,sentence,source FROM pattern_examples ORDER BY id")
        .map_err(|e| e.to_string())?;
    let examples = es
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(1)?,
                PatternExampleItem {
                    id: r.get(0)?,
                    sentence: r.get(2)?,
                    source: r.get(3)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for (pattern_id, example) in examples {
        if let Some(p) = patterns.iter_mut().find(|p| p.id == pattern_id) {
            p.examples.push(example);
        }
    }
    Ok(patterns)
}

#[tauri::command]
pub fn db_delete_pattern(pattern_id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM pattern_practice WHERE pattern_id=?1", [pattern_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM pattern_examples WHERE pattern_id=?1", [pattern_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM patterns WHERE id=?1", [pattern_id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Save a full sentence into the sentence-pattern library (patterns +
/// pattern_examples), deduplicating by the exact example sentence.
#[tauri::command]
pub fn db_save_sentence_pattern(
    sentence: String,
    zh: String,
    skeleton: String,
    note: String,
    level: String,
    source: String,
    conn: State<'_, AppState>,
) -> Result<SavePatternResult, String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let sentence = sentence.trim();
    if sentence.is_empty() {
        return Err("empty sentence".into());
    }
    if let Some(id) = tx
        .query_row(
            "SELECT pattern_id FROM pattern_examples WHERE sentence=?1 LIMIT 1",
            [sentence],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return Ok(SavePatternResult {
            pattern_id: id,
            created: false,
        });
    }
    let skeleton = skeleton.trim();
    let pattern_text = if skeleton.is_empty() { sentence } else { skeleton };
    let level = level.trim();
    let level_opt = if level.is_empty() { None } else { Some(level) };
    tx.execute(
        "INSERT INTO patterns(pattern,zh,function_tag,level,note) VALUES(?1,?2,'other',?3,?4)",
        params![pattern_text, zh, level_opt, note],
    )
    .map_err(|e| e.to_string())?;
    let pattern_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO pattern_examples(pattern_id,sentence,source) VALUES(?1,?2,?3)",
        params![pattern_id, sentence, source],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(SavePatternResult {
        pattern_id,
        created: true,
    })
}
