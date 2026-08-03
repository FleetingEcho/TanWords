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

/// R2 secret access key. Same reasoning as the Turso token: the UI can set it
/// but has no way to read it back.
const R2_SECRET_KEY: &str = "r2_secret_access_key";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("tanwords", key).map_err(|e| e.to_string())
}

/// Where a secret lives when the keychain is not the right store.
///
/// Two cases, in order:
///
/// 1. `TANWORDS_SECRET_FILE_DIR` — headless servers (a container or VPS has no
///    usable Secret Service) keep these as 0600 files under that directory.
/// 2. Debug builds — every `cargo build` produces a different binary, and a
///    macOS keychain ACL is bound to the *signature* of the program that
///    created the entry. A rebuilt dev binary is therefore a stranger to the
///    keychain and gets re-prompted for every entry it touches (provider
///    master key, each `apikey_*`, the Turso token) — several password prompts
///    per `bun run dev`. Dev secrets go to `dev-secrets/` under the app data
///    dir instead. Release builds are untouched and still use the keychain.
fn secret_dir() -> Option<std::path::PathBuf> {
    if let Ok(dir) = std::env::var("TANWORDS_SECRET_FILE_DIR") {
        if !dir.trim().is_empty() {
            return Some(std::path::PathBuf::from(dir));
        }
    }
    #[cfg(debug_assertions)]
    {
        return Some(crate::app_data_dir().join("dev-secrets"));
    }
    #[cfg(not(debug_assertions))]
    None
}

fn secret_file(name: &str) -> Option<std::path::PathBuf> {
    Some(secret_dir()?.join(name))
}

/// Keeps a key name from escaping `secret_dir()`. `validate_key_name` already
/// pins the prefix, but a name is still attacker-influenced text reaching a
/// filesystem path, so anything outside a flat safe alphabet is refused.
fn secret_file_for_key(key: &str) -> Option<std::path::PathBuf> {
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        || key.contains("..")
    {
        return None;
    }
    secret_file(key)
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
        if let Some(value) = read_secret_file(&path) {
            return Some(value);
        }
        // Fall back to the keychain and copy the value across. Without this a
        // dev build silently loses every secret a release build stored — the
        // UI reports "Missing Turso auth token" for a connection that is in
        // fact fine. One prompt on the first dev run, none after that.
        let value = entry(TURSO_TOKEN_KEY).ok()?.get_password().ok()?;
        let _ = write_secret_file(&path, &value);
        return Some(value);
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
pub fn r2_secret_get() -> Option<String> {
    if let Some(path) = secret_file("tanwords_r2_secret") {
        if let Some(value) = read_secret_file(&path) {
            return Some(value);
        }
        let value = entry(R2_SECRET_KEY).ok()?.get_password().ok()?;
        let _ = write_secret_file(&path, &value);
        return Some(value);
    }
    entry(R2_SECRET_KEY).ok()?.get_password().ok()
}

pub fn r2_secret_set(secret: &str) -> Result<(), String> {
    if let Some(path) = secret_file("tanwords_r2_secret") {
        return write_secret_file(&path, secret);
    }
    entry(R2_SECRET_KEY)?
        .set_password(secret)
        .map_err(|e| e.to_string())
}

pub fn r2_secret_clear() {
    if let Some(path) = secret_file("tanwords_r2_secret") {
        let _ = std::fs::remove_file(path);
        return;
    }
    if let Ok(entry) = entry(R2_SECRET_KEY) {
        let _ = entry.delete_credential();
    }
}

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
    if let Some(path) = secret_file("tanwords_device_key") {
        let decode = |encoded: &str| -> Option<[u8; 32]> {
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded.as_bytes())
                .ok()?
                .try_into()
                .ok()
        };
        if let Some(encoded) = read_secret_file(&path) {
            return decode(&encoded);
        }
        // Adopt the keychain's key rather than minting a new one: a fresh key
        // cannot decrypt `ai_providers.api_key_enc`, so every saved provider
        // would come back with an unusable key.
        if let Ok(entry) = entry(DEVICE_KEY) {
            if let Ok(encoded) = entry.get_password() {
                let _ = write_secret_file(&path, &encoded);
                return decode(&encoded);
            }
        }
        let key = crate::document_privacy::random::<32>();
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, key);
        write_secret_file(&path, &encoded).ok()?;
        return Some(key);
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

    if let Some(path) = secret_file_for_key(&key) {
        return write_secret_file(&path, &value);
    }
    let entry = keyring::Entry::new("tanwords", &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[crate::shim::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    validate_key_name(&key)?;

    if let Some(path) = secret_file_for_key(&key) {
        if let Some(value) = read_secret_file(&path) {
            return Ok(Some(value));
        }
        let stored = keyring::Entry::new("tanwords", &key)
            .ok()
            .and_then(|entry| entry.get_password().ok());
        if let Some(value) = &stored {
            let _ = write_secret_file(&path, value);
        }
        return Ok(stored);
    }
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

    if let Some(path) = secret_file_for_key(&key) {
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    let entry = keyring::Entry::new("tanwords", &key).map_err(|e| e.to_string())?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // idempotent
        Err(e) => Err(e.to_string()),
    }
}
