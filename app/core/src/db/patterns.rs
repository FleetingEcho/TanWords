use std::collections::HashMap;

use crate::shim::State;
use crate::db::params;
use serde::Serialize;

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
    starred: bool,
    created_at: String,
    updated_at: String,
    examples: Vec<PatternExampleItem>,
}

#[crate::shim::command]
pub async fn db_list_patterns(conn: State<'_, AppState>) -> Result<Vec<PatternItem>, String> {
    let db = db::conn(&conn)?;
    let mut patterns = db::fetch_all(
        &db,
        "SELECT id,pattern,zh,note,level,starred,created_at,updated_at FROM patterns ORDER BY created_at DESC, id DESC",
        (),
        |r| {
            Ok(PatternItem {
                id: r.get(0)?,
                pattern: r.get(1)?,
                zh: r.get(2)?,
                note: r.get(3)?,
                level: r.get(4)?,
                starred: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
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
    let pattern_indexes: HashMap<i64, usize> = patterns
        .iter()
        .enumerate()
        .map(|(index, pattern)| (pattern.id, index))
        .collect();
    for (pattern_id, example) in examples {
        if let Some(index) = pattern_indexes.get(&pattern_id) {
            patterns[*index].examples.push(example);
        }
    }
    Ok(patterns)
}

#[crate::shim::command]
pub async fn db_delete_pattern(pattern_id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    db_delete_patterns_batch(vec![pattern_id], conn).await
}

/// Delete a selection in one transaction. The frontend used to start one
/// request and one competing write transaction per selected sentence, which
/// could saturate the sidecar and leave its blocking confirmation dialog
/// waiting forever.
#[crate::shim::command]
pub async fn db_delete_patterns_batch(
    pattern_ids: Vec<i64>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    if pattern_ids.is_empty() {
        return Ok(());
    }

    // The IDs are already parsed as i64 by RPC, so interpolating them is safe
    // and avoids three database round trips per sentence (important for Turso).
    let ids = pattern_ids
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    for (table, column) in [
        ("pattern_practice", "pattern_id"),
        ("pattern_examples", "pattern_id"),
        ("patterns", "id"),
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE {column} IN ({ids})"),
            (),
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[crate::shim::command]
pub async fn db_set_pattern_starred(
    pattern_id: i64,
    starred: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE patterns SET starred = ?1 WHERE id = ?2",
        params![starred, pattern_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Overwrite a saved sentence's AI-derived analysis (translation, skeleton,
/// note, level) in place — used by the re-analyze action; the example
/// sentences themselves are untouched.
#[crate::shim::command]
pub async fn db_update_pattern_analysis(
    pattern_id: i64,
    zh: String,
    skeleton: String,
    note: String,
    level: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let level = level.trim().to_string();
    let level_opt = if level.is_empty() { None } else { Some(level) };
    db.execute(
        "UPDATE patterns SET pattern=?2, zh=?3, note=?4, level=?5, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![pattern_id, skeleton, zh, note, level_opt],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Save a full sentence into the sentence-pattern library (patterns +
/// pattern_examples), deduplicating by the exact example sentence.
#[crate::shim::command]
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
    let pattern_text = if skeleton.is_empty() {
        sentence.clone()
    } else {
        skeleton
    };
    let level = level.trim().to_string();
    let level_opt = if level.is_empty() { None } else { Some(level) };
    let pattern_id = db::fetch_one(
        &tx,
        "INSERT INTO patterns(pattern,zh,function_tag,level,note,updated_at) VALUES(?1,?2,'other',?3,?4,CURRENT_TIMESTAMP) RETURNING id",
        params![pattern_text, zh, level_opt, note],
        |r| r.get::<i64>(0),
    )
    .await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn batch_delete_removes_selected_patterns_and_keeps_the_rest() {
        let path = std::env::temp_dir()
            .join(format!("tanwords-pattern-batch-{}.db", std::process::id()))
            .to_string_lossy()
            .into_owned();
        let database =
            crate::db::connection::open(&crate::db::DbProfile::Local { path: path.clone() }, None)
                .await
                .expect("open test database");
        let app_state = crate::AppState {
            db: std::sync::Mutex::new(database),
            #[cfg(feature = "tts")]
            tts: std::sync::Mutex::new(None).into(),
            db_fallback_warning: None,
            document_privacy: Default::default(),
        };
        let state = crate::shim::State::from_ref(&app_state);

        let first = db_save_sentence_pattern(
            "First sentence.".into(),
            "第一句。".into(),
            "First sentence.".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save first pattern");
        let kept = db_save_sentence_pattern(
            "Keep this sentence.".into(),
            "保留这句。".into(),
            "Keep this sentence.".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save kept pattern");
        let third = db_save_sentence_pattern(
            "Third sentence.".into(),
            "第三句。".into(),
            "Third sentence.".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save third pattern");

        db_delete_patterns_batch(vec![first.pattern_id, third.pattern_id], state.clone())
            .await
            .expect("batch delete patterns");

        let remaining = db_list_patterns(state)
            .await
            .expect("list remaining patterns");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, kept.pattern_id);
        assert_eq!(remaining[0].examples.len(), 1);

        drop(app_state);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{path}-wal"));
        let _ = std::fs::remove_file(format!("{path}-shm"));
    }
}
