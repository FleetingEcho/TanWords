use crate::db::params; use crate::db::Conn;
use std::collections::HashSet;

use super::source::article_key;
use super::types::ImportOutcome;
use crate::db;

pub(super) async fn apply_patterns(
    source: &Conn,
    tx: &Conn,
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
            |r| r.get::<i64>(0),
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
                let id = db::fetch_one(
                    &tx,
                    "INSERT INTO patterns (pattern, zh, function_tag, level, note) VALUES (?1, ?2, 'other', ?3, ?4) RETURNING id",
                    params![pattern.clone(), zh.clone(), level.clone(), note.clone()],
                    |r| r.get::<i64>(0),
                )
                .await?;
                outcome.added += 1;
                id
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

pub(super) async fn apply_articles(
    source: &Conn,
    tx: &Conn,
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
            |r| r.get::<i64>(0),
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
                let id = db::fetch_one(
                    &tx,
                    "INSERT INTO reading_articles (title, content, word_count, source, source_url, tags)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
                    params![title.clone(), content.clone(), word_count, origin.clone(), url.clone(), tags.clone()],
                    |r| r.get::<i64>(0),
                )
                .await?;
                outcome.added += 1;
                id
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
