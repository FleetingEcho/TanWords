/// All keychain keys reachable from `secret_get`/`secret_set` must start with
/// this prefix — prevents the webview from reading arbitrary keychain entries,
/// including the ones below, which are written by name from Rust only.
const ALLOWED_PREFIX: &str = "apikey_";

/// Turso auth token for the active connection profile. Outside `ALLOWED_PREFIX`
/// on purpose: the UI can *set* it (via `db_connect_turso`) but has no way to
/// read it back out afterwards.
const TURSO_TOKEN_KEY: &str = "turso_auth_token";

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
