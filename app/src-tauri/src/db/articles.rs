use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db;
use crate::AppState;

#[derive(Serialize)]
pub struct ArticleListItem {
    pub id: i64,
    pub title: String,
    pub source_url: String,
    pub origin: String,
    pub created_at: String,
    pub item_count: i64,
    pub accepted_count: i64,
}

#[derive(Serialize)]
pub struct ExtractedItem {
    pub id: i64,
    pub article_id: i64,
    pub kind: String,
    pub text: String,
    pub zh: String,
    pub note: String,
    pub level: String,
    pub context_sentence: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct ArticleDetail {
    pub id: i64,
    pub title: String,
    pub source_url: String,
    pub origin: String,
    pub content: String,
    pub created_at: String,
    pub items: Vec<ExtractedItem>,
}

#[derive(Deserialize)]
pub struct NewExtractedItem {
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub zh: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub context: String,
}

#[tauri::command]
pub fn db_save_article_analysis(
    title: String,
    source_url: String,
    origin: String,
    content: String,
    items_json: String,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let items: Vec<NewExtractedItem> =
        serde_json::from_str(&items_json).map_err(|e| e.to_string())?;

    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO articles (title, source_url, origin, content) VALUES (?1, ?2, ?3, ?4)",
        params![title, source_url, origin, content],
    )
    .map_err(|e| e.to_string())?;
    let article_id = tx.last_insert_rowid();

    for item in &items {
        tx.execute(
            "INSERT INTO extracted_items (article_id, kind, text, zh, note, level, context_sentence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![article_id, item.kind, item.text, item.zh, item.note, item.level, item.context],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(article_id)
}

#[tauri::command]
pub fn db_get_articles(
    page: Option<i64>,
    limit: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<Vec<ArticleListItem>, String> {
    let db = db::lock_db(&conn)?;
    let lim = limit.unwrap_or(50);
    let offset = page.unwrap_or(0) * lim;

    let mut stmt = db
        .prepare(
            "SELECT a.id, a.title, a.source_url, a.origin, a.created_at,
                    COUNT(e.id),
                    SUM(CASE WHEN e.status = 'accepted' THEN 1 ELSE 0 END)
             FROM articles a
             LEFT JOIN extracted_items e ON e.article_id = a.id
             GROUP BY a.id
             ORDER BY a.created_at DESC
             LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![lim, offset], |row| {
            Ok(ArticleListItem {
                id: row.get(0)?,
                title: row.get(1)?,
                source_url: row.get(2)?,
                origin: row.get(3)?,
                created_at: row.get(4)?,
                item_count: row.get(5)?,
                accepted_count: row.get::<_, Option<i64>>(6)?.unwrap_or(0),
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
pub fn db_get_article(id: i64, conn: State<'_, AppState>) -> Result<ArticleDetail, String> {
    let db = db::lock_db(&conn)?;

    let (title, source_url, origin, content, created_at) = db
        .query_row(
            "SELECT title, source_url, origin, content, created_at FROM articles WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, article_id, kind, text, zh, note, level, context_sentence, status
             FROM extracted_items WHERE article_id = ?1 ORDER BY kind, id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id], |row| {
            Ok(ExtractedItem {
                id: row.get(0)?,
                article_id: row.get(1)?,
                kind: row.get(2)?,
                text: row.get(3)?,
                zh: row.get(4)?,
                note: row.get(5)?,
                level: row.get(6)?,
                context_sentence: row.get(7)?,
                status: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut items = vec![];
    for row in rows {
        items.push(row.map_err(|e| e.to_string())?);
    }

    Ok(ArticleDetail {
        id,
        title,
        source_url,
        origin,
        content,
        created_at,
        items,
    })
}

#[tauri::command]
pub fn db_delete_article(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM extracted_items WHERE article_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM articles WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_update_item_status(
    id: i64,
    status: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "UPDATE extracted_items SET status = ?1 WHERE id = ?2",
        params![status, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_add_known_words(
    words: Vec<String>,
    source: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for word in &words {
        tx.execute(
            "INSERT OR IGNORE INTO user_known_words (word, source) VALUES (?1, ?2)",
            params![word.to_lowercase(), source],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_get_known_words(conn: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare("SELECT word FROM user_known_words ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut result = vec![];
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
