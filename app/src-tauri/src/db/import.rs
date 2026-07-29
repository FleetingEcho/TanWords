//! Merging another TanWords database file into the active one.
//!
//! The motivating case is bootstrapping a fresh online database from the local
//! one, but this works between any two TanWords databases in either direction.
//!
//! Two phases so the user decides before anything is written: `db_import_analyze`
//! opens the source read-only and reports what is new and what already exists;
//! `db_import_apply` takes a per-row decision for every conflict and writes the
//! result in one transaction.
//!
//! ## What is and isn't merged
//!
//! Only entities with a natural key can be merged, because a conflict is
//! meaningless without one:
//!
//! | entity          | key                                   |
//! |-----------------|---------------------------------------|
//! | words           | `lower(word)`                         |
//! | patterns        | `pattern`                             |
//! | reading articles| title + first 200 chars of content    |
//! | documents       | `title`                               |
//! | known words     | `word`                                |
//!
//! Everything else is deliberately left behind: `user_settings` is
//! device-scoped (it holds the MCP token, among other things) and importing it
//! would have two installs fighting over each other; `translations` is a cache;
//! scene-lab and quiz history are tied to ids that don't survive a merge.
//!
//! Overwriting a word replaces its content — definitions, enrichment, notes,
//! level — but never its `srs_records` row. Review scheduling is earned on the
//! device that did the reviewing, and there is no sensible way to merge two
//! FSRS histories; the target's progress wins. Genuinely new words do bring
//! their scheduling along, which is what makes a first import useful.

use libsql::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;

use crate::db;
use crate::AppState;

// ── Wire types ──────────────────────────────────────────────────────────────

/// One row in the source that already exists in the target, with enough of
/// both sides shown for the user to pick.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    /// Natural key, echoed back in the decisions to select this row.
    pub key: String,
    /// What the user recognises the row by.
    pub title: String,
    pub incoming: String,
    pub existing: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGroup {
    /// `words` | `patterns` | `articles` | `documents` | `knownWords`
    pub kind: String,
    /// Rows that don't exist in the target yet and will simply be added.
    pub new_count: i64,
    pub conflicts: Vec<ImportConflict>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlan {
    pub source_path: String,
    pub groups: Vec<ImportGroup>,
}

/// Which conflicting rows to overwrite, keyed by group kind. Anything absent is
/// skipped, so the safe default needs no client-side bookkeeping.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDecisions {
    #[serde(default)]
    pub overwrite: HashMap<String, Vec<String>>,
    /// Normally true — the whole point of an import. Exposed so "resolve these
    /// conflicts and nothing else" is possible.
    #[serde(default = "default_true")]
    pub include_new: bool,
}

fn default_true() -> bool {
    true
}

