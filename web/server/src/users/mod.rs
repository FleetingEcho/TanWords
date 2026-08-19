//! users.db — the web server's own credential store, kept entirely separate
//! from the app's vocabulary database: emails + argon2id password hashes,
//! signed JWT sessions (sha256'd at rest for revocation), and each user's Turso
//! connection (its token sealed with AES-256-GCM under TANWORDS_MASTER_KEY). Lives at
//! `<data_dir>/users.db`; the app data itself is per-user under
//! `<data_dir>/users/<id>/` (see runtime.rs).
//!
//! One SeaORM (sqlx-sqlite) connection behind a Mutex: writes need
//! serialization anyway and the traffic level here is a handful of invited
//! users, not the public internet. Sharing the core's sea-orm/sqlx-sqlite
//! engine keeps a single sqlite3 in the link graph — the old libsql dep
//! bundled its own copy, which collided with sqlx-sqlite's once the core
//! migrated off libsql.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use base64::Engine;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use sea_orm::sea_query::Value as SqValue;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

mod profiles;

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A validated session's view of a user.
pub struct UserRecord {
    pub id: i64,
    pub email: String,
}

/// What the runtime pool needs to open this user's database.
pub struct TursoProfile {
    pub url: String,
    pub token: String,
}

/// A user's dedicated sqld container: which firewall-range port it's on, its
/// signing keypair (PKCS8 DER, decrypted), and whether it's currently meant
/// to be running.
pub struct SqldRemoteProfile {
    pub port: i64,
    pub key_der: Vec<u8>,
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct JwtClaims {
    sub: i64,
    iat: i64,
    exp: i64,
    jti: String,
}

pub struct UsersDb {
    conn: tokio::sync::Mutex<DatabaseConnection>,
    session_reader: DatabaseConnection,
    cipher: Aes256Gcm,
    jwt_encoding_key: EncodingKey,
    jwt_decoding_key: DecodingKey,
    jwt_ttl_secs: i64,
}

/// Coerce a Rust value into a sea-query `Value` for bound parameters. Only the
/// handful of types users.db binds are needed (i64, String, &str); anything
/// else is a programming error caught at compile time. NULLs are bound by
/// passing the typed None directly (e.g. `Value::String(None)`).
trait IntoSqValue {
    fn into_sq(self) -> SqValue;
}
impl IntoSqValue for i64 {
    fn into_sq(self) -> SqValue {
        SqValue::BigInt(Some(self))
    }
}
impl IntoSqValue for String {
    fn into_sq(self) -> SqValue {
        SqValue::String(Some(self))
    }
}
impl IntoSqValue for &str {
    fn into_sq(self) -> SqValue {
        SqValue::String(Some(self.to_string()))
    }
}
impl IntoSqValue for &String {
    fn into_sq(self) -> SqValue {
        SqValue::String(Some(self.clone()))
    }
}

/// Build a parameterized `Statement` from a SQL string and a heterogenous
/// list of bind values, mirroring the ergonomics of libsql's `params!` macro.
fn stmt<Params>(sql: &str, params: Params) -> Statement
where
    Params: IntoIterator<Item = SqValue>,
{
    Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Sqlite,
        sql,
        params.into_iter().collect::<Vec<_>>(),
    )
}

