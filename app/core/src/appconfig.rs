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
    /// Stable per-installation identity, generated on first use. Scopes rows
    /// in `ai_providers` so a database shared between machines (Turso, or a
    /// copied file) still shows each machine only the providers configured on
    /// it. Lives here rather than in the database precisely because it must
    /// *not* travel with the data.
    #[serde(skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    /// Last Turso URL the user connected to, kept across an explicit
    /// disconnect so the Settings form can prefill it. Secret-free: the auth
    /// token stays in the OS keychain.
    #[serde(skip_serializing_if = "Option::is_none")]
    last_turso_url: Option<String>,
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

/// The URL of the most recent Turso connection, if the user has not explicitly
/// forgotten it. Unlike the active profile, this does not make the app try to
/// reconnect at startup.
pub fn load_remembered_turso_url() -> Option<String> {
    load().last_turso_url.filter(|url| !url.trim().is_empty())
}

pub fn save_remembered_turso_url(url: &str) -> std::io::Result<()> {
    let mut cfg = load();
    cfg.last_turso_url = Some(url.trim().to_string());
    save(&cfg)
}

pub fn clear_remembered_turso_url() {
    let mut cfg = load();
    cfg.last_turso_url = None;
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