/// Written out rather than derived: `#[derive(Default)]` would ignore serde's
/// `default = "default_true"` and give `include_new: false`, so Rust callers
/// and JSON callers would disagree about what "default" means.
impl Default for ImportDecisions {
    fn default() -> Self {
        Self { overwrite: HashMap::new(), include_new: true }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub kind: String,
    pub added: i64,
    pub overwritten: i64,
    pub skipped: i64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub outcomes: Vec<ImportOutcome>,
    pub added: i64,
    pub overwritten: i64,
    pub skipped: i64,
}

// ── Source access ───────────────────────────────────────────────────────────

/// Opens the file the user picked, read-only. Read-only both because we never
/// modify their source and because it means a half-written or in-use file can
/// still be read rather than being migrated on the spot.
async fn open_source(path: &str) -> Result<Connection, String> {
    if !std::path::Path::new(path).exists() {
        return Err(format!("File not found: {path}"));
    }
    let db = libsql::Builder::new_local(path)
        .flags(libsql::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .build()
        .await
        .map_err(|e| format!("Failed to open database file: {e}"))?;
    let conn = db.connect().map_err(|e| e.to_string())?;
    // Anything without a words table isn't a TanWords database.
    db::scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='words'",
        (),
    )
    .await
    .ok()
    .filter(|found| *found > 0)
    .ok_or_else(|| "This is not a TanWords database file".to_string())?;
    Ok(conn)
}

/// `true` when the source has this table at all — older databases legitimately
/// don't, and a missing table should mean "nothing to import", not an error.
async fn has_table(conn: &Connection, table: &str) -> bool {
    db::scalar_i64(
        conn,
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
    )
    .await
    .unwrap_or(0)
        > 0
}

fn truncate(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    trimmed.chars().take(limit).collect::<String>() + "…"
}

/// The fingerprint `upsert_article` already uses to recognise a re-saved
/// article, reused here so an import agrees with the reader about identity.
fn article_key(title: &str, content: &str) -> String {
    format!("{title}\u{1}{}", content.chars().take(200).collect::<String>())
}

// ── Rows we carry across ────────────────────────────────────────────────────

struct SourceWord {
    key: String,
    word: String,
    word_type: Option<String>,
    level: Option<String>,
    user_notes: String,
    enrichment_text: Option<String>,
    definitions: Vec<(String, String, String, String, String, i64)>,
    srs: Option<(i64, f64, String)>,
}

async fn read_words(conn: &Connection) -> Result<Vec<SourceWord>, String> {
    let rows: Vec<(i64, String, Option<String>, Option<String>, String, Option<String>)> =
        db::fetch_all(
            conn,
            "SELECT id, word, word_type, level, COALESCE(user_notes, ''), enrichment_text
             FROM words ORDER BY id",
            (),
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .await?;

    let mut out = Vec::with_capacity(rows.len());
    for (id, word, word_type, level, user_notes, enrichment_text) in rows {
        let definitions = db::fetch_all(
            conn,
            "SELECT pos, zh, COALESCE(en,''), COALESCE(example_en,''), COALESCE(example_zh,''), COALESCE(sort_order,0)
             FROM word_definitions WHERE word_id = ?1 ORDER BY sort_order, id",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .await
        .unwrap_or_default();
        let srs = db::fetch_optional(
            conn,
            "SELECT COALESCE(srs_level,0), COALESCE(srs_ease,2.5), COALESCE(next_review_at,'')
             FROM srs_records WHERE entity_id = ?1 AND entity_type = 'word'",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .await
        .unwrap_or(None);

        out.push(SourceWord {
            key: word.trim().to_lowercase(),
            word,
            word_type,
            level,
            user_notes,
            enrichment_text,
            definitions,
            srs,
        });
    }
    Ok(out)
}

async fn word_summary(conn: &Connection, key: &str) -> String {
    db::fetch_optional(
        conn,
        "SELECT w.word, COALESCE((SELECT zh FROM word_definitions d WHERE d.word_id = w.id ORDER BY sort_order LIMIT 1), ''),
                (w.enrichment_text IS NOT NULL)
         FROM words w WHERE lower(w.word) = ?1",
        [key],
        |r| {
            let word: String = r.get(0)?;
            let zh: String = r.get(1)?;
            let enriched: i64 = r.get(2)?;
            Ok(format!(
                "{word}{}{}",
                if zh.is_empty() { String::new() } else { format!(" — {zh}") },
                if enriched != 0 { "（含 AI 讲解）" } else { "" }
            ))
        },
    )
    .await
    .ok()
    .flatten()
    .unwrap_or_default()
}

fn incoming_word_summary(word: &SourceWord) -> String {
    let zh = word
        .definitions
        .first()
        .map(|d| d.1.clone())
        .unwrap_or_default();
    format!(
        "{}{}{}",
        word.word,
        if zh.is_empty() { String::new() } else { format!(" — {zh}") },
        if word.enrichment_text.is_some() { "（含 AI 讲解）" } else { "" }
    )
}

// ── Analyze ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_import_analyze(
    source_path: String,
    conn: State<'_, AppState>,
) -> Result<ImportPlan, String> {
    let source = open_source(&source_path).await?;
    let target = db::conn(&conn)?;
    let mut groups = Vec::new();

    // ── Words
    {
        let incoming = read_words(&source).await?;
        let existing: HashSet<String> = db::fetch_all(
            &target,
            "SELECT lower(word) FROM words",
            (),
            |r| r.get::<String>(0),
        )
        .await?
        .into_iter()
        .collect();

        let mut new_count = 0;
        let mut conflicts = Vec::new();
        for word in &incoming {
            if existing.contains(&word.key) {
                conflicts.push(ImportConflict {
                    key: word.key.clone(),
                    title: word.word.clone(),
                    incoming: incoming_word_summary(word),
                    existing: word_summary(&target, &word.key).await,
                });
            } else {
                new_count += 1;
            }
        }
        groups.push(ImportGroup { kind: "words".into(), new_count, conflicts });
    }

    // ── Patterns
    if has_table(&source, "patterns").await {
        let incoming: Vec<(String, String, String)> = db::fetch_all(
            &source,
            "SELECT pattern, COALESCE(zh,''), COALESCE(note,'') FROM patterns ORDER BY id",
            (),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .await?;
        let existing: HashMap<String, String> = db::fetch_all(
            &target,
            "SELECT pattern, COALESCE(zh,'') FROM patterns",
            (),
            |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
        )
        .await?
        .into_iter()
        .collect();

        let mut new_count = 0;
        let mut conflicts = Vec::new();
        for (pattern, zh, _note) in &incoming {
            match existing.get(pattern) {
                Some(existing_zh) => conflicts.push(ImportConflict {
                    key: pattern.clone(),
                    title: truncate(pattern, 60),
                    incoming: truncate(zh, 60),
                    existing: truncate(existing_zh, 60),
                }),
                None => new_count += 1,
            }
        }
        groups.push(ImportGroup { kind: "patterns".into(), new_count, conflicts });
    }

    // ── Reading articles
    if has_table(&source, "reading_articles").await {
        let incoming: Vec<(String, String, i64)> = db::fetch_all(
            &source,
            "SELECT title, content, COALESCE(word_count,0) FROM reading_articles ORDER BY id",
            (),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .await?;
        let existing: HashMap<String, i64> = db::fetch_all(
            &target,
            "SELECT title, content, COALESCE(word_count,0) FROM reading_articles",
            (),
            |r| {
                let title: String = r.get(0)?;
                let content: String = r.get(1)?;
                Ok((article_key(&title, &content), r.get::<i64>(2)?))
            },
        )
        .await?
        .into_iter()
        .collect();

        let mut new_count = 0;
        let mut conflicts = Vec::new();
        for (title, content, words) in &incoming {
            let key = article_key(title, content);
            match existing.get(&key) {
                Some(existing_words) => conflicts.push(ImportConflict {
                    key,
                    title: truncate(title, 60),
                    incoming: format!("{words} words"),
                    existing: format!("{existing_words} words"),
                }),
                None => new_count += 1,
            }
        }
        groups.push(ImportGroup { kind: "articles".into(), new_count, conflicts });
    }

    // ── Documents (identity is the title; duplicate titles are legal in the
    //    app, so this is the weakest key of the five and is presented as such).
    if has_table(&source, "documents").await {
        let incoming: Vec<(String, i64)> = db::fetch_all(
            &source,
            "SELECT title, COALESCE(word_count,0) FROM documents ORDER BY id",
            (),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .await?;
        let existing: HashMap<String, i64> = db::fetch_all(
            &target,
            "SELECT title, COALESCE(word_count,0) FROM documents",
            (),
            |r| Ok((r.get::<String>(0)?, r.get::<i64>(1)?)),
        )
        .await?
        .into_iter()
        .collect();

        let mut new_count = 0;
        let mut conflicts = Vec::new();
        for (title, words) in &incoming {
            match existing.get(title) {
                Some(existing_words) => conflicts.push(ImportConflict {
                    key: title.clone(),
                    title: truncate(title, 60),
                    incoming: format!("{words} words"),
                    existing: format!("{existing_words} words"),
                }),
                None => new_count += 1,
            }
        }
        groups.push(ImportGroup { kind: "documents".into(), new_count, conflicts });
    }

    // ── Known words. Nothing to overwrite — membership is the whole record —
    //    so existing ones are simply not counted as new.
    if has_table(&source, "user_known_words").await {
        let incoming: Vec<String> = db::fetch_all(
            &source,
            "SELECT word FROM user_known_words",
            (),
            |r| r.get::<String>(0),
        )
        .await?;
        let existing: HashSet<String> = db::fetch_all(
            &target,
            "SELECT word FROM user_known_words",
            (),
            |r| r.get::<String>(0),
        )
        .await?
        .into_iter()
        .collect();
        let new_count = incoming.iter().filter(|w| !existing.contains(*w)).count() as i64;
        groups.push(ImportGroup { kind: "knownWords".into(), new_count, conflicts: Vec::new() });
    }

    Ok(ImportPlan { source_path, groups })
}

// ── Apply ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_import_apply(
    source_path: String,
    decisions: ImportDecisions,
    conn: State<'_, AppState>,
) -> Result<ImportResult, String> {
    if !conn.descriptor()?.caps.writable {
        return Err("The current database is read-only and cannot import".into());
    }
    let source = open_source(&source_path).await?;
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
        result
            .outcomes
            .push(apply_patterns(&source, &tx, &chosen("patterns"), decisions.include_new).await?);
    }
    if has_table(&source, "reading_articles").await {
        result
            .outcomes
            .push(apply_articles(&source, &tx, &chosen("articles"), decisions.include_new).await?);
    }
    if has_table(&source, "documents").await {
        result
            .outcomes
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

async fn apply_words(
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

async fn apply_patterns(
    source: &Connection,
    tx: &Connection,
    overwrite: &HashSet<String>,
    include_new: bool,
) -> Result<ImportOutcome, String> {
    let incoming: Vec<(i64, String, String, String, Option<String>)> = db::fetch_all(
        source,
        "SELECT id, pattern, COALESCE(zh,''), COALESCE(note,''), level FROM patterns ORDER BY id",
        (),
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )
    .await?;
    let mut outcome = ImportOutcome { kind: "patterns".into(), ..Default::default() };

    for (source_id, pattern, zh, note, level) in incoming {
        let existing: Option<i64> = db::fetch_optional(
            tx,
            "SELECT id FROM patterns WHERE pattern = ?1",
            [pattern.clone()],
            |r| r.get(0),
        )
        .await?;

        let pattern_id = match existing {
            Some(id) if overwrite.contains(&pattern) => {
                tx.execute(
                    "UPDATE patterns SET zh = ?2, note = ?3, level = COALESCE(?4, level) WHERE id = ?1",
                    params![id, zh.clone(), note.clone(), level.clone()],
                )
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
                    "INSERT INTO patterns (pattern, zh, function_tag, level, note) VALUES (?1, ?2, 'other', ?3, ?4)",
                    params![pattern.clone(), zh.clone(), level.clone(), note.clone()],
                )
                .await
                .map_err(|e| e.to_string())?;
                outcome.added += 1;
                tx.last_insert_rowid()
            }
        };

        // Examples are additive and deduplicated by sentence, so re-importing
        // the same library twice doesn't multiply them.
        let examples: Vec<(String, String)> = db::fetch_all(
            source,
            "SELECT sentence, COALESCE(source,'import') FROM pattern_examples WHERE pattern_id = ?1 ORDER BY id",
            [source_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .await
        .unwrap_or_default();
        for (sentence, origin) in examples {
            let dupe = db::scalar_i64(
                tx,
                "SELECT COUNT(*) FROM pattern_examples WHERE pattern_id = ?1 AND sentence = ?2",
                params![pattern_id, sentence.clone()],
            )
            .await?;
            if dupe == 0 {
                tx.execute(
                    "INSERT INTO pattern_examples (pattern_id, sentence, source) VALUES (?1, ?2, ?3)",
                    params![pattern_id, sentence, origin],
                )
                .await
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(outcome)
}

async fn apply_articles(
    source: &Connection,
    tx: &Connection,
    overwrite: &HashSet<String>,
    include_new: bool,
) -> Result<ImportOutcome, String> {
    let incoming: Vec<(i64, String, String, i64, String, String, String)> = db::fetch_all(
        source,
        "SELECT id, title, content, COALESCE(word_count,0), COALESCE(source,'import'),
                COALESCE(source_url,''), COALESCE(tags,'[]')
         FROM reading_articles ORDER BY id",
        (),
        |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        },
    )
    .await?;
    let mut outcome = ImportOutcome { kind: "articles".into(), ..Default::default() };

    for (source_id, title, content, word_count, origin, url, tags) in incoming {
        let key = article_key(&title, &content);
        let existing: Option<i64> = db::fetch_optional(
            tx,
            "SELECT id FROM reading_articles WHERE title = ?1 AND substr(content, 1, 200) = ?2",
            params![title.clone(), content.chars().take(200).collect::<String>()],
            |r| r.get(0),
        )
        .await?;

        let article_id = match existing {
            Some(id) if overwrite.contains(&key) => {
                tx.execute(
                    "UPDATE reading_articles SET content = ?2, word_count = ?3, source_url = ?4, tags = ?5 WHERE id = ?1",
                    params![id, content.clone(), word_count, url.clone(), tags.clone()],
                )
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
                    "INSERT INTO reading_articles (title, content, word_count, source, source_url, tags)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![title.clone(), content.clone(), word_count, origin.clone(), url.clone(), tags.clone()],
                )
                .await
                .map_err(|e| e.to_string())?;
                outcome.added += 1;
                tx.last_insert_rowid()
            }
        };

        let comments: Vec<(String, String, Option<String>)> = db::fetch_all(
            source,
            "SELECT COALESCE(author,'ai'), body, anchor_text FROM reading_article_comments WHERE article_id = ?1 ORDER BY id",
            [source_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .await
        .unwrap_or_default();
        for (author, body, anchor) in comments {
            let dupe = db::scalar_i64(
                tx,
                "SELECT COUNT(*) FROM reading_article_comments WHERE article_id = ?1 AND body = ?2",
                params![article_id, body.clone()],
            )
            .await?;
            if dupe == 0 {
                tx.execute(
                    "INSERT INTO reading_article_comments (article_id, author, body, anchor_text) VALUES (?1, ?2, ?3, ?4)",
                    params![article_id, author, body, anchor],
                )
                .await
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(outcome)
}

async fn apply_documents(
    source: &Connection,
    tx: &Connection,
    overwrite: &HashSet<String>,
    include_new: bool,
) -> Result<ImportOutcome, String> {
    let incoming: Vec<(String, String, String, String, i64)> = db::fetch_all(
        source,
        "SELECT title, content, COALESCE(content_text,''), COALESCE(tags,'[]'), COALESCE(word_count,0)
         FROM documents ORDER BY id",
        (),
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )
    .await?;
    let mut outcome = ImportOutcome { kind: "documents".into(), ..Default::default() };

    for (title, content, content_text, tags, word_count) in incoming {
        let existing: Option<i64> = db::fetch_optional(
            tx,
            "SELECT id FROM documents WHERE title = ?1 ORDER BY id LIMIT 1",
            [title.clone()],
            |r| r.get(0),
        )
        .await?;

        match existing {
            Some(id) if overwrite.contains(&title) => {
                tx.execute(
                    "UPDATE documents SET content = ?2, content_text = ?3, tags = ?4, word_count = ?5,
                            updated_at = datetime('now')
                     WHERE id = ?1",
                    params![id, content, content_text, tags, word_count],
                )
                .await
                .map_err(|e| e.to_string())?;
                outcome.overwritten += 1;
            }
            Some(_) => outcome.skipped += 1,
            None => {
                if !include_new {
                    outcome.skipped += 1;
                    continue;
                }
                tx.execute(
                    "INSERT INTO documents (title, content, content_text, tags, word_count) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![title, content, content_text, tags, word_count],
                )
                .await
                .map_err(|e| e.to_string())?;
                outcome.added += 1;
            }
        }
    }
    Ok(outcome)
}

async fn apply_known_words(
    source: &Connection,
    tx: &Connection,
    include_new: bool,
) -> Result<ImportOutcome, String> {
    let mut outcome = ImportOutcome { kind: "knownWords".into(), ..Default::default() };
    if !include_new {
        return Ok(outcome);
    }
    let incoming: Vec<String> =
        db::fetch_all(source, "SELECT word FROM user_known_words", (), |r| r.get::<String>(0))
            .await?;
    for word in incoming {
        let changed = tx
            .execute(
                "INSERT OR IGNORE INTO user_known_words (word, source) VALUES (?1, 'import')",
                [word],
            )
            .await
            .map_err(|e| e.to_string())?;
        if changed > 0 {
            outcome.added += 1;
        } else {
            outcome.skipped += 1;
        }
    }
    Ok(outcome)
}
