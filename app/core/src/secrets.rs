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

pub fn turso_token_get() -> Option<String> {
    entry(TURSO_TOKEN_KEY).ok()?.get_password().ok()
}

pub fn turso_token_set(token: &str) -> Result<(), String> {
    entry(TURSO_TOKEN_KEY)?
        .set_password(token)
        .map_err(|e| e.to_string())
}

pub fn turso_token_clear() {
    if let Ok(entry) = entry(TURSO_TOKEN_KEY) {
        let _ = entry.delete_credential();
    }
}

/// The device's provider-encryption key, creating one on first use.
///
/// Returns `None` when the OS keychain is unusable (an unsigned macOS build
/// with no keychain-access-group entitlement, a headless Linux box with no
/// Secret Service). Callers treat that as "this device cannot hold secrets"
/// and refuse to store a key rather than falling back to plaintext.
pub fn device_key() -> Option<[u8; 32]> {
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
