use crate::db::params; use crate::db::Conn;
use std::collections::HashSet;

use super::source::article_key;
use super::types::ImportOutcome;
use crate::db;

pub(super) async fn apply_sentences(
    source: &Conn,
    tx: &Conn,
    overwrite: &HashSet<String>,
    include_new: bool,
) -> Result<ImportOutcome, String> {
    let incoming: Vec<(i64, String, String, String, Option<String>, String)> = db::fetch_all(
        source,
        "SELECT id, sentence, COALESCE(zh,''), COALESCE(note,''), level, COALESCE(source,'import')
         FROM sentences ORDER BY id",
        (),
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    )
    .await?;
    let mut outcome = ImportOutcome { kind: "sentences".into(), ..Default::default() };

    for (_source_id, sentence, zh, note, level, origin) in incoming {
        let existing: Option<i64> = db::fetch_optional(
            tx,
            "SELECT id FROM sentences WHERE sentence = ?1",
            [sentence.clone()],
            |r| r.get::<i64>(0),
        )
        .await?;

        match existing {
            Some(id) if overwrite.contains(&sentence) => {
                tx.execute(
                    "UPDATE sentences SET zh = ?2, note = ?3, level = COALESCE(?4, level) WHERE id = ?1",
                    params![id, zh.clone(), note.clone(), level.clone()],
                )
                .await
                .map_err(|e| e.to_string())?;
                outcome.overwritten += 1;
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
                    "INSERT INTO sentences (sentence, zh, note, level, source) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![sentence.clone(), zh.clone(), note.clone(), level.clone(), origin.clone()],
                )
                .await
                .map_err(|e| e.to_string())?;
                outcome.added += 1;
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