impl UsersDb {
    /// `master_key` seals each user's Turso token at rest. Required: without
    /// it we'd be writing third-party DB credentials in plaintext.
    pub async fn open(path: &Path, master_key: [u8; 32], jwt_ttl_secs: i64) -> Result<Self, String> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // `mode=rwc` so sqlx creates the file if it doesn't exist yet (mirrors
        // libsql's Builder::new_local, which created the file on connect).
        let url = format!("sqlite://{}?mode=rwc", path.to_string_lossy());
        let mut opts = sea_orm::ConnectOptions::new(url);
        opts.max_connections(1).min_connections(1);
        let conn = Database::connect(opts)
            .await
            .map_err(|e| format!("Failed to open users database: {e}"))?;
        let session_reader = conn.clone();
        conn.execute_unprepared(
            "CREATE TABLE IF NOT EXISTS users(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                turso_url TEXT,
                turso_token_enc TEXT,
                active_db TEXT NOT NULL DEFAULT 'local',
                app_lock_hash TEXT
            );
            CREATE TABLE IF NOT EXISTS sessions(
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                last_seen_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);",
        )
        .await
        .map_err(|e| format!("users.db migration failed: {e}"))?;
        // Existing installations predate the independent active-db selector.
        // Preserve their current behaviour: accounts with saved Turso
        // credentials remain on Turso; all others start local. The UPDATE only
        // touches NULL rows, so a user's later explicit local choice survives
        // every restart.
        let _ = conn
            .execute_unprepared("ALTER TABLE users ADD COLUMN active_db TEXT")
            .await;
        let _ = conn
            .execute_unprepared("ALTER TABLE users ADD COLUMN app_lock_hash TEXT")
            .await;
        // A per-user dedicated sqld container a desktop app can connect to
        // directly, sharing this account's actual database live — separate
        // from the turso_* columns above (a user-supplied external Turso/
        // self-hosted target), this is a container the server itself
        // provisions. `sqld_key_enc` seals the Ed25519 keypair (PKCS8 DER,
        // base64'd then AES-GCM sealed) used to sign that container's
        // bearer tokens; `sqld_port` is this user's slot in the fixed,
        // pre-opened firewall port range (see deploy/deploy-server.sh).
        let _ = conn
            .execute_unprepared("ALTER TABLE users ADD COLUMN sqld_key_enc TEXT")
            .await;
        let _ = conn
            .execute_unprepared("ALTER TABLE users ADD COLUMN sqld_port INTEGER")
            .await;
        let _ = conn
            .execute_unprepared(
                "ALTER TABLE users ADD COLUMN sqld_enabled INTEGER NOT NULL DEFAULT 0",
            )
            .await;
        conn.execute_unprepared(
            "UPDATE users SET active_db = CASE
                 WHEN turso_url IS NOT NULL AND turso_token_enc IS NOT NULL THEN 'turso'
                 ELSE 'local' END
             WHERE active_db IS NULL",
        )
        .await
        .map_err(|e| format!("users.db active-db migration failed: {e}"))?;
        Ok(Self {
            conn: tokio::sync::Mutex::new(conn),
            session_reader,
            cipher: Aes256Gcm::new(&master_key.into()),
            jwt_encoding_key: EncodingKey::from_secret(&master_key),
            jwt_decoding_key: DecodingKey::from_secret(&master_key),
            jwt_ttl_secs,
        })
    }

    pub fn hash_password(password: &str) -> Result<String, String> {
        let salt = SaltString::generate(&mut rand::rngs::OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| e.to_string())
    }

    fn verify_password(hash: &str, password: &str) -> bool {
        match PasswordHash::new(hash) {
            Ok(parsed) => Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok(),
            Err(_) => false,
        }
    }

    fn seal(&self, plaintext: &str) -> String {
        let mut nonce = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let ct = self
            .cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
            .expect("aes-gcm encrypt infaillible for in-memory data");
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ct);
        base64::engine::general_purpose::STANDARD.encode(out)
    }

    fn unseal(&self, encoded: &str) -> Option<String> {
        let raw = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
        let (nonce, ct) = raw.split_at_checked(12)?;
        let plain = self
            .cipher
            .decrypt(Nonce::from_slice(nonce), ct)
            .ok()?;
        String::from_utf8(plain).ok()
    }

    /// Email uniqueness error is mapped to a stable string the frontend shows verbatim.
    pub async fn register(&self, email: &str, password: &str) -> Result<i64, String> {
        let email = email.trim().to_lowercase();
        let hash = Self::hash_password(password)?;
        let conn = self.conn.lock().await;
        let res = conn
            .execute_raw(stmt(
                "INSERT INTO users(email, password_hash, active_db) VALUES (?, ?, 'local')",
                [email.into_sq(), hash.into_sq()],
            ))
            .await;
        match res {
            Ok(_) => {
                let id = conn
                    .query_one_raw(stmt("SELECT last_insert_rowid()", []))
                    .await
                    .map_err(|e| e.to_string())?
                    .and_then(|r| r.try_get_by_index::<i64>(0).ok())
                    .ok_or_else(|| "failed to read new user id".to_string())?;
                Ok(id)
            }
            Err(e) if e.to_string().contains("UNIQUE") => {
                Err("email already registered".to_string())
            }
            Err(e) => Err(e.to_string()),
        }
    }

    /// (user_id, password_hash) — callers verify the hash so timing comes from argon2, not the lookup.
    async fn lookup_by_email(&self, email: &str) -> Result<Option<(i64, String)>, String> {
        let conn = self.conn.lock().await;
        let row = conn
            .query_one_raw(stmt(
                "SELECT id, password_hash FROM users WHERE email = ?",
                [email.trim().to_lowercase().into_sq()],
            ))
            .await
            .map_err(|e| e.to_string())?;
        match row {
            Some(r) => {
                let id = r.try_get_by_index::<i64>(0).map_err(|e| e.to_string())?;
                let hash = r.try_get_by_index::<String>(1).map_err(|e| e.to_string())?;
                Ok(Some((id, hash)))
            }
            None => Ok(None),
        }
    }

    /// Login + session creation in one: returns the raw bearer token.
    /// Always runs an argon2 verify — even for unknown emails (dummy hash) —
    /// so the response time doesn't reveal whether the account exists.
    pub async fn login(&self, email: &str, password: &str) -> Result<Option<(i64, String)>, String> {
        let (id, hash) = match self.lookup_by_email(email).await? {
            Some(found) => found,
            None => (
                -1,
                // precomputed argon2id of a random string; timing equalizer only
                Self::hash_password("dummy-password-for-timing").unwrap_or_default(),
            ),
        };
        if id < 0 || !Self::verify_password(&hash, password) {
            return Ok(None);
        }
        let now = now_secs();
        let token = self.new_session_token(id, now)?;
        let token_hash = Self::hash_token(&token);
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "INSERT INTO sessions(token_hash, user_id, last_seen_at, expires_at) VALUES (?, ?, ?, ?)",
            [
                token_hash.into_sq(),
                id.into_sq(),
                now.into_sq(),
                (now + self.jwt_ttl_secs).into_sq(),
            ],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(Some((id, token)))
    }

    fn new_session_token(&self, user_id: i64, now: i64) -> Result<String, String> {
        let mut nonce = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        encode(
            &Header::new(Algorithm::HS256),
            &JwtClaims {
                sub: user_id,
                iat: now,
                exp: now + self.jwt_ttl_secs,
                jti: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(nonce),
            },
            &self.jwt_encoding_key,
        )
        .map_err(|e| format!("failed to issue JWT: {e}"))
    }

    pub fn hash_token(token: &str) -> String {
        let digest = Sha256::digest(token.as_bytes());
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
    }

    /// Validates both the signed JWT and its revocable server-side session row.
    pub async fn validate(&self, token: &str) -> Result<Option<UserRecord>, String> {
        let validation = Validation::new(Algorithm::HS256);
        let claims = match decode::<JwtClaims>(token, &self.jwt_decoding_key, &validation) {
            Ok(data) => data.claims,
            Err(_) => return Ok(None),
        };
        let token_hash = Self::hash_token(token);
        let now = now_secs();
        // Session checks are read-heavy and sit in front of every protected
        // endpoint. Keep them off the serialized credential-write connection,
        // while still consulting the database on every request so revocation
        // remains immediate across multiple server processes.
        let row = self
            .session_reader
            .query_one_raw(stmt(
                "SELECT s.user_id, s.expires_at, u.email
                 FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ?",
                [token_hash.clone().into_sq()],
            ))
            .await
            .map_err(|e| e.to_string())?;
        let Some(r) = row else {
            return Ok(None);
        };
        let user_id = r.try_get_by_index::<i64>(0).map_err(|e| e.to_string())?;
        let expires = r.try_get_by_index::<i64>(1).map_err(|e| e.to_string())?;
        let email = r.try_get_by_index::<String>(2).map_err(|e| e.to_string())?;
        if claims.sub != user_id || expires < now {
            let conn = self.conn.lock().await;
            let _ = conn
                .execute_raw(stmt(
                    "DELETE FROM sessions WHERE token_hash = ?",
                    [token_hash.clone().into_sq()],
                ))
                .await;
            return Ok(None);
        }
        // Opportunistic sweep of expired rows, ~1% of validations.
        if now % 37 == 0 {
            let conn = self.conn.lock().await;
            let _ = conn
                .execute_raw(stmt(
                    "DELETE FROM sessions WHERE expires_at < ?",
                    [now.into_sq()],
                ))
                .await;
        }
        Ok(Some(UserRecord { id: user_id, email }))
    }

    pub async fn logout(&self, token: &str) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "DELETE FROM sessions WHERE token_hash = ?",
            [Self::hash_token(token).into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Every session of this user dies with the password change.
    pub async fn reset_password(&self, email: &str, new_password: &str) -> Result<bool, String> {
        let Some((id, _)) = self.lookup_by_email(email).await? else {
            return Ok(false);
        };
        let hash = Self::hash_password(new_password)?;
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            [hash.into_sq(), id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        conn.execute_raw(stmt(
            "DELETE FROM sessions WHERE user_id = ?",
            [id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(true)
    }

    pub async fn app_lock_enabled(&self, user_id: i64) -> Result<bool, String> {
        let conn = self.conn.lock().await;
        let row = conn
            .query_one_raw(stmt(
                "SELECT app_lock_hash FROM users WHERE id = ?",
                [user_id.into_sq()],
            ))
            .await
            .map_err(|e| e.to_string())?;
        let Some(r) = row else {
            return Err("user not found".to_string());
        };
        Ok(r
            .try_get_by_index::<Option<String>>(0)
            .map_err(|e| e.to_string())?
            .is_some())
    }

    pub async fn verify_app_lock(&self, user_id: i64, password: &str) -> Result<bool, String> {
        let existing = {
            let conn = self.conn.lock().await;
            let row = conn
                .query_one_raw(stmt(
                    "SELECT app_lock_hash FROM users WHERE id = ?",
                    [user_id.into_sq()],
                ))
                .await
                .map_err(|e| e.to_string())?;
            let Some(r) = row else {
                return Err("user not found".to_string());
            };
            r.try_get_by_index::<Option<String>>(0)
                .map_err(|e| e.to_string())?
        };
        match existing {
            Some(hash) => Ok(Self::verify_password(&hash, password)),
            None => Ok(true),
        }
    }

    pub async fn set_app_lock(
        &self,
        user_id: i64,
        current: Option<&str>,
        next: &str,
    ) -> Result<(), String> {
        let next = next.trim();
        if next.len() < 4 {
            return Err("Password must be at least 4 characters".to_string());
        }
        let existing = {
            let conn = self.conn.lock().await;
            let row = conn
                .query_one_raw(stmt(
                    "SELECT app_lock_hash FROM users WHERE id = ?",
                    [user_id.into_sq()],
                ))
                .await
                .map_err(|e| e.to_string())?;
            let Some(r) = row else {
                return Err("user not found".to_string());
            };
            r.try_get_by_index::<Option<String>>(0)
                .map_err(|e| e.to_string())?
        };
        if let Some(hash) = existing {
            if !Self::verify_password(&hash, current.unwrap_or_default()) {
                return Err("Current password is incorrect".to_string());
            }
        }
        let hash = Self::hash_password(next)?;
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET app_lock_hash = ? WHERE id = ?",
            [hash.into_sq(), user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn disable_app_lock(&self, user_id: i64, current: &str) -> Result<(), String> {
        let existing = {
            let conn = self.conn.lock().await;
            let row = conn
                .query_one_raw(stmt(
                    "SELECT app_lock_hash FROM users WHERE id = ?",
                    [user_id.into_sq()],
                ))
                .await
                .map_err(|e| e.to_string())?;
            let Some(r) = row else {
                return Err("user not found".to_string());
            };
            r.try_get_by_index::<Option<String>>(0)
                .map_err(|e| e.to_string())?
        };
        if let Some(hash) = existing {
            if !Self::verify_password(&hash, current) {
                return Err("Current password is incorrect".to_string());
            }
        }
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET app_lock_hash = NULL WHERE id = ?",
            [user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "../users_tests.rs"]
mod tests;
