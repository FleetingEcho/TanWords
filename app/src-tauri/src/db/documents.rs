use libsql::params;
use serde::Serialize;
use tauri::State;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::io::Write;

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

#[derive(Serialize)]
pub struct DocumentAsset {
    pub id: String,
    pub document_id: i64,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub data_base64: String,
}

#[derive(Serialize)]
pub struct DocumentAssetSummary {
    pub id: String,
    pub document_id: i64,
    pub document_title: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub created_at: String,
    pub referenced: bool,
}

#[derive(Serialize)]
pub struct DocumentLinkItem {
    pub id: i64,
    pub title: String,
}

#[derive(Serialize)]
pub struct DocumentLinkContext {
    pub outgoing: Vec<DocumentLinkItem>,
    pub backlinks: Vec<DocumentLinkItem>,
    pub candidates: Vec<DocumentLinkItem>,
}

#[tauri::command]
pub async fn db_get_document_link_context(
    document_id: i64,
    conn: State<'_, AppState>,
) -> Result<DocumentLinkContext, String> {
    let database = db::conn(&conn)?;
    let candidates = db::fetch_all(
        &database,
        "SELECT id, title FROM documents WHERE id != ?1 ORDER BY title COLLATE NOCASE",
        params![document_id],
        |row| Ok(DocumentLinkItem { id: row.get(0)?, title: row.get(1)? }),
    ).await?;
    let content = db::fetch_one(
        &database,
        "SELECT content FROM documents WHERE id = ?1",
        params![document_id],
        |row| row.get::<String>(0),
    ).await?;
    let outgoing = candidates.iter()
        .filter(|item| content.contains(&format!("tanwords-doc://{}", item.id)))
        .map(|item| DocumentLinkItem { id: item.id, title: item.title.clone() })
        .collect();
    let backlinks = db::fetch_all(
        &database,
        "SELECT id, title FROM documents
         WHERE id != ?1 AND instr(content, 'tanwords-doc://' || ?1) > 0
         ORDER BY title COLLATE NOCASE",
        params![document_id],
        |row| Ok(DocumentLinkItem { id: row.get(0)?, title: row.get(1)? }),
    ).await?;
    Ok(DocumentLinkContext { outgoing, backlinks, candidates })
}

const MAX_DOCUMENT_ASSET_BYTES: usize = 100 * 1024 * 1024;

