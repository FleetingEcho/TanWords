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
    /// Handed to the people you invite, and gating registration only. Unset =
    /// registration is closed (login still works for existing accounts).
    pub invite_key: Option<String>,
    /// Gates password reset — deliberately NOT the invite key.
    ///
    /// The invite key has to be given to every person you invite, or they
    /// cannot sign up. When the same key also authorised "set any account's
    /// password by email", every invited user held the ability to take over
    /// every other account, including yours: reset the owner's password, log
    /// in as them, read their database. Splitting them makes the invite key
    /// what it says it is — permission to create *an* account, not power over
    /// existing ones. Unset = password reset is closed.
    pub admin_key: Option<String>,
    /// True when this process sits behind a reverse proxy whose
    /// `X-Forwarded-For` can be believed. Off by default — see `from_env`.
    pub trust_proxy: bool,
    /// AES-256-GCM key sealing each user's stored Postgres password, the
    /// core's provider/device key on headless servers, and the HMAC key
    /// signing web JWTs. 32 bytes, hex or base64.
    pub master_key: [u8; 32],
    /// Absolute JWT lifetime. Defaults to one week.
    pub jwt_ttl_secs: i64,
    /// The same hostname/IP Caddy is configured with (`deploy/.env`'s
    /// `TANWORDS_PUBLIC_HOST`) — needed to build the connection string a
    /// user's self-provisioned Postgres role/database is reachable at.
    /// Optional: everything else in this server works without it, only that
    /// one feature needs it set.
    pub public_host: Option<String>,
    /// Host/port of the shared `postgres` service (`server/postgres_remote`)
    /// — defaults match `deploy/compose.yml`'s internal service name.
    pub postgres_host: String,
    pub postgres_port: u16,
    /// Admin credential for provisioning/rotating per-user roles+databases
    /// in the shared `postgres` service. Unset in a deployment that never
    /// enables the Postgres remote-access feature.
    pub postgres_superuser_password: Option<String>,
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
    /// Fails fast: no master key, no server. Sealing user-owned Postgres
    /// passwords under a well-known/default key would be worse than
    /// refusing to run.
    pub fn from_env() -> Result<Self, String> {
        let master_raw = env("TANWORDS_MASTER_KEY").ok_or(
            "TANWORDS_MASTER_KEY is not set — the web server refuses to start without it.\n  \
             It seals user Postgres passwords and AI provider keys on disk.\n  \
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
            admin_key: env("TANWORDS_ADMIN_KEY"),
            jwt_ttl_secs: env("TANWORDS_JWT_TTL_SECS")
                .map(|raw| {
                    raw.parse::<i64>()
                        .ok()
                        .filter(|seconds| *seconds > 0)
                        .ok_or_else(|| "TANWORDS_JWT_TTL_SECS must be a positive integer".to_string())
                })
                .transpose()?
                .unwrap_or(7 * 24 * 3600),
            // Reverse proxies replace the peer address with their own, so the
            // per-IP limiter needs to be told when to read X-Forwarded-For —
            // and told explicitly, because a server that trusts that header
            // unconditionally lets any caller forge their way around the
            // limiter by sending one.
            trust_proxy: env("TANWORDS_TRUST_PROXY")
                .map(|v| matches!(v.trim(), "1" | "true" | "yes"))
                .unwrap_or(false),
            master_key,
            public_host: env("TANWORDS_PUBLIC_HOST"),
            postgres_host: env("TANWORDS_POSTGRES_HOST").unwrap_or_else(|| "postgres".to_string()),
            postgres_port: env("TANWORDS_POSTGRES_PORT")
                .and_then(|p| p.parse().ok())
                .unwrap_or(5432),
            postgres_superuser_password: env("TANWORDS_POSTGRES_SUPERUSER_PASSWORD"),
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
