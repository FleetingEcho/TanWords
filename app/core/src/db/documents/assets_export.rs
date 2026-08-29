use crate::db::params;
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
    if !std::path::Path::new(&destination).is_absolute() {
        return Err("Export destination must be an absolute path".into());
    }
    let db = db::conn(&conn)?;
    let (document_id, data) = db::fetch_one(
        &db,
        "SELECT document_id,data FROM all_document_assets WHERE id = ?1",
        params![id],
        |row| Ok((row.get::<i64>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, document_id).await?;
    let data = match key {
        Some(key) => decrypt_bytes(&key, &data)?,
        None => data,
    };
    // Asset bodies reach 100 MB; keep the write off the async worker that
    // services every other IPC command.
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&destination);
        std::fs::write(path, data).map_err(|e| format!("Failed to export image: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
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
    database: &crate::db::Conn,
    ids: &[String],
    privacy: &document_privacy::DocumentPrivacyState,
) -> Result<Vec<(String, String, Vec<u8>)>, String> {
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        let row = db::fetch_one(
            database,
            "SELECT document_id,file_name,data FROM all_document_assets WHERE id = ?1",
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
    // Resolve every destination up front, then hand the whole batch of writes
    // (each asset up to 100 MB) to a blocking thread.
    let mut used = std::collections::HashSet::new();
    let mut writes = Vec::with_capacity(rows.len());
    for (id, file_name, data) in rows {
        let base = safe_export_name(&file_name, &id);
        let path = unique_export_path(directory, &base, &mut used);
        writes.push((path, data));
    }
    // `writes` consumed `rows` (one per requested id); count from `ids`.
    let count = ids.len();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        for (path, data) in writes {
            std::fs::write(path, data).map_err(|e| format!("Failed to export image: {e}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(count as u64)
}

#[crate::shim::command]
pub async fn db_export_document_assets_zip(
    ids: Vec<String>,
    destination: String,
    conn: State<'_, AppState>,
) -> Result<u64, String> {
    if !std::path::Path::new(&destination).is_absolute() {
        return Err("Export destination must be an absolute path".into());
    }
    let database = db::conn(&conn)?;
    let rows = export_asset_rows(&database, &ids, &conn.document_privacy).await?;
    let mut used = std::collections::HashSet::new();
    let mut entries = Vec::with_capacity(rows.len());
    for (id, file_name, data) in rows {
        let base = safe_export_name(&file_name, &id);
        let unique = unique_export_path(std::path::Path::new(""), &base, &mut used);
        entries.push((unique.to_string_lossy().into_owned(), data));
    }
    // Deflating and writing potentially hundreds of MB stays off the async
    // worker that services every other IPC command.
    let count = entries.len();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let path = std::path::Path::new(&destination);
        let file = std::fs::File::create(path).map_err(|e| format!("Failed to create ZIP: {e}"))?;
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            archive
                .start_file(name, options)
                .map_err(|e| format!("Failed to write ZIP: {e}"))?;
            archive
                .write_all(&data)
                .map_err(|e| format!("Failed to write ZIP: {e}"))?;
        }
        archive
            .finish()
            .map_err(|e| format!("Failed to finish ZIP: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(count as u64)
}
