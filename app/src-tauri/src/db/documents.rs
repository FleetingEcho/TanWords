use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::db;

#[derive(Serialize)]
pub struct DocumentListItem {
    pub id: i64,
    pub title: String,
    pub tags: String,
    pub pinned: bool,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub content_text: String,
}

#[derive(Serialize)]
pub struct DocumentDetail {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub content_text: String,
    pub tags: String,
    pub pinned: bool,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct DocumentListResult {
    pub items: Vec<DocumentListItem>,
    pub total: i64,
}

fn build_doc_where(
    search: &Option<String>,
    date_from: &Option<String>,
    date_to: &Option<String>,
    tag: &Option<String>,
) -> (String, Vec<String>) {
    let mut conditions = vec!["1=1".to_string()];
    let mut params: Vec<String> = vec![];

    if let Some(q) = search {
        let q = q.trim();
        if !q.is_empty() {
            // Ordered-character fuzzy match: "btmk" matches "bitmask".
            // Escaping keeps LIKE metacharacters literal.
            let fuzzy = q.to_lowercase().chars().fold(String::from("%"), |mut out, ch| {
                if matches!(ch, '%' | '_' | '\\') { out.push('\\'); }
                out.push(ch);
                out.push('%');
                out
            });
            conditions.push(format!(
                "(LOWER(d.title) LIKE ?{} ESCAPE '\\' OR LOWER(d.content_text) LIKE ?{} ESCAPE '\\')",
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
    (conditions.join(" AND "), params)
}

#[tauri::command]
pub fn db_create_document(conn: State<'_, AppState>) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "INSERT INTO documents (title, content, content_text, tags) VALUES ('Untitled', '{}', '', '[]')",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn db_document_title_exists(title: String, conn: State<'_, AppState>) -> Result<bool, String> {
    let db = db::lock_db(&conn)?;
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM documents WHERE LOWER(title) = LOWER(?1))",
        [title],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_documents(
    search: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    tag: Option<String>,
    sort: Option<String>,
    page: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<DocumentListResult, String> {
    let db = db::lock_db(&conn)?;

    let page_size = 20i64;
    let offset = page.unwrap_or(0) * page_size;
    let sort_col = match sort.as_deref() {
        Some("created") => "d.created_at DESC",
        Some("title")   => "d.title ASC",
        _               => "d.updated_at DESC",
    };

    let (where_clause, p) = build_doc_where(&search, &date_from, &date_to, &tag);

    let total: i64 = db.query_row(
        &format!("SELECT COUNT(*) FROM documents d WHERE {}", where_clause),
        rusqlite::params_from_iter(p.iter()),
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    let data_sql = format!(
        "SELECT d.id, d.title, d.tags, d.pinned, d.word_count, d.created_at, d.updated_at, d.content_text
         FROM documents d WHERE {} ORDER BY d.pinned DESC, {} LIMIT {} OFFSET {}",
        where_clause, sort_col, page_size, offset
    );
    let mut stmt = db.prepare(&data_sql).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params_from_iter(p.iter()), |row| {
        Ok(DocumentListItem {
            id: row.get(0)?,
            title: row.get(1)?,
            tags: row.get(2)?,
            pinned: row.get::<_, i64>(3)? != 0,
            word_count: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            content_text: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(DocumentListResult { items, total })
}

#[tauri::command]
pub fn db_get_document(id: i64, conn: State<'_, AppState>) -> Result<DocumentDetail, String> {
    let db = db::lock_db(&conn)?;
    db.query_row(
        "SELECT id, title, content, content_text, tags, pinned, word_count, created_at, updated_at
         FROM documents WHERE id = ?1",
        params![id],
        |row| Ok(DocumentDetail {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            content_text: row.get(3)?,
            tags: row.get(4)?,
            pinned: row.get::<_, i64>(5)? != 0,
            word_count: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_document(
    id: i64,
    title: String,
    content: String,
    content_text: String,
    tags: String,
    pinned: bool,
    word_count: i64,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "UPDATE documents SET title=?1, content=?2, content_text=?3, tags=?4, pinned=?5,
         word_count=?6, updated_at=datetime('now') WHERE id=?7",
        params![title, content, content_text, tags, pinned as i64, word_count, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_document(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::lock_db(&conn)?;
    db.execute("DELETE FROM documents WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_duplicate_document(id: i64, conn: State<'_, AppState>) -> Result<i64, String> {
    let db = db::lock_db(&conn)?;
    db.execute(
        "INSERT INTO documents (title, content, content_text, tags, word_count)
         SELECT title || ' (copy)', content, content_text, tags, word_count
         FROM documents WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn db_get_all_tags(conn: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = db::lock_db(&conn)?;
    let mut stmt = db.prepare(
        "SELECT DISTINCT value FROM documents, json_each(documents.tags) ORDER BY value"
    ).map_err(|e| e.to_string())?;
    let tags = stmt.query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(tags)
}
