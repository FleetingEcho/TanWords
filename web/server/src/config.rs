//! Process configuration, entirely environment-driven.

use std::path::PathBuf;

pub struct Config {
    /// Bind address. `127.0.0.1` (default) for local-only use; `0.0.0.0` to
    /// serve the LAN or sit behind an HTTPS reverse proxy.
    pub host: String,
    pub port: u16,
    /// Root for users.db, per-user databases/replicas, uploads, exports.
    /// Propagated into the core via the `TANWORDS_DATA_DIR` env var before
    /// any core code touches the filesystem.
    pub data_dir: PathBuf,
    /// Optional external built frontend to serve at `/`. When unset the
    /// renderer is served from the embedded copy compiled into the binary.
    pub web_dist: Option<PathBuf>,
    /// Owner-only key gating register + password reset. Unset = those doors
    /// are closed (login still works for existing accounts).
    pub invite_key: Option<String>,
    /// AES-256-GCM key sealing each user's stored Turso token, and the core's
    /// provider/device key on headless servers. 32 bytes, hex or base64.
    pub master_key: [u8; 32],
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

/// The same default the core computes when TANWORDS_DATA_DIR is unset, so
/// server-side files (uploads, exports) land next to the databases.
fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tanwords")
}

fn parse_master_key(raw: &str) -> Result<[u8; 32], String> {
    // Hex first, then base64 — either spelling of 32 bytes works.
    let raw = raw.trim();
    let bytes: Vec<u8> = if raw.len() == 64 && raw.chars().all(|c| c.is_ascii_hexdigit()) {
        (0..32)
            .map(|i| u8::from_str_radix(&raw[i * 2..i * 2 + 2], 16).map_err(|e| e.to_string()))
            .collect::<Result<Vec<u8>, String>>()?
    } else {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(raw)
            .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(raw))
            .map_err(|e| format!("TANWORDS_MASTER_KEY is neither hex nor base64: {e}"))?
    };
    bytes
        .try_into()
        .map_err(|_| "TANWORDS_MASTER_KEY must decode to exactly 32 bytes".to_string())
}

impl Config {
    /// Fails fast: no master key, no server. Sealing user-owned Turso tokens
    /// under a well-known/default key would be worse than refusing to run.
    pub fn from_env() -> Result<Self, String> {
        let master_raw = env("TANWORDS_MASTER_KEY").ok_or(
            "TANWORDS_MASTER_KEY is not set — the web server refuses to start without it.\n  \
             It seals user Turso tokens and AI provider keys on disk.\n  \
             Generate one with: openssl rand -hex 32",
        )?;
        let master_key = parse_master_key(&master_raw)?;

        Ok(Self {
            host: env("TANWORDS_HOST").unwrap_or_else(|| "127.0.0.1".to_string()),
            port: env("TANWORDS_PORT")
                .and_then(|p| p.parse().ok())
                .unwrap_or(8740),
            data_dir: env("TANWORDS_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(default_data_dir),
            web_dist: env("TANWORDS_WEB_DIST").map(PathBuf::from),
            invite_key: env("TANWORDS_INVITE_KEY"),
            master_key,
        })
    }

    /// Pushes the data dir into the core's view: `app_data_dir()` and the
    /// file-backed `secrets` fallback read these env vars. Idempotent for
    /// values already set. Must run before any core code runs.
    pub fn apply_to_env(&self) {
        std::env::set_var("TANWORDS_DATA_DIR", &self.data_dir);
        if env("TANWORDS_SECRET_FILE_DIR").is_none() {
            std::env::set_var("TANWORDS_SECRET_FILE_DIR", &self.data_dir);
        }
    }
}
