use libsql::params;
use tauri::State;

use crate::db;
use crate::AppState;

#[tauri::command]
pub async fn db_save_article_analysis(
    title: String,
    source_url: String,
    origin: String,
    content: String,
    analysis_markdown: String,
    hn_item_id: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::conn(&conn)?;

    db.execute(
        "INSERT INTO articles (title, source_url, origin, content, analysis_markdown, hn_item_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![title, source_url, origin, content, analysis_markdown, hn_item_id],
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub async fn db_add_known_words(
    words: Vec<String>,
    source: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    for word in &words {
        tx.execute(
            "INSERT OR IGNORE INTO user_known_words (word, source) VALUES (?1, ?2)",
            params![word.to_lowercase(), source.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_get_known_words(conn: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT word FROM user_known_words ORDER BY created_at DESC",
        (),
        |row| row.get::<String>(0),
    )
    .await
}
