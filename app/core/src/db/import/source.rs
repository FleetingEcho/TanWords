use crate::db::connection::DbKind;
use crate::db::Conn;

use crate::db;

// ── Source access ───────────────────────────────────────────────────────────

/// Opens the file the user picked, read-only. Read-only both because we never
/// modify their source and because it means a half-written or in-use file can
/// still be read rather than being migrated on the spot.
pub(super) async fn open_source(path: &str) -> Result<Conn, String> {
    if !std::path::Path::new(path).exists() {
        return Err(format!("File not found: {path}"));
    }
    // `mode=ro` opens the file read-only (sqlx-sqlite honours it as
    // SQLITE_OPEN_READONLY). A single-connection pool is plenty for a one-off
    // import scan and avoids the N-empty-DBs pitfall on in-memory fixtures.
    let mut opts = sea_orm::ConnectOptions::new(format!("sqlite://{path}?mode=ro"));
    opts.max_connections(1);
    let db = sea_orm::Database::connect(opts)
        .await
        .map_err(|e| format!("Failed to open database file: {e}"))?;
    let conn = Conn::new_db(db, DbKind::Local);
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
pub(super) async fn has_table(conn: &Conn, table: &str) -> bool {
    db::scalar_i64(
        conn,
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
    )
    .await
    .unwrap_or(0)
        > 0
}

pub(super) fn truncate(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    trimmed.chars().take(limit).collect::<String>() + "…"
}

/// The fingerprint `upsert_article` already uses to recognise a re-saved
/// article, reused here so an import agrees with the reader about identity.
pub(super) fn article_key(title: &str, content: &str) -> String {
    format!("{title}\u{1}{}", content.chars().take(200).collect::<String>())
}

// ── Rows we carry across ────────────────────────────────────────────────────

pub(super) struct SourceWord {
    pub key: String,
    pub word: String,
    pub word_type: Option<String>,
    pub level: Option<String>,
    pub user_notes: String,
    pub enrichment_text: Option<String>,
    pub definitions: Vec<(String, String, String, String, String, i64)>,
    pub srs: Option<(i64, f64, String)>,
}

pub(super) async fn read_words(conn: &Conn) -> Result<Vec<SourceWord>, String> {
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

pub(super) async fn word_summary(conn: &Conn, key: &str) -> String {
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

pub(super) fn incoming_word_summary(word: &SourceWord) -> String {
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
