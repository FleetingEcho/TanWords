use rusqlite::params;
use tauri::State;

use crate::db;
use crate::db::words_types::{EtymologyItem, PhoneticItem, WordDefItem, WordDetail, WordListItem};
use crate::AppState;

#[tauri::command]
pub fn db_get_words(
    search: Option<String>,
    level_filter: Option<String>,
    sort_by: Option<String>,
    conn: State<'_, AppState>,
) -> Result<Vec<WordListItem>, String> {
    let db = db::lock_db(&conn)?;

    let mut sql = String::from(
        "SELECT w.id, w.word, w.word_type, w.level, w.word_freq,
                COALESCE((SELECT wd.zh FROM word_definitions wd WHERE wd.word_id = w.id ORDER BY wd.sort_order LIMIT 1), '') as zh,
                COALESCE(sr.srs_level, 0) as srs_level,
                sr.next_review_at,
                w.created_at,
                COALESCE(w.source, 'manual') as source
         FROM words w
         LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
         WHERE 1=1"
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];

    if let Some(ref s) = search {
        sql.push_str(" AND (w.word LIKE ?1 OR EXISTS (SELECT 1 FROM word_definitions wd2 WHERE wd2.word_id = w.id AND wd2.zh LIKE ?1))");
        param_values.push(Box::new(format!("%{}%", s)));
    }

    if let Some(ref lv) = level_filter {
        if lv == "B1-" {
            sql.push_str(" AND w.level IN ('B1', 'A2', 'A1')");
        } else {
            let idx = param_values.len() + 1;
            sql.push_str(&format!(" AND w.level = ?{idx}"));
            param_values.push(Box::new(lv.clone()));
        }
    }

    match sort_by.as_deref() {
        Some("freq") => sql.push_str(" ORDER BY w.word_freq DESC, w.created_at DESC"),
        Some("alpha") => sql.push_str(" ORDER BY w.word COLLATE NOCASE ASC"),
        _ => sql.push_str(" ORDER BY w.created_at DESC"),
    }

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
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
                source: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = vec![];
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn db_get_word_detail(
    word_id: i64,
    conn: State<'_, AppState>,
) -> Result<WordDetail, String> {
    let db = db::lock_db(&conn)?;

    let word = db
        .query_row(
            "SELECT w.id, w.word, w.word_type, w.level, w.word_freq, w.mnemonic, w.notes, w.source, w.created_at,
                    COALESCE(sr.srs_level, 0), sr.next_review_at, w.enrichment_json
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
                    enrichment_json: row.get(11)?,
                    definitions: vec![],
                    phonetics: vec![],
                    etymology: None,
                })
            },
        )
        .map_err(|e| format!("Word not found: {e}"))?;

    // Fetch definitions
    let mut stmt = db
        .prepare(
            "SELECT pos, zh, en, example_en, example_zh
             FROM word_definitions WHERE word_id = ?1 ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;

    let definitions: Vec<WordDefItem> = stmt
        .query_map(params![word_id], |row| {
            Ok(WordDefItem {
                pos: row.get(0)?,
                zh: row.get(1)?,
                en: row.get(2)?,
                example_en: row.get(3)?,
                example_zh: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Fetch phonetics
    let mut stmt = db
        .prepare("SELECT locale, ipa, accent_label FROM word_phonetics WHERE word_id = ?1")
        .map_err(|e| e.to_string())?;

    let phonetics: Vec<PhoneticItem> = stmt
        .query_map(params![word_id], |row| {
            Ok(PhoneticItem {
                locale: row.get(0)?,
                ipa: row.get(1)?,
                accent_label: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Fetch etymology
    let etymology = db
        .query_row(
            "SELECT parts, story, origin_lang FROM word_etymology WHERE word_id = ?1",
            params![word_id],
            |row| {
                Ok(EtymologyItem {
                    parts: row.get(0)?,
                    story: row.get(1)?,
                    origin_lang: row.get(2)?,
                })
            },
        )
        .ok();

    Ok(WordDetail {
        definitions,
        phonetics,
        etymology,
        ..word
    })
}
