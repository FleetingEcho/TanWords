//! users.db — the web server's own credential store, kept entirely separate
//! from the app's vocabulary database: emails + argon2id password hashes,
//! session tokens (sha256'd at rest), and each user's Turso connection (its
//! token sealed with AES-256-GCM under TANWORDS_MASTER_KEY). Lives at
//! `<data_dir>/users.db`; the app data itself is per-user under
//! `<data_dir>/users/<id>/` (see runtime.rs).
//!
//! One libsql connection behind a Mutex: writes need serialization anyway
//! and the traffic level here is a handful of invited users, not the public
//! internet.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Idle sessions die after this; any valid use extends them (throttled so we
/// don't rewrite the row on every request).
const SESSION_TTL_SECS: i64 = 30 * 24 * 3600;
const SESSION_EXTEND_AFTER_SECS: i64 = 6 * 3600;

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

pub struct UsersDb {
    conn: tokio::sync::Mutex<libsql::Connection>,
    cipher: Aes256Gcm,
}

impl UsersDb {
    /// `master_key` seals each user's Turso token at rest. Required: without
    /// it we'd be writing third-party DB credentials in plaintext.
    pub async fn open(path: &Path, master_key: [u8; 32]) -> Result<Self, String> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let db = libsql::Builder::new_local(path.to_string_lossy().to_string())
            .build()
            .await
            .map_err(|e| format!("Failed to open users database: {e}"))?;
        let conn = db.connect().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS users(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                turso_url TEXT,
                turso_token_enc TEXT
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
        Ok(Self {
            conn: tokio::sync::Mutex::new(conn),
            cipher: Aes256Gcm::new(&master_key.into()),
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
        let rows = conn
            .execute(
                "INSERT INTO users(email, password_hash) VALUES (?, ?)",
                libsql::params![email, hash],
            )
            .await;
        match rows {
            Ok(_) => conn
                .query("SELECT last_insert_rowid()", ())
                .await
                .map_err(|e| e.to_string())?
                .next()
                .await
                .map_err(|e| e.to_string())?
                .and_then(|r| r.get::<i64>(0).ok())
                .ok_or_else(|| "failed to read new user id".to_string()),
            Err(e) if e.to_string().contains("UNIQUE") => {
                Err("email already registered".to_string())
            }
            Err(e) => Err(e.to_string()),
        }
    }

    /// (user_id, password_hash) — callers verify the hash so timing comes from argon2, not the lookup.
    async fn lookup_by_email(&self, email: &str) -> Result<Option<(i64, String)>, String> {
        let conn = self.conn.lock().await;
        let mut rows = conn
            .query(
                "SELECT id, password_hash FROM users WHERE email = ?",
                libsql::params![email.trim().to_lowercase()],
            )
            .await
            .map_err(|e| e.to_string())?;
        match rows.next().await.map_err(|e| e.to_string())? {
            Some(row) => {
                let id = row.get::<i64>(0).map_err(|e| e.to_string())?;
                let hash = row.get::<String>(1).map_err(|e| e.to_string())?;
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
        let token = Self::new_session_token();
        let token_hash = Self::hash_token(&token);
        let now = now_secs();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO sessions(token_hash, user_id, last_seen_at, expires_at) VALUES (?, ?, ?, ?)",
            libsql::params![token_hash, id, now, now + SESSION_TTL_SECS],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(Some((id, token)))
    }

    pub fn new_session_token() -> String {
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    pub fn hash_token(token: &str) -> String {
        let digest = Sha256::digest(token.as_bytes());
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
    }

    /// Sliding expiry: valid sessions extend when they're halfway stale, so an
    /// active user never logs in again and an abandoned one dies on schedule.
    pub async fn validate(&self, token: &str) -> Result<Option<UserRecord>, String> {
        let token_hash = Self::hash_token(token);
        let now = now_secs();
        let conn = self.conn.lock().await;
        let mut rows = conn
            .query(
                "SELECT s.user_id, s.last_seen_at, s.expires_at, u.email
                 FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ?",
                libsql::params![token_hash.clone()],
            )
            .await
            .map_err(|e| e.to_string())?;
        let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
            return Ok(None);
        };
        let user_id = row.get::<i64>(0).map_err(|e| e.to_string())?;
        let last_seen = row.get::<i64>(1).map_err(|e| e.to_string())?;
        let expires = row.get::<i64>(2).map_err(|e| e.to_string())?;
        let email = row.get::<String>(3).map_err(|e| e.to_string())?;
        if expires < now {
            let _ = conn
                .execute("DELETE FROM sessions WHERE token_hash = ?", libsql::params![token_hash.clone()])
                .await;
            return Ok(None);
        }
        if now - last_seen > SESSION_EXTEND_AFTER_SECS {
            let _ = conn
                .execute(
                    "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?",
                    libsql::params![now, now + SESSION_TTL_SECS, token_hash],
                )
                .await;
        }
        // Opportunistic sweep of expired rows, ~1% of validations.
        if now % 37 == 0 {
            let _ = conn
                .execute("DELETE FROM sessions WHERE expires_at < ?", libsql::params![now])
                .await;
        }
        Ok(Some(UserRecord { id: user_id, email }))
    }

    pub async fn logout(&self, token: &str) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            libsql::params![Self::hash_token(token)],
        )
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
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            libsql::params![hash, id],
        )
        .await
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sessions WHERE user_id = ?", libsql::params![id])
            .await
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// The user's Turso profile, decrypted. `None` = this user is on their
    /// per-user local database.
    pub async fn turso_for(&self, user_id: i64) -> Result<Option<TursoProfile>, String> {
        let conn = self.conn.lock().await;
        let mut rows = conn
            .query(
                "SELECT turso_url, turso_token_enc FROM users WHERE id = ?",
                libsql::params![user_id],
            )
            .await
            .map_err(|e| e.to_string())?;
        let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
            return Ok(None);
        };
        let url = row.get::<Option<String>>(0).map_err(|e| e.to_string())?;
        let enc = row.get::<Option<String>>(1).map_err(|e| e.to_string())?;
        match (url, enc) {
            (Some(url), Some(enc)) => {
                let token = self
                    .unseal(&enc)
                    .ok_or_else(|| "stored Turso token failed to decrypt (master key changed?)".to_string())?;
                Ok(Some(TursoProfile { url, token }))
            }
            _ => Ok(None),
        }
    }

    pub async fn set_turso(&self, user_id: i64, url: &str, token: &str) -> Result<(), String> {
        let enc = self.seal(token);
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE users SET turso_url = ?, turso_token_enc = ? WHERE id = ?",
            libsql::params![url, enc, user_id],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn clear_turso(&self, user_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE users SET turso_url = NULL, turso_token_enc = NULL WHERE id = ?",
            libsql::params![user_id],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Mirrors the core's RememberedTursoConnection shape (never the token).
    pub async fn remembered_turso(&self, user_id: i64) -> Result<(Option<String>, bool), String> {
        let conn = self.conn.lock().await;
        let mut rows = conn
            .query(
                "SELECT turso_url, turso_token_enc FROM users WHERE id = ?",
                libsql::params![user_id],
            )
            .await
            .map_err(|e| e.to_string())?;
        let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
            return Ok((None, false));
        };
        let url = row.get::<Option<String>>(0).map_err(|e| e.to_string())?;
        let has_token = row
            .get::<Option<String>>(1)
            .map_err(|e| e.to_string())?
            .is_some();
        Ok((url, has_token))
    }
}
