use crate::db::params; use crate::db::Value;
use serde::Serialize;
use crate::shim::State;

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
    pub archived: bool,
    pub pinned: bool,
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

fn map_item(row: &crate::db::Row) -> crate::db::DbResult<ChatSessionItem> {
    Ok(ChatSessionItem {
        id: row.get(0)?,
        title: row.get(1)?,
        preset_id: row.get(2)?,
        provider_id: row.get(3)?,
        message_count: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        archived: row.get::<i64>(7)? != 0,
        pinned: row.get::<i64>(8)? != 0,
    })
}

/// Lists conversations, newest first. `archived` selects which shelf to read
/// (None = both); `date_from`/`date_to` filter on last activity, as `YYYY-MM-DD`
/// — `date_to` is treated as inclusive of that whole day.
#[crate::shim::command]
pub async fn db_list_chat_sessions(
    page: Option<i64>,
    limit: Option<i64>,
    archived: Option<bool>,
    date_from: Option<String>,
    date_to: Option<String>,
    conn: State<'_, AppState>,
) -> Result<Vec<ChatSessionItem>, String> {
    let db = db::conn(&conn)?;
    let lim = limit.unwrap_or(100);
    let offset = page.unwrap_or(0) * lim;

    let mut sql = String::from(
        "SELECT id, title, preset_id, provider_id, message_count, created_at, updated_at, archived, pinned
         FROM ai_chat_sessions
         WHERE 1=1",
    );
    let mut values: Vec<Value> = vec![];

    if let Some(flag) = archived {
        sql.push_str(&format!(" AND archived = ?{}", values.len() + 1));
        values.push(Value::from(if flag { 1i64 } else { 0i64 }));
    }
    if let Some(from) = date_from {
        sql.push_str(&format!(" AND updated_at >= ?{}", values.len() + 1));
        values.push(Value::from(from));
    }
    if let Some(to) = date_to {
        sql.push_str(&format!(" AND updated_at < date(?{}, '+1 day')", values.len() + 1));
        values.push(Value::from(to));
    }
    sql.push_str(&format!(
        " ORDER BY pinned DESC, updated_at DESC LIMIT ?{} OFFSET ?{}",
        values.len() + 1,
        values.len() + 2
    ));
    values.push(Value::from(lim));
    values.push(Value::from(offset));

    db::fetch_all(&db, &sql, values, map_item).await
}

#[crate::shim::command]
pub async fn db_set_chat_session_archived(
    id: String,
    archived: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE ai_chat_sessions SET archived = ?2 WHERE id = ?1",
        params![id, if archived { 1i64 } else { 0i64 }],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_set_chat_session_pinned(
    id: String,
    pinned: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE ai_chat_sessions SET pinned = ?2 WHERE id = ?1",
        params![id, if pinned { 1i64 } else { 0i64 }],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Renames without touching `updated_at` — a rename is bookkeeping, not
/// activity, and must not bump the conversation to the top of the list.
#[crate::shim::command]
pub async fn db_rename_chat_session(
    id: String,
    title: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Title cannot be empty".into());
    }
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE ai_chat_sessions SET title = ?2 WHERE id = ?1",
        params![id, title],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_get_chat_session(
    id: String,
    conn: State<'_, AppState>,
) -> Result<Option<ChatSessionDetail>, String> {
    let db = db::conn(&conn)?;
    let result = db::fetch_optional(
        &db,
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
    )
    .await?;
    // NOT `.unwrap_or(None)`: fetch_optional already returns Ok(None) for a
    // missing row; squashing real errors into None made callers treat an
    // existing session as new and overwrite its messages on the next upsert.
    Ok(result)
}

#[crate::shim::command]
pub async fn db_upsert_chat_session(
    id: String,
    title: String,
    messages: String,
    system_prompt: String,
    preset_id: String,
    provider_id: String,
    message_count: i64,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
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
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_delete_chat_session(
    id: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute("DELETE FROM ai_chat_sessions WHERE id = ?1", params![id])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_search_chat_sessions(
    query: String,
    conn: State<'_, AppState>,
) -> Result<Vec<ChatSessionItem>, String> {
    let db = db::conn(&conn)?;
    let like_pat = format!("%{}%", query);

    db::fetch_all(
        &db,
        "SELECT id, title, preset_id, provider_id, message_count, created_at, updated_at, archived, pinned
         FROM ai_chat_sessions
         WHERE title LIKE ?1
         ORDER BY pinned DESC, updated_at DESC
         LIMIT 50",
        params![like_pat],
        map_item,
    )
    .await
}
