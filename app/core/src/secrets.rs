/// All keychain keys reachable from `secret_get`/`secret_set` must start with
/// this prefix — prevents the webview from reading arbitrary keychain entries,
/// including the ones below, which are written by name from Rust only.
const ALLOWED_PREFIX: &str = "apikey_";

/// Turso auth token for the active connection profile. Outside `ALLOWED_PREFIX`
/// on purpose: the UI can *set* it (via `db_connect_turso`) but has no way to
/// read it back out afterwards.
const TURSO_TOKEN_KEY: &str = "turso_auth_token";

/// Master key that seals `ai_providers.api_key_enc`. Like the Turso token it
/// sits outside `ALLOWED_PREFIX` deliberately: the webview must never be able
/// to read it, or storing the provider keys encrypted would buy nothing.
const DEVICE_KEY: &str = "device_provider_key";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("tanwords", key).map_err(|e| e.to_string())
}

/// Headless-server override: when `TANWORDS_SECRET_FILE_DIR` is set, secrets
/// that the desktop keeps in the OS keychain live as 0600 files under that
/// directory instead (a container or VPS has no usable Secret Service).
/// Unset means "use the keychain" — the desktop path, unchanged.
fn secret_file(name: &str) -> Option<std::path::PathBuf> {
    let dir = std::env::var("TANWORDS_SECRET_FILE_DIR").ok()?;
    if dir.trim().is_empty() {
        return None;
    }
    Some(std::path::PathBuf::from(dir).join(name))
}

fn read_secret_file(path: &std::path::Path) -> Option<String> {
    let value = std::fs::read_to_string(path).ok()?;
    let value = value.trim_end_matches(['\r', '\n']);
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// Writes with owner-only permissions; the file holds live credentials.
fn write_secret_file(path: &std::path::Path, value: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, value).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 32 raw bytes out of a hex or (standard) base64 encoding, whichever the
/// operator chose — `TANWORDS_MASTER_KEY` accepts either so it can be typed
/// from memory of either format.
fn decode_32(encoded: &str) -> Option<[u8; 32]> {
    let s = encoded.trim();
    let hex_decode = |s: &str| -> Option<Vec<u8>> {
        if s.len() % 2 != 0 {
            return None;
        }
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
            .collect()
    };
    let raw = hex_decode(s).or_else(|| {
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s.as_bytes()).ok()
    })?;
    raw.try_into().ok()
}

pub fn turso_token_get() -> Option<String> {
    if let Some(path) = secret_file("tanwords_turso_token") {
        return read_secret_file(&path);
    }
    entry(TURSO_TOKEN_KEY).ok()?.get_password().ok()
}

pub fn turso_token_set(token: &str) -> Result<(), String> {
    if let Some(path) = secret_file("tanwords_turso_token") {
        return write_secret_file(&path, token);
    }
    entry(TURSO_TOKEN_KEY)?
        .set_password(token)
        .map_err(|e| e.to_string())
}

pub fn turso_token_clear() {
    if let Some(path) = secret_file("tanwords_turso_token") {
        let _ = std::fs::remove_file(path);
        return;
    }
    if let Ok(entry) = entry(TURSO_TOKEN_KEY) {
        let _ = entry.delete_credential();
    }
}

/// The device's provider-encryption key, creating one on first use.
///
/// When `TANWORDS_MASTER_KEY` (hex or base64, 32 bytes) is set the keychain
/// is bypassed entirely — that path exists for headless servers, where there
/// is no keychain to hold the key. Supply it via a systemd `Environment=`
/// line or a container secret, never baked into an image.
///
/// Returns `None` when neither the env override nor the OS keychain is
/// usable (an unsigned macOS build with no keychain-access-group entitlement,
/// a headless Linux box with no Secret Service and no override). Callers
/// treat that as "this device cannot hold secrets" and refuse to store a key
/// rather than falling back to plaintext.
pub fn device_key() -> Option<[u8; 32]> {
    if let Ok(encoded) = std::env::var("TANWORDS_MASTER_KEY") {
        match decode_32(&encoded) {
            Some(key) => return Some(key),
            None => {
                // Loud but non-fatal: still try the keychain rather than
                // breaking desktop users with a stray env var.
                eprintln!(
                    "[tanwords] TANWORDS_MASTER_KEY is set but does not decode to 32 bytes — ignoring it"
                );
            }
        }
    }
    let entry = entry(DEVICE_KEY).ok()?;
    match entry.get_password() {
        Ok(encoded) => {
            let raw = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                encoded.as_bytes(),
            )
            .ok()?;
            raw.try_into().ok()
        }
        Err(keyring::Error::NoEntry) => {
            let key = crate::document_privacy::random::<32>();
            let encoded =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, key);
            entry.set_password(&encoded).ok()?;
            Some(key)
        }
        Err(_) => None,
    }
}

fn validate_key_name(name: &str) -> Result<(), String> {
    if !name.starts_with(ALLOWED_PREFIX) {
        return Err(format!(
            "invalid key name '{}'; must start with '{}'",
            name, ALLOWED_PREFIX
        ));
    }
    Ok(())
}

#[crate::shim::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    validate_key_name(&key)?;

    // Empty value means delete the entry.
    if value.is_empty() {
        return secret_delete(key);
    }

    let entry = keyring::Entry::new("tanwords", &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[crate::shim::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    validate_key_name(&key)?;

    let entry = keyring::Entry::new("tanwords", &key).map_err(|e| e.to_string())?;

    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[crate::shim::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    validate_key_name(&key)?;

    let entry = keyring::Entry::new("tanwords", &key).map_err(|e| e.to_string())?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // idempotent
        Err(e) => Err(e.to_string()),
    }
}
