use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::db;

#[derive(Serialize)]
pub struct TranslationItem {
    pub id: i64,
    pub source_text: String,
    pub result_text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub provider: String,
    pub mode: String,
    pub cluster_tag: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn db_save_translation(
    source_text: String,
    result_text: String,
    source_lang: Option<String>,
    target_lang: String,
    provider: String,
    mode: String,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "INSERT INTO translations (source_text, result_text, source_lang, target_lang, provider, mode) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![source_text, result_text, source_lang, target_lang, provider, mode],
    )
    .map_err(|e| e.to_string())?;

    let id = db.last_insert_rowid();

    db.execute(
        "INSERT INTO daily_streaks (date, translations) VALUES (date('now'), 1)
         ON CONFLICT(date) DO UPDATE SET translations = translations + 1",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn db_get_translations(
    search: Option<String>,
    cluster: Option<String>,
    conn: State<'_, AppState>,
) -> Result<Vec<TranslationItem>, String> {
    let db = db::lock_db(&conn)?;

    let mut sql = String::from(
        "SELECT id, source_text, result_text, source_lang, target_lang, provider, mode, cluster_tag, created_at
         FROM translations WHERE 1=1"
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];

    if let Some(ref s) = search {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(" AND (source_text LIKE ?{idx} OR result_text LIKE ?{idx})"));
        param_values.push(Box::new(format!("%{}%", s)));
    }

    if let Some(ref c) = cluster {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(" AND cluster_tag = ?{idx}"));
        param_values.push(Box::new(c.clone()));
    }

    sql.push_str(" ORDER BY created_at DESC LIMIT 200");

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(TranslationItem {
                id: row.get(0)?,
                source_text: row.get(1)?,
                result_text: row.get(2)?,
                source_lang: row.get(3)?,
                target_lang: row.get(4)?,
                provider: row.get(5)?,
                mode: row.get(6)?,
                cluster_tag: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = vec![];
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
