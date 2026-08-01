use libsql::{params, Connection};
use std::collections::HashSet;
use crate::shim::State;

use super::apply_documents_known::{apply_documents, apply_known_words};
use super::apply_patterns_articles::{apply_articles, apply_patterns};
use super::source::{has_table, open_source, read_words};
use super::types::{ImportDecisions, ImportOutcome, ImportResult};
use crate::db;
use crate::AppState;

// ── Apply ───────────────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn db_import_apply(
    source_path: String,
    password: Option<String>,
    decisions: ImportDecisions,
    conn: State<'_, AppState>,
) -> Result<ImportResult, String> {
    if !conn.descriptor()?.caps.writable {
        return Err("The current database is read-only and cannot import".into());
    }
    let temp = super::extract_encrypted_backup_to_temp(
        std::path::Path::new(&source_path),
        password.as_deref(),
    )?;
    let source_path_for_open = temp
        .as_ref()
        .map(|t| t.path().to_string_lossy().into_owned())
        .unwrap_or_else(|| source_path.clone());
    let source = open_source(&source_path_for_open).await?;
    let result = async {
        let target = db::txn_conn(&conn).await?;
        let empty = Vec::new();
        let chosen = |kind: &str| -> HashSet<String> {
            decisions
                .overwrite
                .get(kind)
                .unwrap_or(&empty)
                .iter()
                .cloned()
                .collect()
        };

        let tx = target.transaction().await.map_err(|e| e.to_string())?;
        let mut result = ImportResult::default();

        result
            .outcomes
            .push(apply_words(&source, &tx, &chosen("words"), decisions.include_new).await?);
        if has_table(&source, "patterns").await {
            result.outcomes
                .push(apply_patterns(&source, &tx, &chosen("patterns"), decisions.include_new).await?);
        }
        if has_table(&source, "reading_articles").await {
            result.outcomes
                .push(apply_articles(&source, &tx, &chosen("articles"), decisions.include_new).await?);
        }
        if has_table(&source, "documents").await {
            result.outcomes
                .push(apply_documents(&source, &tx, &chosen("documents"), decisions.include_new).await?);
        }
        if has_table(&source, "user_known_words").await {
            result.outcomes.push(apply_known_words(&source, &tx, decisions.include_new).await?);
        }

        tx.commit().await.map_err(|e| e.to_string())?;

        for outcome in &result.outcomes {
            result.added += outcome.added;
            result.overwritten += outcome.overwritten;
            result.skipped += outcome.skipped;
        }
        Ok(result)
    }
    .await;

    // `temp` (declared before `source`) drops after the source connection here,
    // and its Drop impl scrubs the plaintext snapshot on every exit path.
    result
}

pub(super) async fn apply_words(
    source: &Connection,
    tx: &Connection,
    overwrite: &HashSet<String>,
    include_new: bool,
) -> Result<ImportOutcome, String> {
    let incoming = read_words(source).await?;
    let mut outcome = ImportOutcome { kind: "words".into(), ..Default::default() };

    for word in incoming {
        let existing: Option<i64> = db::fetch_optional(
            tx,
            "SELECT id FROM words WHERE lower(word) = ?1",
            [word.key.clone()],
            |r| r.get(0),
        )
        .await?;

        let word_id = match existing {
            Some(id) if overwrite.contains(&word.key) => {
                tx.execute(
                    "UPDATE words SET word_type = COALESCE(?2, word_type), level = COALESCE(?3, level),
                            user_notes = ?4, enrichment_text = COALESCE(?5, enrichment_text),
                            updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?1",
                    params![
                        id,
                        word.word_type.clone(),
                        word.level.clone(),
                        word.user_notes.clone(),
                        word.enrichment_text.clone()
                    ],
                )
                .await
                .map_err(|e| e.to_string())?;
                // Definitions are replaced wholesale: merging two lists by
                // position would interleave unrelated senses.
                tx.execute("DELETE FROM word_definitions WHERE word_id = ?1", [id])
                    .await
                    .map_err(|e| e.to_string())?;
                outcome.overwritten += 1;
                id
            }
            Some(_) => {
                outcome.skipped += 1;
                continue;
            }
            None => {
                if !include_new {
                    outcome.skipped += 1;
                    continue;
                }
                tx.execute(
                    "INSERT INTO words (word, word_type, level, word_freq, source, user_notes, enrichment_text)
                     VALUES (?1, ?2, ?3, 1, 'import', ?4, ?5)",
                    params![
                        word.word.clone(),
                        word.word_type.clone(),
                        word.level.clone(),
                        word.user_notes.clone(),
                        word.enrichment_text.clone()
                    ],
                )
                .await
                .map_err(|e| e.to_string())?;
                let id = tx.last_insert_rowid();
                // Only a brand-new word carries its scheduling over; see the
                // module docs for why an overwrite never touches it.
                if let Some((level, ease, next)) = &word.srs {
                    tx.execute(
                        "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease, next_review_at)
                         VALUES (?1, 'word', ?2, ?3, ?4)",
                        params![id, *level, *ease, next.clone()],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                } else {
                    tx.execute(
                        "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'word', 0, 2.5)",
                        [id],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                }
                outcome.added += 1;
                id
            }
        };

        for (pos, zh, en, example_en, example_zh, sort_order) in &word.definitions {
            tx.execute(
                "INSERT INTO word_definitions (word_id, pos, zh, en, example_en, example_zh, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    word_id,
                    pos.clone(),
                    zh.clone(),
                    en.clone(),
                    example_en.clone(),
                    example_zh.clone(),
                    *sort_order
                ],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(outcome)
}
