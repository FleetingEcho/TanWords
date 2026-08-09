//! users.db — the web server's own credential store, kept entirely separate
//! from the app's vocabulary database: emails + argon2id password hashes,
//! signed JWT sessions (sha256'd at rest for revocation), and each user's Turso
//! connection (its token sealed with AES-256-GCM under TANWORDS_MASTER_KEY). Lives at
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
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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

#[derive(Clone, Serialize, Deserialize)]
struct JwtClaims {
    sub: i64,
    iat: i64,
    exp: i64,
    jti: String,
}

pub struct UsersDb {
    conn: tokio::sync::Mutex<libsql::Connection>,
    session_reader: libsql::Connection,
    cipher: Aes256Gcm,
    jwt_encoding_key: EncodingKey,
    jwt_decoding_key: DecodingKey,
    jwt_ttl_secs: i64,
}

impl UsersDb {
    /// `master_key` seals each user's Turso token at rest. Required: without
    /// it we'd be writing third-party DB credentials in plaintext.
    pub async fn open(path: &Path, master_key: [u8; 32], jwt_ttl_secs: i64) -> Result<Self, String> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let db = libsql::Builder::new_local(path.to_string_lossy().to_string())
            .build()
            .await
            .map_err(|e| format!("Failed to open users database: {e}"))?;
        let conn = db.connect().map_err(|e| e.to_string())?;
        let session_reader = db.connect().map_err(|e| e.to_string())?;
        conn.execute_batch(
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
        let _ = conn.execute("ALTER TABLE users ADD COLUMN active_db TEXT", ()).await;
        let _ = conn.execute("ALTER TABLE users ADD COLUMN app_lock_hash TEXT", ()).await;
        conn.execute(
            "UPDATE users SET active_db = CASE
                 WHEN turso_url IS NOT NULL AND turso_token_enc IS NOT NULL THEN 'turso'
                 ELSE 'local' END
             WHERE active_db IS NULL",
            (),
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
        let rows = conn
            .execute(
                "INSERT INTO users(email, password_hash, active_db) VALUES (?, ?, 'local')",
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
        let now = now_secs();
        let token = self.new_session_token(id, now)?;
        let token_hash = Self::hash_token(&token);
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO sessions(token_hash, user_id, last_seen_at, expires_at) VALUES (?, ?, ?, ?)",
            libsql::params![token_hash, id, now, now + self.jwt_ttl_secs],
        )
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
        let mut rows = self.session_reader
            .query(
                "SELECT s.user_id, s.expires_at, u.email
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
        let expires = row.get::<i64>(1).map_err(|e| e.to_string())?;
        let email = row.get::<String>(2).map_err(|e| e.to_string())?;
        drop(rows);
        if claims.sub != user_id || expires < now {
            let conn = self.conn.lock().await;
            let _ = conn
                .execute("DELETE FROM sessions WHERE token_hash = ?", libsql::params![token_hash.clone()])
                .await;
            return Ok(None);
        }
        // Opportunistic sweep of expired rows, ~1% of validations.
        if now % 37 == 0 {
            let conn = self.conn.lock().await;
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

    pub async fn app_lock_enabled(&self, user_id: i64) -> Result<bool, String> {
        let conn = self.conn.lock().await;
        let mut rows = conn
            .query("SELECT app_lock_hash FROM users WHERE id = ?", libsql::params![user_id])
            .await
            .map_err(|e| e.to_string())?;
        let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
            return Err("user not found".to_string());
        };
        Ok(row.get::<Option<String>>(0).map_err(|e| e.to_string())?.is_some())
    }

    pub async fn verify_app_lock(&self, user_id: i64, password: &str) -> Result<bool, String> {
        let existing = {
            let conn = self.conn.lock().await;
            let mut rows = conn
                .query("SELECT app_lock_hash FROM users WHERE id = ?", libsql::params![user_id])
                .await
                .map_err(|e| e.to_string())?;
            let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
                return Err("user not found".to_string());
            };
            row.get::<Option<String>>(0).map_err(|e| e.to_string())?
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
            let mut rows = conn
                .query("SELECT app_lock_hash FROM users WHERE id = ?", libsql::params![user_id])
                .await
                .map_err(|e| e.to_string())?;
            let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
                return Err("user not found".to_string());
            };
            row.get::<Option<String>>(0).map_err(|e| e.to_string())?
        };
        if let Some(hash) = existing {
            if !Self::verify_password(&hash, current.unwrap_or_default()) {
                return Err("Current password is incorrect".to_string());
            }
        }
        let hash = Self::hash_password(next)?;
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE users SET app_lock_hash = ? WHERE id = ?",
            libsql::params![hash, user_id],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn disable_app_lock(&self, user_id: i64, current: &str) -> Result<(), String> {
        let existing = {
            let conn = self.conn.lock().await;
            let mut rows = conn
                .query("SELECT app_lock_hash FROM users WHERE id = ?", libsql::params![user_id])
                .await
                .map_err(|e| e.to_string())?;
            let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
                return Err("user not found".to_string());
            };
            row.get::<Option<String>>(0).map_err(|e| e.to_string())?
        };
        if let Some(hash) = existing {
            if !Self::verify_password(&hash, current) {
                return Err("Current password is incorrect".to_string());
            }
        }
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE users SET app_lock_hash = NULL WHERE id = ?",
            libsql::params![user_id],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// The user's remembered Turso profile, independent of which database is
    /// currently selected.
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

    pub async fn active_turso_for(&self, user_id: i64) -> Result<Option<TursoProfile>, String> {
        let conn = self.conn.lock().await;
        let mut rows = conn
            .query("SELECT active_db FROM users WHERE id = ?", libsql::params![user_id])
            .await
            .map_err(|e| e.to_string())?;
        let active = rows
            .next()
            .await
            .map_err(|e| e.to_string())?
            .and_then(|row| row.get::<Option<String>>(0).ok().flatten())
            .unwrap_or_else(|| "local".to_string());
        drop(rows);
        drop(conn);
        if active == "turso" {
            self.turso_for(user_id).await
        } else {
            Ok(None)
        }
    }

    pub async fn set_active_db(&self, user_id: i64, source: &str) -> Result<(), String> {
        if source != "local" && source != "turso" {
            return Err("database source must be `local` or `turso`".to_string());
        }
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE users SET active_db = ? WHERE id = ?",
            libsql::params![source, user_id],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn set_turso(&self, user_id: i64, url: &str, token: &str) -> Result<(), String> {
        let enc = self.seal(token);
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE users SET turso_url = ?, turso_token_enc = ?, active_db = 'turso' WHERE id = ?",
            libsql::params![url, enc, user_id],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn clear_turso(&self, user_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE users SET turso_url = NULL, turso_token_enc = NULL, active_db = 'local' WHERE id = ?",
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

#[cfg(test)]
mod tests {
    use super::UsersDb;
    use std::time::Duration;

    async fn test_users(name: &str) -> (UsersDb, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("tanwords-{name}-{}", uuid::Uuid::new_v4()));
        let users = UsersDb::open(&dir.join("users.db"), [7; 32], 7 * 24 * 3600)
            .await
            .unwrap();
        (users, dir)
    }

    #[tokio::test]
    async fn jwt_session_is_valid_and_revocable() {
        let (users, dir) = test_users("jwt-test").await;
        let user_id = users.register("reader@example.com", "correct-horse").await.unwrap();
        let (_, token) = users
            .login("reader@example.com", "correct-horse")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(token.split('.').count(), 3);
        assert_eq!(users.validate(&token).await.unwrap().unwrap().id, user_id);

        // Ordinary API requests must not queue behind unrelated credential
        // writes. Holding the writer proves validation uses its read connection.
        let conn = users.conn.lock().await;
        let concurrent = tokio::time::timeout(Duration::from_millis(100), users.validate(&token))
            .await
            .expect("session validation waited for the users.db writer")
            .unwrap()
            .unwrap();
        assert_eq!(concurrent.id, user_id);
        drop(conn);

        let (_, second_token) = users
            .login("reader@example.com", "correct-horse")
            .await
            .unwrap()
            .unwrap();
        assert_ne!(token, second_token);

        let mut tampered = token.clone();
        tampered.push('x');
        assert!(users.validate(&tampered).await.unwrap().is_none());

        users.logout(&token).await.unwrap();
        assert!(users.validate(&token).await.unwrap().is_none());
        assert!(users.validate(&second_token).await.unwrap().is_some());

        drop(users);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn web_app_lock_is_per_user_and_requires_current_password() {
        let (users, dir) = test_users("app-lock-test").await;
        let first = users.register("locked@example.com", "account-password").await.unwrap();
        let second = users.register("other@example.com", "account-password").await.unwrap();

        assert!(!users.app_lock_enabled(first).await.unwrap());
        users.set_app_lock(first, None, "screen-lock").await.unwrap();
        assert!(users.app_lock_enabled(first).await.unwrap());
        assert!(!users.app_lock_enabled(second).await.unwrap());
        assert!(users.verify_app_lock(first, "screen-lock").await.unwrap());
        assert!(!users.verify_app_lock(first, "wrong").await.unwrap());

        assert!(users.set_app_lock(first, Some("wrong"), "replacement").await.is_err());
        users.set_app_lock(first, Some("screen-lock"), "replacement").await.unwrap();
        assert!(users.verify_app_lock(first, "replacement").await.unwrap());
        assert!(users.disable_app_lock(first, "wrong").await.is_err());
        users.disable_app_lock(first, "replacement").await.unwrap();
        assert!(!users.app_lock_enabled(first).await.unwrap());
        assert!(users.verify_app_lock(first, "anything").await.unwrap());

        drop(users);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn local_selection_preserves_turso_credentials() {
        let (users, dir) = test_users("db-source-test").await;
        let user_id = users.register("switcher@example.com", "correct-horse").await.unwrap();

        assert!(users.active_turso_for(user_id).await.unwrap().is_none());
        users.set_turso(user_id, "libsql://example.turso.io", "secret").await.unwrap();
        assert!(users.active_turso_for(user_id).await.unwrap().is_some());

        users.set_active_db(user_id, "local").await.unwrap();
        assert!(users.active_turso_for(user_id).await.unwrap().is_none());
        let remembered = users.turso_for(user_id).await.unwrap().unwrap();
        assert_eq!(remembered.url, "libsql://example.turso.io");
        assert_eq!(remembered.token, "secret");

        users.set_active_db(user_id, "turso").await.unwrap();
        assert!(users.active_turso_for(user_id).await.unwrap().is_some());
        users.clear_turso(user_id).await.unwrap();
        assert!(users.turso_for(user_id).await.unwrap().is_none());
        assert!(users.active_turso_for(user_id).await.unwrap().is_none());

        drop(users);
        let _ = std::fs::remove_dir_all(dir);
    }
}
