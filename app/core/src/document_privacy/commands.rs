use crate::db::params;
use crate::shim::State;

use super::crypto::{decrypt_bytes, decrypt_text, encrypt_bytes, encrypt_text, random};
use super::keys::{
    document_is_protected, get_or_create_master, require_key, unlock_all_master_documents,
    unlock_master_with_password, unwrap_legacy_document_key,
};
use super::keys::{master_config, store_master_config};
use super::state::{PrivatePasswordStatus, LOCKED_ERROR};
use crate::{db, AppState};

#[crate::shim::command]
pub async fn db_private_password_status(
    state: State<'_, AppState>,
) -> Result<PrivatePasswordStatus, String> {
    let database = db::conn(&state)?;
    Ok(PrivatePasswordStatus {
        configured: master_config(&database).await?.is_some(),
        unlocked: state.document_privacy.master_key()?.is_some(),
        legacy_documents: db::scalar_i64(
            &database,
            "SELECT COUNT(*) FROM documents WHERE protected=1 AND protection_salt IS NOT NULL",
            (),
        )
        .await?,
    })
}

#[crate::shim::command]
pub async fn db_unlock_document(
    id: i64,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let database = db::conn(&state)?;
    let legacy = db::scalar_i64(
        &database,
        "SELECT COUNT(*) FROM documents
         WHERE id=?1 AND protected=1 AND protection_salt IS NOT NULL",
        [id],
    )
    .await?
        != 0;
    let key = if legacy {
        let key = unwrap_legacy_document_key(&database, id, &password).await?;
        let master =
            get_or_create_master(&database, &state.document_privacy, Some(&password)).await?;
        database
            .execute(
                "UPDATE documents SET protection_salt=NULL,wrapped_key=?1 WHERE id=?2",
                params![encrypt_bytes(&master, &key)?, id],
            )
            .await
            .map_err(|e| e.to_string())?;
        key
    } else {
        let master =
            unlock_master_with_password(&database, &state.document_privacy, &password).await?;
        unlock_all_master_documents(&database, &state.document_privacy, &master).await?;
        require_key(&database, &state.document_privacy, id)
            .await?
            .ok_or_else(|| LOCKED_ERROR.to_string())?
    };
    state.document_privacy.unlock(id, key)
}

#[crate::shim::command]
pub fn db_lock_document(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.document_privacy.lock(id)
}

