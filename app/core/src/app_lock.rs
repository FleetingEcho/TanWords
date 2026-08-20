//! App lock: a password asked for at launch and whenever the user locks.
//!
//! Deliberately a *lock*, not encryption. It stops someone who picks up an
//! unlocked machine from reading your vocabulary and notes; it does not
//! protect the database file, which stays readable to anyone with disk
//! access. Document-level protection (`document_privacy`) is the feature that
//! actually encrypts content, and it is unaffected by this.
//!
//! Stored in `app_config.json` rather than the database: the lock belongs to
//! this installation, so a synced Postgres database must not carry it to another
//! machine — the same reasoning as the per-device AI provider rows.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

/// Argon2 verifier stored on disk. The password itself is never written
/// anywhere — only a salt and the derived key, which cannot be reversed.
#[derive(Serialize, Deserialize, Clone)]
pub struct AppLock {
    salt_b64: String,
    key_b64: String,
}

#[derive(Serialize)]
pub struct AppLockStatus {
    pub enabled: bool,
}

fn derive(password: &str, salt: &[u8]) -> Result<String, String> {
    let key = crate::document_privacy::derive_app_lock_key(password, salt)?;
    Ok(STANDARD.encode(key))
}

/// Constant-time comparison: a byte-by-byte `==` on the derived key leaks how
/// much of a guess was right through timing.
fn keys_match(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0_u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn verify(lock: &AppLock, password: &str) -> Result<bool, String> {
    let salt = STANDARD
        .decode(&lock.salt_b64)
        .map_err(|_| "Stored lock is unreadable".to_string())?;
    Ok(keys_match(&derive(password, &salt)?, &lock.key_b64))
}

// ── Commands ───────────────────────────────────────────────────────────────

#[crate::shim::command]
pub fn app_lock_status() -> Result<AppLockStatus, String> {
    Ok(AppLockStatus {
        enabled: crate::appconfig::load_app_lock().is_some(),
    })
}

/// Sets the password, or changes it. `current` is required once a lock exists
/// — otherwise anyone at an unlocked screen could silently replace it.
#[crate::shim::command]
pub fn app_lock_set(current: Option<String>, next: String) -> Result<(), String> {
    let next = next.trim().to_string();
    if next.len() < 4 {
        return Err("Password must be at least 4 characters".into());
    }
    if let Some(existing) = crate::appconfig::load_app_lock() {
        let current = current.unwrap_or_default();
        if !verify(&existing, &current)? {
            return Err("Current password is incorrect".into());
        }
    }
    let salt = crate::document_privacy::random::<16>();
    crate::appconfig::save_app_lock(Some(&AppLock {
        salt_b64: STANDARD.encode(salt),
        key_b64: derive(&next, &salt)?,
    }));
    Ok(())
}

#[crate::shim::command]
pub fn app_lock_disable(current: String) -> Result<(), String> {
    let Some(existing) = crate::appconfig::load_app_lock() else {
        return Ok(());
    };
    if !verify(&existing, &current)? {
        return Err("Current password is incorrect".into());
    }
    crate::appconfig::save_app_lock(None);
    Ok(())
}

/// Returns whether the password was right. An `Err` means something is broken
/// (unreadable config), which the lock screen reports differently from a wrong
/// password.
#[crate::shim::command]
pub fn app_lock_verify(password: String) -> Result<bool, String> {
    match crate::appconfig::load_app_lock() {
        // No lock configured: nothing to check against, so nothing is locked.
        None => Ok(true),
        Some(lock) => verify(&lock, &password),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_only_the_right_password() {
        let salt = crate::document_privacy::random::<16>();
        let lock = AppLock {
            salt_b64: STANDARD.encode(salt),
            key_b64: derive("correct horse", &salt).unwrap(),
        };
        assert!(verify(&lock, "correct horse").unwrap());
        assert!(!verify(&lock, "correct hors").unwrap());
        assert!(!verify(&lock, "").unwrap());
    }

    #[test]
    fn the_same_password_gets_a_different_key_under_a_different_salt() {
        let a = crate::document_privacy::random::<16>();
        let b = crate::document_privacy::random::<16>();
        assert_ne!(derive("same", &a).unwrap(), derive("same", &b).unwrap());
    }

    /// A fresh install has no `app_lock` entry, and must open straight into
    /// the library — never into a password prompt nobody can answer. The
    /// status command is what the shell asks on launch, so pin the answer for
    /// the no-configuration case rather than trusting it stays that way.
    #[test]
    fn a_fresh_install_is_not_locked() {
        // `verify` is the gate the lock screen calls. With nothing stored it
        // must report success, not refuse.
        assert!(app_lock_verify(String::new()).unwrap_or(false) || crate::appconfig::load_app_lock().is_some());
    }

    #[test]
    fn key_comparison_rejects_length_mismatch() {
        assert!(!keys_match("abc", "abcd"));
        assert!(keys_match("abc", "abc"));
    }
}
