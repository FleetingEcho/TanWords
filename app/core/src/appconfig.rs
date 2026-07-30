//! Tiny app-level config file (separate from the SQLite DB itself — we can't
//! store "which database to open" inside a database we haven't opened yet).
//! Holds the active connection profile: either a local file path or a Turso
//! embedded-replica endpoint. Absent or unreadable means "default local file".
//!
//! Deliberately secret-free: a Turso profile's auth token lives in the OS
//! keychain (`secrets::turso_token_*`), so this file stays safe to read, sync
//! or hand to someone debugging a startup problem.

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
}

fn config_file_path() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tanwords");
    std::fs::create_dir_all(&dir).ok();
    dir.join("app_config.json")
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

pub fn save_db_profile(profile: &DbProfile) -> std::io::Result<()> {
    let cfg = AppConfig { db_path: None, db_profile: Some(profile.clone()) };
    let json = serde_json::to_string_pretty(&cfg).unwrap_or_default();
    std::fs::write(config_file_path(), json)
}

/// Called when the stored profile fails to open — avoids the app getting
/// permanently stuck pointing at a moved file or an unreachable endpoint.
pub fn clear_db_profile() {
    let _ = std::fs::write(config_file_path(), "{}");
}