/// Encrypts one document (and its assets) under a data key wrapped by `master`.
///
/// Split out of `db_protect_document` so folder locking can run it over many
/// documents against one already-unlocked master, rather than asking for the
/// password once per file.
pub(crate) async fn protect_document_with_master(
    database: &crate::db::Conn,
    privacy: &super::state::DocumentPrivacyState,
    id: i64,
    master: &[u8; 32],
) -> Result<(), String> {
    if document_is_protected(database, id).await? {
        return Ok(());
    }
    let (content, content_text) = db::fetch_one(
        database,
        "SELECT content,content_text FROM documents WHERE id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?)),
    )
    .await?;
    let assets = db::fetch_all(
        database,
        "SELECT id,data FROM document_assets WHERE document_id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    let data_key = random::<32>();
    let wrapped = encrypt_bytes(master, &data_key)?;
    database.execute(
        "UPDATE documents SET content=?1,content_text=?2,protected=1,protection_salt=NULL,wrapped_key=?3,updated_at=datetime('now') WHERE id=?4",
        params![encrypt_text(&data_key, &content)?, encrypt_text(&data_key, &content_text)?, wrapped, id],
    ).await.map_err(|e| e.to_string())?;
    for (asset_id, data) in assets {
        database
            .execute(
                "UPDATE document_assets SET data=?1 WHERE id=?2",
                params![encrypt_bytes(&data_key, &data)?, asset_id],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    privacy.unlock(id, data_key)
}

/// Decrypts one document (and its assets) back to plaintext. The inverse of
/// `protect_document_with_master`, sharing it with `db_remove_document_protection`.
pub(crate) async fn unprotect_document_with_key(
    database: &crate::db::Conn,
    privacy: &super::state::DocumentPrivacyState,
    id: i64,
    key: &[u8; 32],
) -> Result<(), String> {
    let (content, content_text) = db::fetch_one(
        database,
        "SELECT content,content_text FROM documents WHERE id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?)),
    )
    .await?;
    let assets = db::fetch_all(
        database,
        "SELECT id,data FROM document_assets WHERE document_id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    database.execute(
        "UPDATE documents SET content=?1,content_text=?2,protected=0,protection_salt=NULL,wrapped_key=NULL,updated_at=datetime('now') WHERE id=?3",
        params![decrypt_text(key, &content)?, decrypt_text(key, &content_text)?, id],
    ).await.map_err(|e| e.to_string())?;
    for (asset_id, data) in assets {
        database
            .execute(
                "UPDATE document_assets SET data=?1 WHERE id=?2",
                params![decrypt_bytes(key, &data)?, asset_id],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    privacy.lock(id)
}

#[crate::shim::command]
pub async fn db_protect_document(
    id: i64,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let database = db::conn(&state)?;
    if document_is_protected(&database, id).await? {
        return Err("Document is already protected".into());
    }
    let (content, content_text) = db::fetch_one(
        &database,
        "SELECT content,content_text FROM documents WHERE id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?)),
    )
    .await?;
    let assets = db::fetch_all(
        &database,
        "SELECT id,data FROM document_assets WHERE document_id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    let master =
        get_or_create_master(&database, &state.document_privacy, password.as_deref()).await?;
    unlock_all_master_documents(&database, &state.document_privacy, &master).await?;
    let data_key = random::<32>();
    let wrapped = encrypt_bytes(&master, &data_key)?;
    let encrypted_content = encrypt_text(&data_key, &content)?;
    let encrypted_text = encrypt_text(&data_key, &content_text)?;
    database.execute(
        "UPDATE documents SET content=?1,content_text=?2,protected=1,protection_salt=NULL,wrapped_key=?3,updated_at=datetime('now') WHERE id=?4",
        params![encrypted_content, encrypted_text, wrapped, id],
    ).await.map_err(|e| e.to_string())?;
    for (asset_id, data) in assets {
        database
            .execute(
                "UPDATE document_assets SET data=?1 WHERE id=?2",
                params![encrypt_bytes(&data_key, &data)?, asset_id],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    state.document_privacy.unlock(id, data_key)
}

#[crate::shim::command]
pub async fn db_remove_document_protection(
    id: i64,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let database = db::conn(&state)?;
    let legacy = db::scalar_i64(
        &database,
        "SELECT COUNT(*) FROM documents
         WHERE id=?1 AND protected=1 AND protection_salt IS NOT NULL",
        [id],
    )
    .await?
        != 0;
    let key = if legacy {
        unwrap_legacy_document_key(&database, id, &password).await?
    } else {
        unlock_master_with_password(&database, &state.document_privacy, &password).await?;
        require_key(&database, &state.document_privacy, id)
            .await?
            .ok_or_else(|| LOCKED_ERROR.to_string())?
    };
    let (content, content_text) = db::fetch_one(
        &database,
        "SELECT content,content_text FROM documents WHERE id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?)),
    )
    .await?;
    let assets = db::fetch_all(
        &database,
        "SELECT id,data FROM document_assets WHERE document_id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    database.execute(
        "UPDATE documents SET content=?1,content_text=?2,protected=0,protection_salt=NULL,wrapped_key=NULL,updated_at=datetime('now') WHERE id=?3",
        params![decrypt_text(&key, &content)?, decrypt_text(&key, &content_text)?, id],
    ).await.map_err(|e| e.to_string())?;
    for (asset_id, data) in assets {
        database
            .execute(
                "UPDATE document_assets SET data=?1 WHERE id=?2",
                params![decrypt_bytes(&key, &data)?, asset_id],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    state.document_privacy.lock(id)
}

#[crate::shim::command]
pub async fn db_change_document_password(
    current_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if new_password.is_empty() {
        return Err("Password cannot be empty".into());
    }
    let database = db::conn(&state)?;
    // Verify every legacy document before writing anything. Older builds wrapped
    // each document key directly with its own password; when those passwords are
    // the same, this turns the Settings action into a one-step vault migration.
    let legacy_ids = db::fetch_all(
        &database,
        "SELECT id FROM documents WHERE protected=1 AND protection_salt IS NOT NULL",
        (),
        |row| row.get::<i64>(0),
    )
    .await?;
    let mut legacy_keys = Vec::with_capacity(legacy_ids.len());
    for id in legacy_ids {
        legacy_keys.push((
            id,
            unwrap_legacy_document_key(&database, id, &current_password).await?,
        ));
    }

    let master = if master_config(&database).await?.is_some() {
        unlock_master_with_password(&database, &state.document_privacy, &current_password).await?
    } else {
        random::<32>()
    };
    for (id, key) in &legacy_keys {
        database
            .execute(
                "UPDATE documents SET protection_salt=NULL,wrapped_key=?1 WHERE id=?2",
                params![encrypt_bytes(&master, key)?, id],
            )
            .await
            .map_err(|e| e.to_string())?;
        state.document_privacy.unlock(*id, *key)?;
    }
    store_master_config(&database, &new_password, &master).await?;
    state.document_privacy.unlock_master(master)?;
    unlock_all_master_documents(&database, &state.document_privacy, &master).await
}
