use libsql::{params, Connection};
use std::collections::HashSet;

use super::types::ImportOutcome;
use crate::db;

pub(super) async fn apply_documents(
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

pub(super) async fn apply_known_words(
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
