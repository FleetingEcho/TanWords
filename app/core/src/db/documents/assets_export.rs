use libsql::params;
use std::io::Write;
use crate::shim::State;

use crate::db;
use crate::document_privacy::{self, decrypt_bytes};
use crate::AppState;

#[crate::shim::command]
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
    let (document_id, data) = db::fetch_one(
        &db,
        "SELECT document_id,data FROM document_assets WHERE id = ?1",
        params![id],
        |row| Ok((row.get::<i64>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, document_id).await?;
    let data = match key {
        Some(key) => decrypt_bytes(&key, &data)?,
        None => data,
    };
    std::fs::write(path, data).map_err(|e| format!("Failed to export image: {e}"))
}

fn safe_export_name(name: &str, id: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':') {
                '_'
            } else {
                c
            }
        })
        .collect();
    if cleaned.trim().is_empty() {
        format!("image-{id}.png")
    } else {
        cleaned
    }
}

async fn export_asset_rows(
    database: &libsql::Connection,
    ids: &[String],
    privacy: &document_privacy::DocumentPrivacyState,
) -> Result<Vec<(String, String, Vec<u8>)>, String> {
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        let row = db::fetch_one(
            database,
            "SELECT document_id,file_name,data FROM document_assets WHERE id = ?1",
            params![id.clone()],
            |row| {
                Ok((
                    row.get::<i64>(0)?,
                    row.get::<String>(1)?,
                    row.get::<Vec<u8>>(2)?,
                ))
            },
        )
        .await?;
        let key = document_privacy::require_key(database, privacy, row.0).await?;
        let data = match key {
            Some(key) => decrypt_bytes(&key, &row.2)?,
            None => row.2,
        };
        rows.push((id.clone(), row.1, data));
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

#[crate::shim::command]
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
    let rows = export_asset_rows(&database, &ids, &conn.document_privacy).await?;
    let mut used = std::collections::HashSet::new();
    for (id, file_name, data) in &rows {
        let base = safe_export_name(file_name, id);
        let path = unique_export_path(directory, &base, &mut used);
        std::fs::write(path, data).map_err(|e| format!("Failed to export image: {e}"))?;
    }
    Ok(rows.len() as u64)
}

#[crate::shim::command]
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
    let rows = export_asset_rows(&database, &ids, &conn.document_privacy).await?;
    let file = std::fs::File::create(path).map_err(|e| format!("Failed to create ZIP: {e}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut used = std::collections::HashSet::new();
    for (id, file_name, data) in &rows {
        let base = safe_export_name(file_name, id);
        let unique = unique_export_path(std::path::Path::new(""), &base, &mut used);
        archive
            .start_file(unique.to_string_lossy(), options)
            .map_err(|e| format!("Failed to write ZIP: {e}"))?;
        archive
            .write_all(data)
            .map_err(|e| format!("Failed to write ZIP: {e}"))?;
    }
    archive
        .finish()
        .map_err(|e| format!("Failed to finish ZIP: {e}"))?;
    Ok(rows.len() as u64)
}
