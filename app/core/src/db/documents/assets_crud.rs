use base64::{engine::general_purpose::STANDARD, Engine as _};
use libsql::params;
use crate::shim::State;

use super::types::{DocumentAsset, DocumentAssetSummary};
use crate::db;
use crate::document_privacy::{self, decrypt_bytes, decrypt_text, encrypt_bytes, encrypt_text};
use crate::AppState;

const MAX_DOCUMENT_ASSET_BYTES: usize = 100 * 1024 * 1024;

#[crate::shim::command]
pub async fn db_create_document_asset(
    document_id: i64,
    file_name: String,
    mime_type: String,
    data_base64: String,
    conn: State<'_, AppState>,
) -> Result<String, String> {
    let data = STANDARD
        .decode(data_base64)
        .map_err(|_| "Invalid attachment data")?;
    if data.is_empty() || data.len() > MAX_DOCUMENT_ASSET_BYTES {
        return Err("Attachment must be between 1 byte and 100 MB".into());
    }
    let db = db::conn(&conn)?;
    let size = data.len() as i64;
    let key = document_privacy::require_key(&db, &conn.document_privacy, document_id).await?;
    let data = match key {
        Some(key) => encrypt_bytes(&key, &data)?,
        None => data,
    };
    let id = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO document_assets (id, document_id, file_name, mime_type, data, size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id.clone(), document_id, file_name, mime_type, data, size],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// An upload that belongs to no document. Unencrypted: encryption keys are
/// per-document, and these files have no document to inherit one from.
#[crate::shim::command]
pub async fn db_create_standalone_asset(
    file_name: String,
    mime_type: String,
    data_base64: String,
    conn: State<'_, AppState>,
) -> Result<String, String> {
    let data = STANDARD
        .decode(data_base64)
        .map_err(|_| "Invalid attachment data")?;
    if data.is_empty() || data.len() > MAX_DOCUMENT_ASSET_BYTES {
        return Err("Attachment must be between 1 byte and 100 MB".into());
    }
    let db = db::conn(&conn)?;
    let size = data.len() as i64;
    let id = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO standalone_assets (id, file_name, mime_type, data, size)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id.clone(), file_name, mime_type, data, size],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Registers a file whose bytes are already in R2 (see `r2::r2_put_asset`).
/// The row carries the object key and a zero-length blob — the object store
/// owns the content, the database owns the listing.
#[crate::shim::command]
pub async fn db_create_remote_asset(
    file_name: String,
    mime_type: String,
    size: i64,
    remote_key: String,
    conn: State<'_, AppState>,
) -> Result<String, String> {
    if remote_key.trim().is_empty() {
        return Err("Missing remote object key".into());
    }
    let db = db::conn(&conn)?;
    let id = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO standalone_assets (id, file_name, mime_type, data, size, remote_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id.clone(), file_name, mime_type, Vec::<u8>::new(), size, remote_key],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[crate::shim::command]
pub async fn db_get_document_asset(
    id: String,
    conn: State<'_, AppState>,
) -> Result<DocumentAsset, String> {
    let db = db::conn(&conn)?;
    // R2-backed uploads never carry bytes here — hand back a URL and let the
    // renderer stream from the bucket, which is the whole point of putting a
    // 100 MB video there instead of in a row.
    if let Ok(row) = db::fetch_one(
        &db,
        "SELECT file_name, mime_type, size, COALESCE(remote_key, '')
           FROM standalone_assets WHERE id = ?1 AND COALESCE(remote_key, '') <> ''",
        params![id.clone()],
        |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?, row.get::<i64>(2)?, row.get::<String>(3)?)),
    )
    .await
    {
        let settings = crate::appconfig::load_r2_settings()
            .ok_or_else(|| "This file is stored in R2, but no bucket is connected".to_string())?;
        return Ok(DocumentAsset {
            id,
            document_id: 0,
            file_name: row.0,
            mime_type: row.1,
            size: row.2,
            data_base64: String::new(),
            remote_url: Some(crate::r2::object_url(&settings, &row.3)?),
        });
    }
    let row = db::fetch_one(
        &db,
        "SELECT id, document_id, file_name, mime_type, size, data FROM all_document_assets WHERE id = ?1",
        params![id],
        |row| Ok((
            row.get::<String>(0)?, row.get::<i64>(1)?, row.get::<String>(2)?,
            row.get::<String>(3)?, row.get::<i64>(4)?, row.get::<Vec<u8>>(5)?,
        )),
    ).await?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, row.1).await?;
    let data = match key {
        Some(key) => decrypt_bytes(&key, &row.5)?,
        None => row.5,
    };
    Ok(DocumentAsset {
        id: row.0,
        document_id: row.1,
        file_name: row.2,
        mime_type: row.3,
        size: row.4,
        data_base64: STANDARD.encode(data),
        remote_url: None,
    })
}

