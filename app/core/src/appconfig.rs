//! Tiny app-level config file (separate from the SQLite DB itself — we can't
//! store "which database to open" inside a database we haven't opened yet).
//! Holds the active connection profile: either a local file path or a
//! Postgres connection string. Absent or unreadable means "default local
//! file".

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::db::connection::DbProfile;

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    /// Pre-profile format: a bare local path written by older versions of
    /// `db_switch_path`. Still read (and upgraded on the next write) so
    /// updating the app doesn't silently move a user off their chosen file.
    #[serde(skip_serializing_if = "Option::is_none")]
    db_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    db_profile: Option<DbProfile>,
    /// Stable per-installation identity, generated on first use. Scopes rows
    /// in `ai_providers` so a database shared between machines (Postgres, or
    /// a copied file) still shows each machine only the providers configured
    /// on it. Lives here rather than in the database precisely because it must
    /// *not* travel with the data.
    #[serde(skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    /// Connected R2 bucket, minus the secret access key — that one lives in
    /// the keychain, keeping this file safe to read or hand over.
    #[serde(skip_serializing_if = "Option::is_none")]
    r2: Option<crate::r2::R2Settings>,
    /// App lock verifier — a salt and an Argon2 key, never the password. Here
    /// rather than in the database so a synced profile cannot carry one
    /// machine's lock to another.
    #[serde(skip_serializing_if = "Option::is_none")]
    app_lock: Option<crate::app_lock::AppLock>,
}

pub fn load_app_lock() -> Option<crate::app_lock::AppLock> {
    load().app_lock
}

pub fn save_app_lock(lock: Option<&crate::app_lock::AppLock>) {
    let mut cfg = load();
    cfg.app_lock = lock.cloned();
    let _ = save(&cfg);
}

pub fn load_r2_settings() -> Option<crate::r2::R2Settings> {
    load().r2
}

pub fn save_r2_settings(settings: Option<&crate::r2::R2Settings>) {
    let mut cfg = load();
    cfg.r2 = settings.cloned();
    let _ = save(&cfg);
}

fn config_file_path() -> PathBuf {
    // `app_data_dir` honours TANWORDS_DATA_DIR so the web server keeps config
    // under its own data root; on the desktop it resolves to the same
    // platform data dir as before.
    crate::app_data_dir().join("app_config.json")
}

fn load() -> AppConfig {
    std::fs::read_to_string(config_file_path())
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// The saved profile, if any. Legacy `db_path` entries are read as a local
/// profile so an in-place upgrade keeps pointing at the same file.
pub fn load_db_profile() -> Option<DbProfile> {
    let cfg = load();
    if let Some(profile) = cfg.db_profile {
        return Some(profile);
    }
    cfg.db_path
        .filter(|p| !p.trim().is_empty())
        .map(|path| DbProfile::Local { path })
}

fn save(cfg: &AppConfig) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(cfg).unwrap_or_default();
    std::fs::write(config_file_path(), json)
}

pub fn save_db_profile(profile: &DbProfile) -> std::io::Result<()> {
    // Read-modify-write rather than constructing a fresh AppConfig: this file
    // now holds `device_id` too, and rebuilding it from scratch would drop
    // that on every connection change — orphaning the device's ai_providers
    // rows and making its API keys look unconfigured.
    let mut cfg = load();
    cfg.db_path = None;
    cfg.db_profile = Some(profile.clone());
    save(&cfg)
}

/// Called when the stored profile fails to open — avoids the app getting
/// permanently stuck pointing at a moved file or an unreachable endpoint.
/// Clears the *profile* only; `device_id` is not connection state and is kept.
pub fn clear_db_profile() {
    let mut cfg = load();
    cfg.db_path = None;
    cfg.db_profile = None;
    let _ = save(&cfg);
}

/// This installation's device id, generating and persisting one on first call.
///
/// A failure to persist is not fatal — it falls back to a fresh id for this
/// process so provider config still works, it just won't be recognised again
/// after a restart. That is strictly better than refusing to start.
pub fn device_id() -> String {
    let mut cfg = load();
    if let Some(id) = cfg.device_id.as_ref().filter(|id| !id.trim().is_empty()) {
        return id.clone();
    }
    let id = uuid::Uuid::new_v4().to_string();
    cfg.device_id = Some(id.clone());
    let _ = save(&cfg);
    id
}
