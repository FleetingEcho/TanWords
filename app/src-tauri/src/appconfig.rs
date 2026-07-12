//! Tiny app-level config file (separate from the SQLite DB itself — we can't
//! store "which DB file to open" inside a DB we haven't opened yet).
//! Currently holds only an optional db_path override written by
//! `db_switch_path`; absent or unreadable means "use the default location".

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    db_path: Option<String>,
}

fn config_file_path() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tanwords");
    std::fs::create_dir_all(&dir).ok();
    dir.join("app_config.json")
}

pub fn load_db_path_override() -> Option<String> {
    let content = std::fs::read_to_string(config_file_path()).ok()?;
    let cfg: AppConfig = serde_json::from_str(&content).ok()?;
    cfg.db_path.filter(|p| !p.trim().is_empty())
}

pub fn save_db_path_override(db_path: &str) -> std::io::Result<()> {
    let cfg = AppConfig { db_path: Some(db_path.to_string()) };
    let json = serde_json::to_string_pretty(&cfg).unwrap_or_default();
    std::fs::write(config_file_path(), json)
}

/// Called when the stored override path fails to open — avoids the app
/// getting permanently stuck pointing at a moved/deleted file.
pub fn clear_db_path_override() {
    let _ = std::fs::write(config_file_path(), "{}");
}