#[crate::shim::command]
pub async fn db_get_document_assets(
    document_id: i64,
    conn: State<'_, AppState>,
) -> Result<Vec<DocumentAsset>, String> {
    let db = db::conn(&conn)?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, document_id).await?;
    let rows = db::fetch_all(
        &db,
        "SELECT id, document_id, file_name, mime_type, size, data
         FROM document_assets WHERE document_id = ?1 ORDER BY created_at",
        params![document_id],
        |row| {
            Ok((
                row.get::<String>(0)?,
                row.get::<i64>(1)?,
                row.get::<String>(2)?,
                row.get::<String>(3)?,
                row.get::<i64>(4)?,
                row.get::<Vec<u8>>(5)?,
            ))
        },
    )
    .await?;
    rows.into_iter()
        .map(|row| {
            let data = match key {
                Some(key) => decrypt_bytes(&key, &row.5)?,
                None => row.5,
            };
            Ok(DocumentAsset {
                id: row.0,
                document_id: row.1,
                file_name: row.2,
                mime_type: row.3,
                size: row.4,
                data_base64: STANDARD.encode(data),
                remote_url: None,
            })
        })
        .collect()
}

#[crate::shim::command]
pub async fn db_list_document_assets(
    conn: State<'_, AppState>,
) -> Result<Vec<DocumentAssetSummary>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT a.id, a.document_id, d.title, a.file_name, a.mime_type, a.size, a.created_at,
                CASE WHEN d.protected=0 AND instr(d.content, 'tanwords-asset://' || a.id) > 0 THEN 1 ELSE 0 END,
                d.protected, 0
         FROM document_assets a
         JOIN documents d ON d.id = a.document_id
         UNION ALL
         SELECT s.id, 0, '', s.file_name, s.mime_type, s.size, s.created_at, 1, 0, 1
         FROM standalone_assets s
         ORDER BY 7 DESC",
        (),
        |row| {
            let document_id = row.get::<i64>(1)?;
            let protected = row.get::<i64>(8)? != 0;
            Ok(DocumentAssetSummary {
            id: row.get(0)?,
            document_id,
            document_title: row.get(2)?,
            file_name: row.get(3)?,
            mime_type: row.get(4)?,
            size: row.get(5)?,
            created_at: row.get(6)?,
            referenced: row.get::<i64>(7)? != 0,
            protected,
            unlocked: protected && conn.document_privacy.is_unlocked(document_id),
            standalone: row.get::<i64>(9)? != 0,
        })},
    ).await
}

pub(super) fn remove_asset_blocks(value: &mut serde_json::Value, url: &str) {
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

#[crate::shim::command]
pub async fn db_delete_document_asset(id: String, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    // Uploads belong to no document, so there is no content to strip the
    // reference out of — just drop the row.
    let standalone = db::fetch_one(
        &db,
        "SELECT COUNT(*) FROM standalone_assets WHERE id = ?1",
        params![id.clone()],
        |row| row.get::<i64>(0),
    )
    .await?
        > 0;
    if standalone {
        // Drop the object first: a row without its object is a broken entry,
        // an object without its row is invisible and unreclaimable.
        let remote_key = db::fetch_one(
            &db,
            "SELECT COALESCE(remote_key, '') FROM standalone_assets WHERE id = ?1",
            params![id.clone()],
            |row| row.get::<String>(0),
        )
        .await
        .unwrap_or_default();
        if !remote_key.is_empty() {
            if let Some(settings) = crate::appconfig::load_r2_settings() {
                crate::r2::delete_object(&settings, &remote_key).await?;
            }
        }
        return db
            .execute("DELETE FROM standalone_assets WHERE id = ?1", params![id])
            .await
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    let document_id = db::fetch_one(
        &db,
        "SELECT document_id FROM document_assets WHERE id = ?1",
        params![id.clone()],
        |row| row.get::<i64>(0),
    )
    .await?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, document_id).await?;
    let stored_content = db::fetch_one(
        &db,
        "SELECT content FROM documents WHERE id = ?1",
        params![document_id],
        |row| row.get::<String>(0),
    )
    .await?;
    let content = match key {
        Some(key) => decrypt_text(&key, &stored_content)?,
        None => stored_content,
    };
    if let Ok(mut blocks) = serde_json::from_str::<serde_json::Value>(&content) {
        remove_asset_blocks(&mut blocks, &format!("tanwords-asset://{id}"));
        let updated = serde_json::to_string(&blocks).map_err(|e| e.to_string())?;
        let stored_updated = match key {
            Some(key) => encrypt_text(&key, &updated)?,
            None => updated,
        };
        db.execute(
            "UPDATE documents SET content = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![stored_updated, document_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    db.execute("DELETE FROM document_assets WHERE id = ?1", params![id])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_delete_orphan_document_assets(conn: State<'_, AppState>) -> Result<u64, String> {
    let db = db::conn(&conn)?;
    db.execute(
        "DELETE FROM document_assets
             WHERE document_id IN (SELECT id FROM documents WHERE protected=0)
               AND NOT EXISTS (
             SELECT 1 FROM documents d
             WHERE d.id = document_assets.document_id
               AND instr(d.content, 'tanwords-asset://' || document_assets.id) > 0
         )",
        (),
    )
    .await
    .map_err(|e| e.to_string())
}

#[crate::shim::command]
pub async fn db_prune_document_assets(
    document_id: i64,
    referenced_ids: Vec<String>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    document_privacy::require_key(&db, &conn.document_privacy, document_id).await?;
    let assets = db::fetch_all(
        &db,
        "SELECT id FROM document_assets WHERE document_id = ?1",
        params![document_id],
        |row| row.get::<String>(0),
    )
    .await?;
    for id in assets {
        if !referenced_ids.contains(&id) {
            db.execute("DELETE FROM document_assets WHERE id = ?1", params![id])
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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
