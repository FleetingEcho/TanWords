use crate::shim::State;
use crate::db::params;
use serde::Serialize;

use crate::{db, AppState};

#[derive(Serialize)]
pub struct SaveSentenceResult {
    id: i64,
    created: bool,
}

/// A saved sentence — first-class, like a word. Replaces the old
/// patterns + pattern_examples duo with a single flat table.
#[derive(Serialize)]
pub struct SentenceItem {
    id: i64,
    sentence: String,
    zh: String,
    level: Option<String>,
    note: String,
    source: String,
    article_id: Option<i64>,
    starred: bool,
    created_at: String,
    updated_at: String,
}

#[crate::shim::command]
pub async fn db_list_sentences(conn: State<'_, AppState>) -> Result<Vec<SentenceItem>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT id, sentence, zh, level, note, source, article_id, starred, created_at, updated_at
           FROM sentences ORDER BY created_at DESC, id DESC",
        (),
        |r| {
            Ok(SentenceItem {
                id: r.get(0)?,
                sentence: r.get(1)?,
                zh: r.get(2)?,
                level: r.get(3)?,
                note: r.get(4)?,
                source: r.get(5)?,
                article_id: r.get(6)?,
                // `starred` is a BIGINT 0/1 column — read as i64 and compare,
                // the same convention as words_query/calendar (Postgres won't
                // decode INT8 as bool).
                starred: r.get::<i64>(7)? != 0,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[crate::shim::command]
pub async fn db_delete_sentence(sentence_id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    db_delete_sentences_batch(vec![sentence_id], conn).await
}

/// Delete a selection in one transaction (mirrors the patterns batch delete).
#[crate::shim::command]
pub async fn db_delete_sentences_batch(
    sentence_ids: Vec<i64>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    if sentence_ids.is_empty() {
        return Ok(());
    }
    let ids = sentence_ids
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    tx.execute(
        &format!("DELETE FROM sentences WHERE id IN ({ids})"),
        (),
    )
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

#[crate::shim::command]
pub async fn db_set_sentence_starred(
    sentence_id: i64,
    starred: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE sentences SET starred = ?1 WHERE id = ?2",
        params![starred as i64, sentence_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Re-analyze / edit a saved sentence's translation, note, and level in place.
/// The sentence text itself is immutable (the user saved it as-is). Used by
/// the re-analyze action and the inline edit flow.
#[crate::shim::command]
pub async fn db_update_sentence(
    sentence_id: i64,
    zh: String,
    note: String,
    level: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let level = level.trim().to_string();
    let level_opt = if level.is_empty() { None } else { Some(level) };
    db.execute(
        "UPDATE sentences SET zh=?2, note=?3, level=?4, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![sentence_id, zh, note, level_opt],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Save a sentence into the library, deduplicating by the exact sentence text.
#[crate::shim::command]
pub async fn db_save_sentence(
    sentence: String,
    zh: String,
    note: String,
    level: String,
    source: String,
    conn: State<'_, AppState>,
) -> Result<SaveSentenceResult, String> {
    let db = db::txn_conn(&conn).await?;
    let sentence = sentence.trim().to_string();
    if sentence.is_empty() {
        return Err("empty sentence".into());
    }
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    // Dedup by exact sentence text.
    if let Some(id) = db::fetch_optional(
        &tx,
        "SELECT id FROM sentences WHERE sentence=?1 LIMIT 1",
        [sentence.clone()],
        |r| r.get::<i64>(0),
    )
    .await?
    {
        return Ok(SaveSentenceResult {
            id,
            created: false,
        });
    }
    let level = level.trim().to_string();
    let level_opt = if level.is_empty() { None } else { Some(level) };
    let id = db::fetch_one(
        &tx,
        "INSERT INTO sentences(sentence, zh, level, note, source, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP) RETURNING id",
        params![sentence, zh, level_opt, note, source],
        |r| r.get::<i64>(0),
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(SaveSentenceResult {
        id,
        created: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn batch_delete_removes_selected_sentences_and_keeps_the_rest() {
        let path = std::env::temp_dir()
            .join(format!("tanwords-sentence-batch-{}.db", std::process::id()))
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

        let first = db_save_sentence(
            "First sentence.".into(),
            "第一句。".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save first sentence");
        let kept = db_save_sentence(
            "Keep this sentence.".into(),
            "保留这句。".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save kept sentence");
        let third = db_save_sentence(
            "Third sentence.".into(),
            "第三句。".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save third sentence");

        db_delete_sentences_batch(vec![first.id, third.id], state.clone())
            .await
            .expect("batch delete sentences");

        let remaining = db_list_sentences(state)
            .await
            .expect("list remaining sentences");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, kept.id);

        // Dedup: saving the same sentence text returns the existing id, created=false.
        let dup = db_save_sentence(
            "Keep this sentence.".into(),
            "新翻译。".into(),
            String::new(),
            "A2".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("dedup save");
        assert!(!dup.created);
        assert_eq!(dup.id, kept.id);

        drop(app_state);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{path}-wal"));
        let _ = std::fs::remove_file(format!("{path}-shm"));
    }
}
