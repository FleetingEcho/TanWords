use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::db;

#[derive(Serialize, Clone)]
pub struct ChatSessionItem {
    pub id: String,
    pub title: String,
    pub preset_id: String,
    pub provider_id: String,
    pub message_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct ChatSessionDetail {
    pub id: String,
    pub title: String,
    pub messages: String,
    pub system_prompt: String,
    pub preset_id: String,
    pub provider_id: String,
    pub message_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

fn map_item(row: &rusqlite::Row) -> rusqlite::Result<ChatSessionItem> {
    Ok(ChatSessionItem {
        id: row.get(0)?,
        title: row.get(1)?,
        preset_id: row.get(2)?,
        provider_id: row.get(3)?,
        message_count: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn db_list_chat_sessions(
    page: Option<i64>,
    limit: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<Vec<ChatSessionItem>, String> {
    let db = db::lock_db(&conn)?;
    let lim = limit.unwrap_or(100);
    let offset = page.unwrap_or(0) * lim;

    let mut stmt = db.prepare(
        "SELECT id, title, preset_id, provider_id, message_count, created_at, updated_at
         FROM ai_chat_sessions
         ORDER BY updated_at DESC
         LIMIT ?1 OFFSET ?2",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![lim, offset], map_item)
        .map_err(|e| e.to_string())?;

    let mut result = vec![];
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn db_get_chat_session(
    id: String,
    conn: State<'_, AppState>,
) -> Result<Option<ChatSessionDetail>, String> {
    let db = db::lock_db(&conn)?;
    let result = db.query_row(
        "SELECT id, title, messages, system_prompt, preset_id, provider_id, message_count, created_at, updated_at
         FROM ai_chat_sessions WHERE id = ?1",
        params![id],
        |row| {
            Ok(ChatSessionDetail {
                id: row.get(0)?,
                title: row.get(1)?,
                messages: row.get(2)?,
                system_prompt: row.get(3)?,
                preset_id: row.get(4)?,
                provider_id: row.get(5)?,
                message_count: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    ).ok();
    Ok(result)
}

#[tauri::command]
pub fn db_upsert_chat_session(
    id: String,
    title: String,
    messages: String,
    system_prompt: String,
    preset_id: String,
    provider_id: String,
    message_count: i64,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "INSERT INTO ai_chat_sessions
             (id, title, messages, system_prompt, preset_id, provider_id, message_count, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             title         = excluded.title,
             messages      = excluded.messages,
             system_prompt = excluded.system_prompt,
             preset_id     = excluded.preset_id,
             provider_id   = excluded.provider_id,
             message_count = excluded.message_count,
             updated_at    = excluded.updated_at",
        params![id, title, messages, system_prompt, preset_id, provider_id, message_count],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_chat_session(
    id: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM ai_chat_sessions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_search_chat_sessions(
    query: String,
    conn: State<'_, AppState>,
) -> Result<Vec<ChatSessionItem>, String> {
    let db = db::lock_db(&conn)?;
    let like_pat = format!("%{}%", query);

    let mut stmt = db.prepare(
        "SELECT id, title, preset_id, provider_id, message_count, created_at, updated_at
         FROM ai_chat_sessions
         WHERE title LIKE ?1
         ORDER BY updated_at DESC
         LIMIT 50",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![like_pat], map_item)
        .map_err(|e| e.to_string())?;

    let mut result = vec![];
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
