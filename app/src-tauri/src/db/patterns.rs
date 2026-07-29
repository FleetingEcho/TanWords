use libsql::params;
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
pub async fn db_list_patterns(conn: State<'_, AppState>) -> Result<Vec<PatternItem>, String> {
    let db = db::conn(&conn)?;
    let mut patterns = db::fetch_all(
        &db,
        "SELECT id,pattern,zh,note,level,created_at FROM patterns ORDER BY created_at DESC, id DESC",
        (),
        |r| {
            Ok(PatternItem {
                id: r.get(0)?,
                pattern: r.get(1)?,
                zh: r.get(2)?,
                note: r.get(3)?,
                level: r.get(4)?,
                created_at: r.get(5)?,
                examples: Vec::new(),
            })
        },
    )
    .await?;
    let examples = db::fetch_all(
        &db,
        "SELECT id,pattern_id,sentence,source FROM pattern_examples ORDER BY id",
        (),
        |r| {
            Ok((
                r.get::<i64>(1)?,
                PatternExampleItem {
                    id: r.get(0)?,
                    sentence: r.get(2)?,
                    source: r.get(3)?,
                },
            ))
        },
    )
    .await?;
    for (pattern_id, example) in examples {
        if let Some(p) = patterns.iter_mut().find(|p| p.id == pattern_id) {
            p.examples.push(example);
        }
    }
    Ok(patterns)
}

#[tauri::command]
pub async fn db_delete_pattern(pattern_id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM pattern_practice WHERE pattern_id=?1", [pattern_id])
        .await
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM pattern_examples WHERE pattern_id=?1", [pattern_id])
        .await
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM patterns WHERE id=?1", [pattern_id])
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

/// Save a full sentence into the sentence-pattern library (patterns +
/// pattern_examples), deduplicating by the exact example sentence.
#[tauri::command]
pub async fn db_save_sentence_pattern(
    sentence: String,
    zh: String,
    skeleton: String,
    note: String,
    level: String,
    source: String,
    conn: State<'_, AppState>,
) -> Result<SavePatternResult, String> {
    let db = db::txn_conn(&conn).await?;
    let sentence = sentence.trim().to_string();
    if sentence.is_empty() {
        return Err("empty sentence".into());
    }
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    if let Some(id) = db::fetch_optional(
        &tx,
        "SELECT pattern_id FROM pattern_examples WHERE sentence=?1 LIMIT 1",
        [sentence.clone()],
        |r| r.get::<i64>(0),
    )
    .await?
    {
        return Ok(SavePatternResult {
            pattern_id: id,
            created: false,
        });
    }
    let skeleton = skeleton.trim().to_string();
    let pattern_text = if skeleton.is_empty() { sentence.clone() } else { skeleton };
    let level = level.trim().to_string();
    let level_opt = if level.is_empty() { None } else { Some(level) };
    tx.execute(
        "INSERT INTO patterns(pattern,zh,function_tag,level,note) VALUES(?1,?2,'other',?3,?4)",
        params![pattern_text, zh, level_opt, note],
    )
    .await
    .map_err(|e| e.to_string())?;
    let pattern_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO pattern_examples(pattern_id,sentence,source) VALUES(?1,?2,?3)",
        params![pattern_id, sentence, source],
    )
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(SavePatternResult {
        pattern_id,
        created: true,
    })
}