#[tauri::command]
pub async fn db_create_document_asset(
    document_id: i64,
    file_name: String,
    mime_type: String,
    data_base64: String,
    conn: State<'_, AppState>,
) -> Result<String, String> {
    let data = STANDARD.decode(data_base64).map_err(|_| "Invalid attachment data")?;
    if data.is_empty() || data.len() > MAX_DOCUMENT_ASSET_BYTES {
        return Err("Attachment must be between 1 byte and 100 MB".into());
    }
    let db = db::conn(&conn)?;
    let exists = db::scalar_i64(
        &db,
        "SELECT EXISTS(SELECT 1 FROM documents WHERE id = ?1)",
        params![document_id],
    ).await?;
    if exists == 0 {
        return Err("Document does not exist".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let size = data.len() as i64;
    db.execute(
        "INSERT INTO document_assets (id, document_id, file_name, mime_type, data, size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id.clone(), document_id, file_name, mime_type, data, size],
    ).await.map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn db_get_document_asset(id: String, conn: State<'_, AppState>) -> Result<DocumentAsset, String> {
    let db = db::conn(&conn)?;
    db::fetch_one(
        &db,
        "SELECT id, document_id, file_name, mime_type, size, data FROM document_assets WHERE id = ?1",
        params![id],
        |row| {
            let data: Vec<u8> = row.get(5)?;
            Ok(DocumentAsset {
                id: row.get(0)?,
                document_id: row.get(1)?,
                file_name: row.get(2)?,
                mime_type: row.get(3)?,
                size: row.get(4)?,
                data_base64: STANDARD.encode(data),
            })
        },
    ).await
}

#[tauri::command]
pub async fn db_get_document_assets(document_id: i64, conn: State<'_, AppState>) -> Result<Vec<DocumentAsset>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT id, document_id, file_name, mime_type, size, data
         FROM document_assets WHERE document_id = ?1 ORDER BY created_at",
        params![document_id],
        |row| {
            let data: Vec<u8> = row.get(5)?;
            Ok(DocumentAsset {
                id: row.get(0)?,
                document_id: row.get(1)?,
                file_name: row.get(2)?,
                mime_type: row.get(3)?,
                size: row.get(4)?,
                data_base64: STANDARD.encode(data),
            })
        },
    ).await
}

#[tauri::command]
pub async fn db_list_document_assets(conn: State<'_, AppState>) -> Result<Vec<DocumentAssetSummary>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT a.id, a.document_id, d.title, a.file_name, a.mime_type, a.size, a.created_at,
                CASE WHEN instr(d.content, 'tanwords-asset://' || a.id) > 0 THEN 1 ELSE 0 END
         FROM document_assets a
         JOIN documents d ON d.id = a.document_id
         ORDER BY a.created_at DESC",
        (),
        |row| Ok(DocumentAssetSummary {
            id: row.get(0)?,
            document_id: row.get(1)?,
            document_title: row.get(2)?,
            file_name: row.get(3)?,
            mime_type: row.get(4)?,
            size: row.get(5)?,
            created_at: row.get(6)?,
            referenced: row.get::<i64>(7)? != 0,
        }),
    ).await
}

fn remove_asset_blocks(value: &mut serde_json::Value, url: &str) {
    match value {
        serde_json::Value::Array(items) => {
            items.retain(|item| item.pointer("/props/url").and_then(|v| v.as_str()) != Some(url));
            for item in items {
                remove_asset_blocks(item, url);
            }
        }
        serde_json::Value::Object(map) => {
            for child in map.values_mut() {
                remove_asset_blocks(child, url);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn db_delete_document_asset(id: String, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let document_id = db::fetch_one(
        &db,
        "SELECT document_id FROM document_assets WHERE id = ?1",
        params![id.clone()],
        |row| row.get::<i64>(0),
    ).await?;
    let content = db::fetch_one(
        &db,
        "SELECT content FROM documents WHERE id = ?1",
        params![document_id],
        |row| row.get::<String>(0),
    ).await?;
    if let Ok(mut blocks) = serde_json::from_str::<serde_json::Value>(&content) {
        remove_asset_blocks(&mut blocks, &format!("tanwords-asset://{id}"));
        let updated = serde_json::to_string(&blocks).map_err(|e| e.to_string())?;
        db.execute(
            "UPDATE documents SET content = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![updated, document_id],
        ).await.map_err(|e| e.to_string())?;
    }
    db.execute("DELETE FROM document_assets WHERE id = ?1", params![id])
        .await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_orphan_document_assets(conn: State<'_, AppState>) -> Result<u64, String> {
    let db = db::conn(&conn)?;
    db.execute(
        "DELETE FROM document_assets
         WHERE NOT EXISTS (
             SELECT 1 FROM documents d
             WHERE d.id = document_assets.document_id
               AND instr(d.content, 'tanwords-asset://' || document_assets.id) > 0
         )",
        (),
    ).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_export_document_asset(
    id: String,
    destination: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let path = std::path::Path::new(&destination);
    if !path.is_absolute() {
        return Err("Export destination must be an absolute path".into());
    }
    let db = db::conn(&conn)?;
    let data = db::fetch_one(
        &db,
        "SELECT data FROM document_assets WHERE id = ?1",
        params![id],
        |row| row.get::<Vec<u8>>(0),
    ).await?;
    std::fs::write(path, data).map_err(|e| format!("Failed to export image: {e}"))
}

fn safe_export_name(name: &str, id: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':') { '_' } else { c })
        .collect();
    if cleaned.trim().is_empty() { format!("image-{id}.png") } else { cleaned }
}

async fn export_asset_rows(
    database: &libsql::Connection,
    ids: &[String],
) -> Result<Vec<(String, String, Vec<u8>)>, String> {
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        let row = db::fetch_one(
            database,
            "SELECT file_name, data FROM document_assets WHERE id = ?1",
            params![id.clone()],
            |row| Ok((row.get::<String>(0)?, row.get::<Vec<u8>>(1)?)),
        ).await?;
        rows.push((id.clone(), row.0, row.1));
    }
    Ok(rows)
}

fn unique_export_path(
    directory: &std::path::Path,
    file_name: &str,
    used: &mut std::collections::HashSet<String>,
) -> std::path::PathBuf {
    let path = std::path::Path::new(file_name);
    let stem = path.file_stem().and_then(|v| v.to_str()).unwrap_or("image");
    let extension = path.extension().and_then(|v| v.to_str()).unwrap_or("");
    for index in 1.. {
        let candidate = if index == 1 {
            file_name.to_string()
        } else if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        if used.insert(candidate.clone()) && !directory.join(&candidate).exists() {
            return directory.join(candidate);
        }
    }
    unreachable!()
}

#[tauri::command]
pub async fn db_export_document_assets_to_folder(
    ids: Vec<String>,
    destination: String,
    conn: State<'_, AppState>,
) -> Result<u64, String> {
    let directory = std::path::Path::new(&destination);
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("Export destination must be an existing absolute directory".into());
    }
    let database = db::conn(&conn)?;
    let rows = export_asset_rows(&database, &ids).await?;
    let mut used = std::collections::HashSet::new();
    for (id, file_name, data) in &rows {
        let base = safe_export_name(file_name, id);
        let path = unique_export_path(directory, &base, &mut used);
        std::fs::write(path, data).map_err(|e| format!("Failed to export image: {e}"))?;
    }
    Ok(rows.len() as u64)
}

#[tauri::command]
pub async fn db_export_document_assets_zip(
    ids: Vec<String>,
    destination: String,
    conn: State<'_, AppState>,
) -> Result<u64, String> {
    let path = std::path::Path::new(&destination);
    if !path.is_absolute() {
        return Err("Export destination must be an absolute path".into());
    }
    let database = db::conn(&conn)?;
    let rows = export_asset_rows(&database, &ids).await?;
    let file = std::fs::File::create(path).map_err(|e| format!("Failed to create ZIP: {e}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut used = std::collections::HashSet::new();
    for (id, file_name, data) in &rows {
        let base = safe_export_name(file_name, id);
        let unique = unique_export_path(std::path::Path::new(""), &base, &mut used);
        archive.start_file(unique.to_string_lossy(), options)
            .map_err(|e| format!("Failed to write ZIP: {e}"))?;
        archive.write_all(data).map_err(|e| format!("Failed to write ZIP: {e}"))?;
    }
    archive.finish().map_err(|e| format!("Failed to finish ZIP: {e}"))?;
    Ok(rows.len() as u64)
}

#[tauri::command]
pub async fn db_prune_document_assets(
    document_id: i64,
    referenced_ids: Vec<String>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let assets = db::fetch_all(
        &db,
        "SELECT id FROM document_assets WHERE document_id = ?1",
        params![document_id],
        |row| row.get::<String>(0),
    ).await?;
    for id in assets {
        if !referenced_ids.contains(&id) {
            db.execute("DELETE FROM document_assets WHERE id = ?1", params![id])
                .await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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

#[tauri::command]
pub async fn db_create_document_with_content(
    title: String,
    content: String,
    content_text: String,
    tags: String,
    word_count: i64,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    db.execute(
        "INSERT INTO documents (title,content,content_text,tags,pinned,word_count) VALUES (?1,?2,?3,?4,0,?5)",
        params![title, content, content_text, tags, word_count],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub async fn db_document_title_exists(title: String, conn: State<'_, AppState>) -> Result<bool, String> {
    let db = db::conn(&conn)?;
    Ok(db::scalar_i64(
        &db,
        "SELECT EXISTS(SELECT 1 FROM documents WHERE LOWER(title) = LOWER(?1))",
        [title],
    )
    .await?
        != 0)
}

#[tauri::command]
pub async fn db_get_documents(
    search: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    tag: Option<String>,
    sort: Option<String>,
    page: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<DocumentListResult, String> {
    let db = db::conn(&conn)?;

    let page_size = 20i64;
    let offset = page.unwrap_or(0) * page_size;
    let sort_col = match sort.as_deref() {
        Some("created") => "d.created_at DESC",
        Some("title")   => "d.title ASC",
        _               => "d.updated_at DESC",
    };

    let (where_clause, p) = build_doc_where(&search, &date_from, &date_to, &tag);

    let total = db::scalar_i64(
        &db,
        &format!("SELECT COUNT(*) FROM documents d WHERE {}", where_clause),
        p.clone(),
    )
    .await?;

    let data_sql = format!(
        "SELECT d.id, d.title, d.tags, d.pinned, d.word_count, d.created_at, d.updated_at, d.content_text
         FROM documents d WHERE {} ORDER BY d.pinned DESC, {} LIMIT {} OFFSET {}",
        where_clause, sort_col, page_size, offset
    );
    let items = db::fetch_all(&db, &data_sql, p, |row| {
        Ok(DocumentListItem {
            id: row.get(0)?,
            title: row.get(1)?,
            tags: row.get(2)?,
            pinned: row.get::<i64>(3)? != 0,
            word_count: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            content_text: row.get(7)?,
        })
    })
    .await?;

    Ok(DocumentListResult { items, total })
}

#[tauri::command]
pub async fn db_get_document(id: i64, conn: State<'_, AppState>) -> Result<DocumentDetail, String> {
    let db = db::conn(&conn)?;
    db::fetch_one(
        &db,
        "SELECT id, title, content, content_text, tags, pinned, word_count, created_at, updated_at
         FROM documents WHERE id = ?1",
        params![id],
        |row| {
            Ok(DocumentDetail {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                content_text: row.get(3)?,
                tags: row.get(4)?,
                pinned: row.get::<i64>(5)? != 0,
                word_count: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .await
}

#[tauri::command]
pub async fn db_update_document(
    id: i64,
    title: String,
    content: String,
    content_text: String,
    tags: String,
    pinned: bool,
    word_count: i64,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE documents SET title=?1, content=?2, content_text=?3, tags=?4, pinned=?5,
         word_count=?6, updated_at=datetime('now') WHERE id=?7",
        params![title, content, content_text, tags, pinned as i64, word_count, id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_document(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute("DELETE FROM document_assets WHERE document_id = ?1", params![id])
        .await.map_err(|e| e.to_string())?;
    db.execute("DELETE FROM documents WHERE id = ?1", params![id])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_duplicate_document(id: i64, conn: State<'_, AppState>) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    db.execute(
        "INSERT INTO documents (title, content, content_text, tags, word_count)
         SELECT title || ' (copy)', content, content_text, tags, word_count
         FROM documents WHERE id = ?1",
        params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    let new_document_id = db.last_insert_rowid();
    let mut content = db::fetch_one(
        &db,
        "SELECT content FROM documents WHERE id = ?1",
        params![new_document_id],
        |row| row.get::<String>(0),
    ).await?;
    let assets = db::fetch_all(
        &db,
        "SELECT id, file_name, mime_type, data, size FROM document_assets WHERE document_id = ?1",
        params![id],
        |row| Ok((
            row.get::<String>(0)?,
            row.get::<String>(1)?,
            row.get::<String>(2)?,
            row.get::<Vec<u8>>(3)?,
            row.get::<i64>(4)?,
        )),
    ).await?;
    for (old_id, file_name, mime_type, data, size) in assets {
        let new_id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO document_assets (id, document_id, file_name, mime_type, data, size)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id.clone(), new_document_id, file_name, mime_type, data, size],
        ).await.map_err(|e| e.to_string())?;
        content = content.replace(
            &format!("tanwords-asset://{old_id}"),
            &format!("tanwords-asset://{new_id}"),
        );
    }
    db.execute(
        "UPDATE documents SET content = ?1 WHERE id = ?2",
        params![content, new_document_id],
    ).await.map_err(|e| e.to_string())?;
    Ok(new_document_id)
}

#[tauri::command]
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

#[cfg(test)]
mod tests {
    use super::remove_asset_blocks;

    #[test]
    fn deleting_an_asset_removes_nested_image_blocks_only() {
        let mut content = serde_json::json!([
            { "type": "paragraph", "content": "keep" },
            { "type": "image", "props": { "url": "tanwords-asset://remove" } },
            {
                "type": "bulletListItem",
                "children": [
                    { "type": "image", "props": { "url": "tanwords-asset://remove" } },
                    { "type": "image", "props": { "url": "https://example.com/keep.png" } }
                ]
            }
        ]);
        remove_asset_blocks(&mut content, "tanwords-asset://remove");
        let serialized = content.to_string();
        assert!(!serialized.contains("tanwords-asset://remove"));
        assert!(serialized.contains("https://example.com/keep.png"));
        assert!(serialized.contains("keep"));
    }
}
