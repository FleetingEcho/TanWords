use std::collections::{HashMap, HashSet};
use crate::shim::State;

use super::source::{
    article_key, has_table, incoming_word_summary, open_source, read_words, truncate,
    word_summary,
};
use super::types::{ImportConflict, ImportGroup, ImportPlan};
use crate::db;
use crate::AppState;

// ── Analyze ─────────────────────────────────────────────────────────────────

#[crate::shim::command]
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
