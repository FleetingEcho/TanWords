use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub(super) const DEFAULT_PORT: u16 = 47831;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            token: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub endpoint: Option<String>,
    pub error: Option<String>,
}

impl Default for McpStatus {
    fn default() -> Self {
        Self {
            running: false,
            endpoint: None,
            error: None,
        }
    }
}

#[tauri::command]
pub fn mcp_generate_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn load_config(conn: &Connection) -> McpConfig {
    let get = |key: &str| -> Option<String> {
        conn.query_row(
            "SELECT value FROM user_settings WHERE key=?1",
            [key],
            |row| row.get(0),
        )
        .ok()
        .and_then(|raw: String| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| Some(value.to_string()))
        })
    };
    McpConfig {
        enabled: get("mcp_enabled").as_deref() == Some("true"),
        port: get("mcp_port")
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_PORT),
        token: get("mcp_token").unwrap_or_default(),
    }
}

pub fn save_config(conn: &Connection, config: &McpConfig) -> Result<(), String> {
    for (key, value) in [
        ("mcp_enabled", json!(config.enabled)),
        ("mcp_port", json!(config.port.to_string())),
        ("mcp_token", json!(config.token)),
    ] {
        conn.execute(
            "INSERT INTO user_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value.to_string()],
        ).map_err(|error| error.to_string())?;
    }
    Ok(())
}
