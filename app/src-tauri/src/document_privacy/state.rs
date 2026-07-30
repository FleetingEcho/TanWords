use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;

pub const LOCKED_ERROR: &str = "DOCUMENT_LOCKED";
pub(super) const INVALID_PASSWORD: &str = "INVALID_DOCUMENT_PASSWORD";
pub(super) const PASSWORD_REQUIRED: &str = "DOCUMENT_PASSWORD_REQUIRED";
pub(super) const MASTER_CONFIG_SETTING: &str = "document_privacy.master_config";

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

    pub(super) fn unlock(&self, document_id: i64, key: [u8; 32]) -> Result<(), String> {
        self.keys
            .lock()
            .map_err(|e| e.to_string())?
            .insert(document_id, key);
        Ok(())
    }

    pub(super) fn master_key(&self) -> Result<Option<[u8; 32]>, String> {
        Ok(*self.master_key.lock().map_err(|e| e.to_string())?)
    }

    pub(super) fn unlock_master(&self, key: [u8; 32]) -> Result<(), String> {
        *self.master_key.lock().map_err(|e| e.to_string())? = Some(key);
        Ok(())
    }
}

#[derive(Serialize)]
pub struct PrivatePasswordStatus {
    pub(super) configured: bool,
    pub(super) unlocked: bool,
    pub(super) legacy_documents: i64,
}
