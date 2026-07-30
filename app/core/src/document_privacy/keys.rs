use base64::{engine::general_purpose::STANDARD, Engine as _};
use libsql::Connection;

use super::crypto::{decrypt_bytes, derive_password_key, encrypt_bytes, random};
use super::state::{DocumentPrivacyState, INVALID_PASSWORD, LOCKED_ERROR, MASTER_CONFIG_SETTING};
use crate::db;

pub async fn document_is_protected(
    database: &Connection,
    document_id: i64,
) -> Result<bool, String> {
    Ok(db::scalar_i64(
        database,
        "SELECT protected FROM documents WHERE id=?1",
        [document_id],
    )
    .await?
        != 0)
}

pub async fn require_key(
    database: &Connection,
    privacy: &DocumentPrivacyState,
    document_id: i64,
) -> Result<Option<[u8; 32]>, String> {
    if document_is_protected(database, document_id).await? {
        if let Ok(key) = privacy.key(document_id) {
            return Ok(Some(key));
        }
        let master = privacy
            .master_key()?
            .ok_or_else(|| LOCKED_ERROR.to_string())?;
        let wrapped = db::fetch_one(
            database,
            "SELECT wrapped_key FROM documents
             WHERE id=?1 AND protected=1 AND protection_salt IS NULL",
            [document_id],
            |row| row.get::<Vec<u8>>(0),
        )
        .await
        .map_err(|_| LOCKED_ERROR.to_string())?;
        let raw = decrypt_bytes(&master, &wrapped)?;
        let key: [u8; 32] = raw
            .try_into()
            .map_err(|_| "Invalid wrapped document key".to_string())?;
        privacy.unlock(document_id, key)?;
        Ok(Some(key))
    } else {
        Ok(None)
    }
}

pub(super) async fn legacy_wrapped_key(
    database: &Connection,
    document_id: i64,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    db::fetch_one(
        database,
        "SELECT protection_salt,wrapped_key FROM documents
         WHERE id=?1 AND protected=1 AND protection_salt IS NOT NULL",
        [document_id],
        |row| Ok((row.get::<Vec<u8>>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await
    .map_err(|_| "Protected document not found".into())
}

pub(super) async fn unwrap_legacy_document_key(
    database: &Connection,
    document_id: i64,
    password: &str,
) -> Result<[u8; 32], String> {
    let (salt, wrapped) = legacy_wrapped_key(database, document_id).await?;
    let password_key = derive_password_key(password, &salt)?;
    let raw = decrypt_bytes(&password_key, &wrapped).map_err(|_| INVALID_PASSWORD.to_string())?;
    raw.try_into()
        .map_err(|_| "Invalid wrapped document key".into())
}

pub(super) async fn master_config(database: &Connection) -> Result<Option<(Vec<u8>, Vec<u8>)>, String> {
    let config = db::get_setting(database, MASTER_CONFIG_SETTING)
        .await
        .map_err(|e| e.to_string())?;
    let Some(config) = config else {
        return Ok(None);
    };
    let (salt, wrapped) = config
        .split_once('.')
        .ok_or("Invalid private password configuration")?;
    Ok(Some((
        STANDARD
            .decode(salt)
            .map_err(|_| "Invalid private password salt")?,
        STANDARD
            .decode(wrapped)
            .map_err(|_| "Invalid wrapped private key")?,
    )))
}

pub(super) async fn store_master_config(
    database: &Connection,
    password: &str,
    master: &[u8; 32],
) -> Result<(), String> {
    let salt = random::<16>();
    let password_key = derive_password_key(password, &salt)?;
    let wrapped = encrypt_bytes(&password_key, master)?;
    let config = format!("{}.{}", STANDARD.encode(salt), STANDARD.encode(wrapped));
    db::set_setting(database, MASTER_CONFIG_SETTING, &config)
        .await
        .map_err(|e| e.to_string())
}

pub(super) async fn unlock_master_with_password(
    database: &Connection,
    privacy: &DocumentPrivacyState,
    password: &str,
) -> Result<[u8; 32], String> {
    let (salt, wrapped) = master_config(database)
        .await?
        .ok_or_else(|| "PRIVATE_PASSWORD_NOT_CONFIGURED".to_string())?;
    let password_key = derive_password_key(password, &salt)?;
    let raw = decrypt_bytes(&password_key, &wrapped).map_err(|_| INVALID_PASSWORD.to_string())?;
    let master: [u8; 32] = raw
        .try_into()
        .map_err(|_| "Invalid private master key".to_string())?;
    privacy.unlock_master(master)?;
    Ok(master)
}

pub(super) async fn get_or_create_master(
    database: &Connection,
    privacy: &DocumentPrivacyState,
    password: Option<&str>,
) -> Result<[u8; 32], String> {
    if let Some(master) = privacy.master_key()? {
        return Ok(master);
    }
    if master_config(database).await?.is_some() {
        return unlock_master_with_password(
            database,
            privacy,
            password
                .filter(|value| !value.is_empty())
                .ok_or(super::state::PASSWORD_REQUIRED)?,
        )
        .await;
    }
    let password = password
        .filter(|value| !value.is_empty())
        .ok_or(super::state::PASSWORD_REQUIRED)?;
    let master = random::<32>();
    store_master_config(database, password, &master).await?;
    privacy.unlock_master(master)?;
    Ok(master)
}

pub(super) async fn unlock_all_master_documents(
    database: &Connection,
    privacy: &DocumentPrivacyState,
    master: &[u8; 32],
) -> Result<(), String> {
    let wrapped = db::fetch_all(
        database,
        "SELECT id,wrapped_key FROM documents
         WHERE protected=1 AND protection_salt IS NULL",
        (),
        |row| Ok((row.get::<i64>(0)?, row.get::<Vec<u8>>(1)?)),
    )
    .await?;
    for (id, wrapped_key) in wrapped {
        let raw = decrypt_bytes(master, &wrapped_key)?;
        let key: [u8; 32] = raw
            .try_into()
            .map_err(|_| "Invalid wrapped document key".to_string())?;
        privacy.unlock(id, key)?;
    }
    Ok(())
}
