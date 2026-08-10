use libsql::params;
use crate::shim::State;

use super::types::{DocumentDetail, DocumentListItem, DocumentListResult};
use crate::db;
use crate::document_privacy::{self, decrypt_text, encrypt_text};
use crate::AppState;

/// The closed set of document lifecycle statuses. Empty string is "None".
/// Kept as a match here and mirror-matched as `DocStatus` in useDB.types.ts:
/// a free-text status becomes an un-filterable mess within a week.
pub const STATUS_VALUES: [&str; 4] = ["active", "onhold", "completed", "dropped"];

/// Validates a status before a write. Rejects anything outside the closed set
/// so the filter and the list never have to sanitise free text.
fn normalize_status(status: &str) -> Result<String, String> {
    let status = status.trim();
    if status.is_empty() {
        return Ok(String::new());
    }
    if STATUS_VALUES.contains(&status) {
        return Ok(status.to_string());
    }
    Err(format!("invalid document status: {status:?}"))
}

pub(super) fn build_doc_where(
    search: &Option<String>,
    date_from: &Option<String>,
    date_to: &Option<String>,
    tag: &Option<String>,
    status: &Option<String>,
) -> (String, Vec<String>) {
    let mut conditions = vec!["1=1".to_string()];
    let mut params: Vec<String> = vec![];

    if let Some(q) = search {
        let q = q.trim();
        if !q.is_empty() {
            // Ordered-character fuzzy match: "btmk" matches "bitmask".
            // Escaping keeps LIKE metacharacters literal.
            let fuzzy = q
                .to_lowercase()
                .chars()
                .fold(String::from("%"), |mut out, ch| {
                    if matches!(ch, '%' | '_' | '\\') {
                        out.push('\\');
                    }
                    out.push(ch);
                    out.push('%');
                    out
                });
            conditions.push(format!(
                "(LOWER(d.title) LIKE ?{} ESCAPE '\\' OR (d.protected=0 AND LOWER(d.content_text) LIKE ?{} ESCAPE '\\'))",
                params.len() + 1,
                params.len() + 2
            ));
            params.push(fuzzy.clone());
            params.push(fuzzy);
        }
    }
    if let Some(from) = date_from {
        conditions.push(format!("d.created_at >= ?{}", params.len() + 1));
        params.push(from.clone());
    }
    if let Some(to) = date_to {
        conditions.push(format!("d.created_at <= ?{}", params.len() + 1));
        params.push(format!("{} 23:59:59", to));
    }
    if let Some(t) = tag {
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value = ?{})",
            params.len() + 1
        ));
        params.push(t.clone());
    }
    if let Some(s) = status {
        conditions.push(format!("d.status = ?{}", params.len() + 1));
        params.push(s.clone());
    }
    (conditions.join(" AND "), params)
}

