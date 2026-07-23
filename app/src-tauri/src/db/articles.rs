use rusqlite::params;
use serde::Serialize;
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
}

#[derive(Serialize)]
pub struct ArticleDetail {
    pub id: i64,
    pub title: String,
    pub source_url: String,
    pub origin: String,
    pub content: String,
    pub created_at: String,
    pub analysis_markdown: String,
}

#[derive(Serialize)]
pub struct SavedSentence {
    pub id: i64,
    pub text: String,
    pub zh: String,
    pub note: String,
    pub article_id: Option<i64>,
    pub article_title: String,
    pub created_at: String,
}

#[tauri::command]
pub fn db_save_article_analysis(
    title: String,
    source_url: String,
    origin: String,
    content: String,
    analysis_markdown: String,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;

    db.execute(
        "INSERT INTO articles (title, source_url, origin, content, analysis_markdown) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![title, source_url, origin, content, analysis_markdown],
    )
    .map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
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
            "SELECT id, title, source_url, origin, created_at
             FROM articles
             ORDER BY created_at DESC
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

    db.query_row(
        "SELECT id, title, source_url, origin, content, created_at, analysis_markdown FROM articles WHERE id = ?1",
        params![id],
        |row| {
            Ok(ArticleDetail {
                id: row.get(0)?,
                title: row.get(1)?,
                source_url: row.get(2)?,
                origin: row.get(3)?,
                content: row.get(4)?,
                created_at: row.get(5)?,
                analysis_markdown: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_article(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM articles WHERE id = ?1", params![id])
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

#[tauri::command]
pub fn db_add_saved_sentence(
    text: String,
    zh: String,
    note: String,
    article_id: Option<i64>,
    article_title: String,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "INSERT INTO saved_sentences (text, zh, note, article_id, article_title) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![text, zh, note, article_id, article_title],
    )
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn db_get_saved_sentences(conn: State<'_, AppState>) -> Result<Vec<SavedSentence>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db
        .prepare(
            "SELECT id, text, zh, note, article_id, article_title, created_at
             FROM saved_sentences ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SavedSentence {
                id: row.get(0)?,
                text: row.get(1)?,
                zh: row.get(2)?,
                note: row.get(3)?,
                article_id: row.get(4)?,
                article_title: row.get(5)?,
                created_at: row.get(6)?,
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
pub fn db_delete_saved_sentence(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM saved_sentences WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
