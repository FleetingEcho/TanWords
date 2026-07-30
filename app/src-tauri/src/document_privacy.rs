use std::collections::HashMap;
use std::sync::Mutex;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use libsql::{params, Connection};
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use tauri::State;

use crate::{db, AppState};

pub const LOCKED_ERROR: &str = "DOCUMENT_LOCKED";
const INVALID_PASSWORD: &str = "INVALID_DOCUMENT_PASSWORD";
const PASSWORD_REQUIRED: &str = "DOCUMENT_PASSWORD_REQUIRED";
const MASTER_CONFIG_SETTING: &str = "document_privacy.master_config";

#[derive(Default)]
pub struct DocumentPrivacyState {
    keys: Mutex<HashMap<i64, [u8; 32]>>,
    master_key: Mutex<Option<[u8; 32]>>,
}

impl DocumentPrivacyState {
    pub fn clear(&self) -> Result<(), String> {
        self.keys.lock().map_err(|e| e.to_string())?.clear();
        *self.master_key.lock().map_err(|e| e.to_string())? = None;
        Ok(())
    }

    pub fn lock(&self, document_id: i64) -> Result<(), String> {
        self.keys
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&document_id);
        Ok(())
    }

    pub fn is_unlocked(&self, document_id: i64) -> bool {
        self.keys
            .lock()
            .map(|keys| keys.contains_key(&document_id))
            .unwrap_or(false)
    }

    pub fn key(&self, document_id: i64) -> Result<[u8; 32], String> {
        self.keys
            .lock()
            .map_err(|e| e.to_string())?
            .get(&document_id)
            .copied()
            .ok_or_else(|| LOCKED_ERROR.into())
    }

    fn unlock(&self, document_id: i64, key: [u8; 32]) -> Result<(), String> {
        self.keys
            .lock()
            .map_err(|e| e.to_string())?
            .insert(document_id, key);
        Ok(())
    }

    fn master_key(&self) -> Result<Option<[u8; 32]>, String> {
        Ok(*self.master_key.lock().map_err(|e| e.to_string())?)
    }

    fn unlock_master(&self, key: [u8; 32]) -> Result<(), String> {
        *self.master_key.lock().map_err(|e| e.to_string())? = Some(key);
        Ok(())
    }
}

#[derive(Serialize)]
pub struct PrivatePasswordStatus {
    configured: bool,
    unlocked: bool,
    legacy_documents: i64,
}

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0_u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn derive_password_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Password derivation failed: {e}"))?;
    Ok(key)
}

pub fn encrypt_bytes(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let nonce = random::<12>();
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "Document encryption failed")?;
    let mut out = nonce.to_vec();
    out.extend(ciphertext);
    Ok(out)
}

pub fn decrypt_bytes(key: &[u8; 32], encrypted: &[u8]) -> Result<Vec<u8>, String> {
    if encrypted.len() < 12 {
        return Err("Invalid encrypted document data".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(Nonce::from_slice(&encrypted[..12]), &encrypted[12..])
        .map_err(|_| "Document decryption failed".into())
}

pub fn encrypt_text(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    Ok(STANDARD.encode(encrypt_bytes(key, plaintext.as_bytes())?))
}

pub fn decrypt_text(key: &[u8; 32], encrypted: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(encrypted)
        .map_err(|_| "Invalid encrypted document text")?;
    String::from_utf8(decrypt_bytes(key, &bytes)?)
        .map_err(|_| "Invalid decrypted document text".into())
}

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

async fn legacy_wrapped_key(
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

async fn unwrap_legacy_document_key(
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

async fn master_config(database: &Connection) -> Result<Option<(Vec<u8>, Vec<u8>)>, String> {
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

async fn store_master_config(
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

async fn unlock_master_with_password(
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

async fn get_or_create_master(
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
                .ok_or(PASSWORD_REQUIRED)?,
        )
        .await;
    }
    let password = password
        .filter(|value| !value.is_empty())
        .ok_or(PASSWORD_REQUIRED)?;
    let master = random::<32>();
    store_master_config(database, password, &master).await?;
    privacy.unlock_master(master)?;
    Ok(master)
}

async fn unlock_all_master_documents(
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
pub fn db_lock_document(_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.document_privacy.clear()
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_bytes_round_trip_and_reject_wrong_key() {
        let key = random::<32>();
        let encrypted = encrypt_bytes(&key, b"private text").unwrap();
        assert_ne!(&encrypted[12..], b"private text");
        assert_eq!(decrypt_bytes(&key, &encrypted).unwrap(), b"private text");
        assert!(decrypt_bytes(&random::<32>(), &encrypted).is_err());
    }

    #[test]
    fn password_key_is_stable_for_the_same_salt() {
        let salt = random::<16>();
        assert_eq!(
            derive_password_key("secret", &salt).unwrap(),
            derive_password_key("secret", &salt).unwrap()
        );
        assert_ne!(
            derive_password_key("secret", &salt).unwrap(),
            derive_password_key("other", &salt).unwrap()
        );
    }
}