#[crate::shim::command]
pub async fn db_create_document(conn: State<'_, AppState>) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    db.execute(
        "INSERT INTO documents (title, content, content_text, tags) VALUES ('Untitled', '{}', '', '[]')",
        (),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[crate::shim::command]
pub async fn db_create_document_with_content(
    title: String,
    content: String,
    content_text: String,
    tags: String,
    word_count: i64,
    folder: Option<String>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    let folder = super::folders::normalize_folder(folder.as_deref().unwrap_or(""))?;
    let (task_total, task_done) = super::tasks::count_tasks(&content);
    db.execute(
        "INSERT INTO documents (title,content,content_text,tags,pinned,word_count,folder,task_total,task_done) VALUES (?1,?2,?3,?4,0,?5,?6,?7,?8)",
        params![title, content, content_text, tags, word_count, folder.clone(), task_total, task_done],
    )
    .await
    .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    // Importing into a folder is also how that folder comes into existence, so
    // record it — otherwise deleting the last document would drop the folder.
    if !folder.is_empty() {
        super::folders::ensure_folder_chain(&db, &folder).await?;
        crate::document_privacy::protect_if_folder_locked(
            &db,
            &conn.document_privacy,
            id,
            &folder,
        )
        .await?;
    }
    Ok(id)
}

#[crate::shim::command]
pub async fn db_document_title_exists(
    title: String,
    conn: State<'_, AppState>,
) -> Result<bool, String> {
    let db = db::conn(&conn)?;
    Ok(db::scalar_i64(
        &db,
        "SELECT EXISTS(SELECT 1 FROM documents WHERE LOWER(title) = LOWER(?1))",
        [title],
    )
    .await?
        != 0)
}

#[crate::shim::command]
pub async fn db_get_documents(
    search: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    tag: Option<String>,
    sort: Option<String>,
    page: Option<i64>,
    status: Option<String>,
    conn: State<'_, AppState>,
) -> Result<DocumentListResult, String> {
    let db = db::conn(&conn)?;

    // Both privacy shelves must be present together so each can be collapsed
    // independently; document lists are intentionally fetched as one page.
    let page_size = 10_000i64;
    let offset = page.unwrap_or(0) * page_size;
    let sort_col = match sort.as_deref() {
        Some("created") => "d.created_at DESC",
        Some("title") => "d.title ASC",
        _ => "d.updated_at DESC",
    };

    let (where_clause, p) = build_doc_where(&search, &date_from, &date_to, &tag, &status);

    let total = db::scalar_i64(
        &db,
        &format!("SELECT COUNT(*) FROM documents d WHERE {}", where_clause),
        p.clone(),
    )
    .await?;

    let data_sql = format!(
        "SELECT d.id, d.title, d.tags, d.pinned, d.word_count, d.created_at, d.updated_at,
                CASE WHEN d.protected=1 THEN '' ELSE d.content_text END, d.protected, d.folder, d.task_total, d.task_done, d.status
         FROM documents d WHERE {} ORDER BY d.protected ASC, d.pinned DESC, {} LIMIT {} OFFSET {}",
        where_clause, sort_col, page_size, offset
    );
    let items = db::fetch_all(&db, &data_sql, p, |row| {
        let id = row.get::<i64>(0)?;
        let protected = row.get::<i64>(8)? != 0;
        Ok(DocumentListItem {
            id,
            title: row.get(1)?,
            tags: row.get(2)?,
            pinned: row.get::<i64>(3)? != 0,
            word_count: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            content_text: row.get(7)?,
            protected,
            unlocked: protected && conn.document_privacy.is_unlocked(id),
            folder: row.get(9)?,
            task_total: row.get(10)?,
            task_done: row.get(11)?,
            status: row.get(12)?,
        })
    })
    .await?;

    Ok(DocumentListResult { items, total })
}

#[crate::shim::command]
pub async fn db_get_document(id: i64, conn: State<'_, AppState>) -> Result<DocumentDetail, String> {
    let db = db::conn(&conn)?;
    let row = db::fetch_one(
        &db,
        "SELECT id, title, content, content_text, tags, pinned, word_count, created_at, updated_at, protected, folder, status
         FROM documents WHERE id = ?1",
        params![id],
        |row| Ok((
            row.get::<i64>(0)?, row.get::<String>(1)?, row.get::<String>(2)?,
            row.get::<String>(3)?, row.get::<String>(4)?, row.get::<i64>(5)? != 0,
            row.get::<i64>(6)?, row.get::<String>(7)?, row.get::<String>(8)?,
            row.get::<i64>(9)? != 0, row.get::<String>(10)?, row.get::<String>(11)?,
        )),
    ).await?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, id).await?;
    let (content, content_text) = match key {
        Some(key) => (decrypt_text(&key, &row.2)?, decrypt_text(&key, &row.3)?),
        None => (row.2, row.3),
    };
    Ok(DocumentDetail {
        id: row.0,
        title: row.1,
        content,
        content_text,
        tags: row.4,
        pinned: row.5,
        word_count: row.6,
        created_at: row.7,
        updated_at: row.8,
        protected: row.9,
        folder: row.10,
        status: row.11,
    })
}

#[crate::shim::command]
pub async fn db_update_document(
    id: i64,
    title: String,
    content: String,
    content_text: String,
    tags: String,
    pinned: bool,
    word_count: i64,
    status: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let status = normalize_status(&status)?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, id).await?;
    // Count from the *plaintext* we were handed; a protected doc's stored copy
    // is ciphertext and can't be walked, so the count must be taken before
    // encryption. The caller only reaches here unlocked, so it has the text.
    let (task_total, task_done) = super::tasks::count_tasks(&content);
    let (content, content_text) = match key {
        Some(key) => (
            encrypt_text(&key, &content)?,
            encrypt_text(&key, &content_text)?,
        ),
        None => (content, content_text),
    };
    db.execute(
        "UPDATE documents SET title=?1, content=?2, content_text=?3, tags=?4, pinned=?5,
         word_count=?6, updated_at=datetime('now'), task_total=?7, task_done=?8, status=?9 WHERE id=?10",
        params![
            title,
            content,
            content_text,
            tags,
            pinned as i64,
            word_count,
            task_total,
            task_done,
            status,
            id
        ],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_delete_document(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    document_privacy::require_key(&db, &conn.document_privacy, id).await?;
    db.execute(
        "DELETE FROM document_assets WHERE document_id = ?1",
        params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM documents WHERE id = ?1", params![id])
        .await
        .map_err(|e| e.to_string())?;
    conn.document_privacy.lock(id)?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_get_all_tags(conn: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT DISTINCT value FROM documents, json_each(documents.tags) ORDER BY value",
        (),
        |row| row.get::<String>(0),
    )
    .await
}
