use libsql::{params, Connection};
use std::collections::{HashMap, HashSet};
use crate::shim::{AppHandle, State};

use super::apply_documents_known::{apply_documents, apply_known_words};
use super::apply_patterns_articles::{apply_articles, apply_patterns};
use super::source::{has_table, open_source, read_words, SourceWord};
use super::types::{ImportDecisions, ImportOutcome, ImportProgress, ImportResult};
use crate::db;
use crate::AppState;

/// Every incoming word's existing id, if any — one query for the whole
/// import instead of one per word. `IN (?1, ?2, ...)` rather than a temp
/// table or a join: this only ever runs against a target's own connection
/// (never source-controlled SQL), and the placeholder count is bounded by
/// how many words a single import step processes.
async fn batch_lookup_word_ids(
    tx: &Connection,
    words: &[SourceWord],
) -> Result<HashMap<String, i64>, String> {
    let mut map = HashMap::with_capacity(words.len());
    if words.is_empty() {
        return Ok(map);
    }
    let placeholders =
        (1..=words.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
    let sql = format!("SELECT id, lower(word) FROM words WHERE lower(word) IN ({placeholders})");
    let params: Vec<libsql::Value> = words.iter().map(|w| w.key.clone().into()).collect();
    let rows: Vec<(i64, String)> = db::fetch_all(tx, &sql, params, |r| Ok((r.get(0)?, r.get(1)?))).await?;
    for (id, key) in rows {
        map.insert(key, id);
    }
    Ok(map)
}

// ── Apply ───────────────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn db_import_apply(
    app: AppHandle,
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

        // Only steps that will actually run count toward the total, so the UI's
        // "2/3" means something instead of always showing "2/5".
        let mut steps = vec!["words"];
        if has_table(&source, "patterns").await {
            steps.push("patterns");
        }
        if has_table(&source, "reading_articles").await {
            steps.push("articles");
        }
        if has_table(&source, "documents").await {
            steps.push("documents");
        }
        if has_table(&source, "user_known_words").await {
            steps.push("knownWords");
        }
        let step_total = steps.len();

        let tx = target.transaction().await.map_err(|e| e.to_string())?;
        let mut result = ImportResult::default();
        let mut step_index = 0usize;

        step_index += 1;
        result.outcomes.push(
            apply_words(&app, step_index, step_total, &source, &tx, &chosen("words"), decisions.include_new)
                .await?,
        );
        if steps.contains(&"patterns") {
            step_index += 1;
            let _ = app.emit(
                "import-progress",
                ImportProgress { step: "patterns".into(), step_index, step_total, done: 0, total: 0 },
            );
            result.outcomes
                .push(apply_patterns(&source, &tx, &chosen("patterns"), decisions.include_new).await?);
        }
        if steps.contains(&"articles") {
            step_index += 1;
            let _ = app.emit(
                "import-progress",
                ImportProgress { step: "articles".into(), step_index, step_total, done: 0, total: 0 },
            );
            result.outcomes
                .push(apply_articles(&source, &tx, &chosen("articles"), decisions.include_new).await?);
        }
        if steps.contains(&"documents") {
            step_index += 1;
            let _ = app.emit(
                "import-progress",
                ImportProgress { step: "documents".into(), step_index, step_total, done: 0, total: 0 },
            );
            result.outcomes
                .push(apply_documents(&source, &tx, &chosen("documents"), decisions.include_new).await?);
        }
        if steps.contains(&"knownWords") {
            step_index += 1;
            let _ = app.emit(
                "import-progress",
                ImportProgress { step: "knownWords".into(), step_index, step_total, done: 0, total: 0 },
            );
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
    app: &AppHandle,
    step_index: usize,
    step_total: usize,
    source: &Connection,
    tx: &Connection,
    overwrite: &HashSet<String>,
    include_new: bool,
) -> Result<ImportOutcome, String> {
    let incoming = read_words(source).await?;
    let total = incoming.len() as i64;
    let mut outcome = ImportOutcome { kind: "words".into(), ..Default::default() };

    // One round trip instead of one per word: against a remote (Turso/sqld)
    // target, that "SELECT ... WHERE lower(word) = ?" used to be a full
    // network round trip *per word* — for an import the size of a real
    // vocabulary (hundreds of words), that dominated the whole command's
    // wall time far more than the actual writing did.
    let existing_ids = batch_lookup_word_ids(tx, &incoming).await?;

    for (done, word) in incoming.into_iter().enumerate() {
        let _ = app.emit(
            "import-progress",
            ImportProgress { step: "words".into(), step_index, step_total, done: done as i64, total },
        );
        let existing = existing_ids.get(&word.key).copied();

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

        // All of a word's definitions in one INSERT (one multi-row VALUES list,
        // still fully parameterized — no hand-built SQL text) rather than one
        // round trip per definition. A word can have several senses, so this
        // is the other half of what made a real-sized import slow remotely.
        if !word.definitions.is_empty() {
            let mut sql = String::from(
                "INSERT INTO word_definitions (word_id, pos, zh, en, example_en, example_zh, sort_order) VALUES ",
            );
            let mut values: Vec<libsql::Value> = Vec::with_capacity(word.definitions.len() * 7);
            for (i, (pos, zh, en, example_en, example_zh, sort_order)) in word.definitions.iter().enumerate() {
                if i > 0 {
                    sql.push(',');
                }
                let base = i * 7;
                sql.push_str(&format!(
                    "(?{},?{},?{},?{},?{},?{},?{})",
                    base + 1,
                    base + 2,
                    base + 3,
                    base + 4,
                    base + 5,
                    base + 6,
                    base + 7
                ));
                values.push(word_id.into());
                values.push(pos.clone().into());
                values.push(zh.clone().into());
                values.push(en.clone().into());
                values.push(example_en.clone().into());
                values.push(example_zh.clone().into());
                values.push((*sort_order).into());
            }
            tx.execute(&sql, values).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(outcome)
}
