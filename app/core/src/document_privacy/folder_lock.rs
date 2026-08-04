//! Locking a whole library folder.
//!
//! A locked folder is not itself encrypted — there is nothing in it to encrypt.
//! It is a standing instruction: everything filed here is protected, including
//! whatever arrives later. That last half is the point. Protection was already a
//! per-document toggle before this existed; what it could not express was "and
//! anything I drop in here from now on", so the guarantee quietly lapsed exactly
//! when the user was not thinking about it.

use libsql::{params, Connection};

use super::commands::{protect_document_with_master, unprotect_document_with_key};
use super::keys::{get_or_create_master, require_key, unlock_all_master_documents,
                  unlock_master_with_password};
use super::state::LOCKED_ERROR;
use crate::db::normalize_folder;
use crate::shim::State;
use crate::{db, AppState};

/// Whether `folder` sits under a locked folder — itself or any ancestor.
///
/// Ancestors count: locking "Private" has to cover "Private/2026" as well, or
/// the promise fails at the first subfolder.
pub async fn folder_chain_is_locked(database: &Connection, folder: &str) -> Result<bool, String> {
    if folder.is_empty() {
        return Ok(false);
    }
    let mut prefix = String::new();
    let mut candidates: Vec<String> = Vec::new();
    for segment in folder.split('/').filter(|s| !s.is_empty()) {
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(segment);
        candidates.push(prefix.clone());
    }
    for path in candidates {
        let locked = db::scalar_i64(
            database,
            "SELECT COALESCE(MAX(locked), 0) FROM document_folders WHERE path = ?1",
            [path],
        )
        .await?;
        if locked != 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Encrypts `id` if it just landed in a locked folder.
///
/// Called from every path that files a document: create-with-content, and the
/// move that both drag-and-drop and "new document here" go through. Refusing
/// with `DOCUMENT_LOCKED` when the session has no master key is deliberate — the
/// alternative is leaving a plaintext document sitting in a folder the user
/// believes is sealed, and a caller that can prompt for the password is in a
/// far better position to fix it than a silent skip here.
pub async fn protect_if_folder_locked(
    database: &Connection,
    privacy: &super::state::DocumentPrivacyState,
    id: i64,
    folder: &str,
) -> Result<(), String> {
    if !folder_chain_is_locked(database, folder).await? {
        return Ok(());
    }
    let master = privacy
        .master_key()?
        .ok_or_else(|| LOCKED_ERROR.to_string())?;
    protect_document_with_master(database, privacy, id, &master).await
}

/// Every document at or below `folder`.
async fn documents_under(database: &Connection, folder: &str) -> Result<Vec<i64>, String> {
    db::fetch_all(
        database,
        "SELECT id FROM documents
         WHERE folder = ?1 OR substr(folder, 1, length(?1) + 1) = ?1 || '/'",
        [folder.to_string()],
        |row| row.get::<i64>(0),
    )
    .await
}

/// Locks or unlocks a folder, carrying every document under it along.
///
/// Unlocking decrypts them — the folder losing its lock while its contents stay
/// encrypted would leave documents nobody can explain the state of.
#[crate::shim::command]
pub async fn db_set_folder_locked(
    path: String,
    locked: bool,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = normalize_folder(&path)?;
    if path.is_empty() {
        return Err("folder name is empty".into());
    }
    let database = db::conn(&state)?;
    let ids = documents_under(&database, &path).await?;

    if locked {
        let master =
            get_or_create_master(&database, &state.document_privacy, password.as_deref()).await?;
        unlock_all_master_documents(&database, &state.document_privacy, &master).await?;
        for id in ids {
            protect_document_with_master(&database, &state.document_privacy, id, &master).await?;
        }
    } else {
        let password = password
            .filter(|value| !value.is_empty())
            .ok_or_else(|| super::state::PASSWORD_REQUIRED.to_string())?;
        unlock_master_with_password(&database, &state.document_privacy, &password).await?;
        for id in ids {
            // Documents the user un-protected by hand are already plaintext;
            // require_key returns None for those and they are simply skipped.
            if let Some(key) = require_key(&database, &state.document_privacy, id).await? {
                unprotect_document_with_key(&database, &state.document_privacy, id, &key).await?;
            }
        }
    }

    // Subfolders do not carry their own flag — `folder_chain_is_locked` walks
    // ancestors — so only this row changes.
    database
        .execute(
            "INSERT INTO document_folders (path, locked) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET locked = excluded.locked",
            params![path, locked as i64],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
