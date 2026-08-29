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
    // One transaction across the `protected` flag and every asset
    // re-encryption. Committing the flag before the assets (the old shape)
    // meant any mid-loop failure left a document that claims to be protected
    // while some of its assets are still plaintext — `db_get_document_assets`
    // decrypts every asset, so one leftover makes the whole list error, and
    // the unprotect path fails the same way: unreadable forever after.
    let tx = database.transaction().await.map_err(|e| e.to_string())?;
    let (content, content_text) = db::fetch_one(
        &tx,
        "SELECT content,content_text FROM documents WHERE id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?)),
    )
    .await?;
    let assets = db::fetch_all(
        &tx,
        "SELECT id,data FROM document_assets WHERE document_id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    let data_key = random::<32>();
    let wrapped = encrypt_bytes(master, &data_key)?;
    tx.execute(
        "UPDATE documents SET content=?1,content_text=?2,protected=1,protection_salt=NULL,wrapped_key=?3,updated_at=datetime('now') WHERE id=?4",
        params![encrypt_text(&data_key, &content)?, encrypt_text(&data_key, &content_text)?, wrapped, id],
    ).await.map_err(|e| e.to_string())?;
    for (asset_id, data) in assets {
        tx.execute(
            "UPDATE document_assets SET data=?1 WHERE id=?2",
            params![encrypt_bytes(&data_key, &data)?, asset_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
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
    // The inverse transaction: the `protected=0` flag must not be committed
    // while some assets are still ciphertext — those would be returned
    // verbatim as if they were the file, permanently corrupt.
    let tx = database.transaction().await.map_err(|e| e.to_string())?;
    let (content, content_text) = db::fetch_one(
        &tx,
        "SELECT content,content_text FROM documents WHERE id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?)),
    )
    .await?;
    let assets = db::fetch_all(
        &tx,
        "SELECT id,data FROM document_assets WHERE document_id=?1",
        [id],
        |row| Ok((row.get::<String>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    tx.execute(
        "UPDATE documents SET content=?1,content_text=?2,protected=0,protection_salt=NULL,wrapped_key=NULL,updated_at=datetime('now') WHERE id=?3",
        params![decrypt_text(key, &content)?, decrypt_text(key, &content_text)?, id],
    ).await.map_err(|e| e.to_string())?;
    for (asset_id, data) in assets {
        tx.execute(
            "UPDATE document_assets SET data=?1 WHERE id=?2",
            params![decrypt_bytes(key, &data)?, asset_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
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
    let master =
        get_or_create_master(&database, &state.document_privacy, password.as_deref()).await?;
    unlock_all_master_documents(&database, &state.document_privacy, &master).await?;
    protect_document_with_master(&database, &state.document_privacy, id, &master).await
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
    unprotect_document_with_key(&database, &state.document_privacy, id, &key).await
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
        // No config yet: the legacy-migration path. Persist the freshly minted
        // master under the *current* password before re-wrapping anything with
        // it — if a later write fails, the master has to exist somewhere
        // recoverable; a retry would otherwise mint a different key and the
        // re-wrapped rows would be sealed forever.
        let master = random::<32>();
        store_master_config(&database, &current_password, &master).await?;
        master
    };
    {
        // Re-wrap the legacy rows and re-key the master to the new password in
        // one transaction, so a failure halfway cannot strand half the rows.
        let tx = database.transaction().await.map_err(|e| e.to_string())?;
        for (id, key) in &legacy_keys {
            tx.execute(
                "UPDATE documents SET protection_salt=NULL,wrapped_key=?1 WHERE id=?2",
                params![encrypt_bytes(&master, key)?, id],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        store_master_config(&tx, &new_password, &master).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
    }
    for (id, key) in &legacy_keys {
        state.document_privacy.unlock(*id, *key)?;
    }
    state.document_privacy.unlock_master(master)?;
    unlock_all_master_documents(&database, &state.document_privacy, &master).await
}
