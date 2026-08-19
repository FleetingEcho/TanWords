use crate::db::params; use crate::db::Value;
use crate::shim::State;

use crate::db;
use crate::db::words_types::{WordDefItem, WordDetail, WordListItem};
use crate::AppState;

#[crate::shim::command]
pub async fn db_get_words(
    search: Option<String>,
    level_filter: Option<String>,
    sort_by: Option<String>,
    date_field: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    conn: State<'_, AppState>,
) -> Result<Vec<WordListItem>, String> {
    let db = db::conn(&conn)?;

    let mut sql = String::from(
        "SELECT w.id, w.word, w.word_type, w.level, w.word_freq,
                COALESCE((SELECT wd.zh FROM word_definitions wd WHERE wd.word_id = w.id ORDER BY wd.sort_order LIMIT 1), '') as zh,
                COALESCE(sr.srs_level, 0) as srs_level,
                sr.next_review_at,
                w.created_at,
                w.updated_at,
                COALESCE(w.source, 'manual') as source,
                (w.enrichment_text IS NOT NULL) as enriched,
                w.starred
         FROM words w
         LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
         WHERE 1=1"
    );

    let mut param_values: Vec<Value> = vec![];

    if let Some(ref s) = search {
        sql.push_str(" AND (w.word LIKE ?1 OR EXISTS (SELECT 1 FROM word_definitions wd2 WHERE wd2.word_id = w.id AND wd2.zh LIKE ?1))");
        param_values.push(Value::from(format!("%{}%", s)));
    }

    if let Some(ref lv) = level_filter {
        if lv == "B1-" {
            sql.push_str(" AND w.level IN ('B1', 'A2', 'A1')");
        } else {
            let idx = param_values.len() + 1;
            sql.push_str(&format!(" AND w.level = ?{idx}"));
            param_values.push(Value::from(lv.clone()));
        }
    }

    // Date-range filter, on either created_at or updated_at (default created_at).
    let date_col = match date_field.as_deref() {
        Some("updated") => "w.updated_at",
        _ => "w.created_at",
    };
    if let Some(ref from) = date_from {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(" AND {date_col} >= ?{idx}"));
        param_values.push(Value::from(from.clone()));
    }
    if let Some(ref to) = date_to {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(" AND {date_col} <= ?{idx}"));
        param_values.push(Value::from(format!("{} 23:59:59", to)));
    }

    match sort_by.as_deref() {
        Some("freq") => sql.push_str(" ORDER BY w.word_freq DESC, w.created_at DESC"),
        // LOWER(col) is the portable case-insensitive sort — SQLite's
        // `COLLATE NOCASE` is SQLite-only (Postgres has no NOCASE collation).
        Some("alpha") => sql.push_str(" ORDER BY LOWER(w.word) ASC"),
        // "recent" — updated_at is initialized to created_at on insert and bumped
        // on every edit (enrichment, notes), so ordering by it alone surfaces
        // both newly-added and newly-edited words without a MAX() expression.
        _ => sql.push_str(" ORDER BY w.updated_at DESC"),
    }

    db::fetch_all(&db, &sql, param_values, |row| {
        Ok(WordListItem {
            id: row.get(0)?,
            word: row.get(1)?,
            word_type: row.get(2)?,
            level: row.get(3)?,
            word_freq: row.get(4)?,
            zh: row.get(5)?,
            srs_level: row.get(6)?,
            next_review_at: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            source: row.get(10)?,
            enriched: row.get(11)?,
            starred: row.get(12)?,
        })
    })
    .await
}

#[crate::shim::command]
pub async fn db_get_word_detail(
    word_id: i64,
    conn: State<'_, AppState>,
) -> Result<WordDetail, String> {
    let db = db::conn(&conn)?;

    let word = db::fetch_one(
        &db,
        "SELECT w.id, w.word, w.word_type, w.level, w.word_freq, w.mnemonic, w.notes, w.source, w.created_at,
                    COALESCE(sr.srs_level, 0), sr.next_review_at, w.enrichment_text, w.enrichment_json
             FROM words w
             LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
         WHERE w.id = ?1",
        params![word_id],
        |row| {
            Ok(WordDetail {
                id: row.get(0)?,
                word: row.get(1)?,
                word_type: row.get(2)?,
                level: row.get(3)?,
                word_freq: row.get(4)?,
                mnemonic: row.get(5)?,
                notes: row.get(6)?,
                source: row.get(7)?,
                created_at: row.get(8)?,
                srs_level: row.get(9)?,
                next_review_at: row.get(10)?,
                enrichment_text: row.get(11)?,
                enrichment_json: row.get(12)?,
                definitions: vec![],
            })
        },
    )
    .await
    .map_err(|e| format!("Word not found: {e}"))?;

    let definitions: Vec<WordDefItem> = db::fetch_all(
        &db,
        "SELECT pos, zh, en, example_en, example_zh
         FROM word_definitions WHERE word_id = ?1 ORDER BY sort_order",
        params![word_id],
        |row| {
            Ok(WordDefItem {
                pos: row.get(0)?,
                zh: row.get(1)?,
                en: row.get(2)?,
                example_en: row.get(3)?,
                example_zh: row.get(4)?,
            })
        },
    )
    .await?;

    Ok(WordDetail { definitions, ..word })
}
