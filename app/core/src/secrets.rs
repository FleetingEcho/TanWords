use std::sync::Mutex;

/// All keychain keys reachable from `secret_get`/`secret_set` must start with
/// this prefix — prevents the webview from reading arbitrary keychain entries,
/// including the ones below, which are written by name from Rust only.
const ALLOWED_PREFIX: &str = "apikey_";

/// Master key that seals `ai_providers.api_key_enc`. Outside `ALLOWED_PREFIX`
/// deliberately: the webview must never be able to read it, or storing the
/// provider keys encrypted would buy nothing.
const DEVICE_KEY: &str = "device_provider_key";

/// R2 secret access key. Same reasoning as the device key: the UI can set it
/// but has no way to read it back.
const R2_SECRET_KEY: &str = "r2_secret_access_key";

/** Keychain reads can display a macOS authorization dialog. Provider keys are
 *  fetched concurrently at startup, and every decrypt used to read the same
 *  device key independently — four providers could therefore produce four
 *  simultaneous prompts for one Keychain item. Hold each cache lock across its
 *  first load so concurrent callers share one authorization and one value. */
static DEVICE_KEY_CACHE: Mutex<Option<[u8; 32]>> = Mutex::new(None);
static R2_SECRET_CACHE: Mutex<Option<String>> = Mutex::new(None);

fn cached_value<T: Clone>(cache: &Mutex<Option<T>>, load: impl FnOnce() -> Option<T>) -> Option<T> {
    let mut cached = cache.lock().ok()?;
    if let Some(value) = cached.as_ref() {
        return Some(value.clone());
    }
    let value = load()?;
    *cached = Some(value.clone());
    Some(value)
}

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
///    master key, each `apikey_*`) — several password prompts
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


pub fn r2_secret_get() -> Option<String> {
    cached_value(&R2_SECRET_CACHE, || {
        if let Some(path) = secret_file("tanwords_r2_secret") {
            if let Some(value) = read_secret_file(&path) {
                return Some(value);
            }
            let value = entry(R2_SECRET_KEY).ok()?.get_password().ok()?;
            let _ = write_secret_file(&path, &value);
            return Some(value);
        }
        entry(R2_SECRET_KEY).ok()?.get_password().ok()
    })
}

pub fn r2_secret_set(secret: &str) -> Result<(), String> {
    let mut cached = R2_SECRET_CACHE
        .lock()
        .map_err(|_| "R2 secret cache is unavailable".to_string())?;
    if let Some(path) = secret_file("tanwords_r2_secret") {
        write_secret_file(&path, secret)?;
    } else {
        entry(R2_SECRET_KEY)?
            .set_password(secret)
            .map_err(|e| e.to_string())?;
    }
    *cached = Some(secret.to_string());
    Ok(())
}

pub fn r2_secret_clear() {
    let Ok(mut cached) = R2_SECRET_CACHE.lock() else {
        return;
    };
    if let Some(path) = secret_file("tanwords_r2_secret") {
        let _ = std::fs::remove_file(path);
    } else if let Ok(entry) = entry(R2_SECRET_KEY) {
        let _ = entry.delete_credential();
    }
    *cached = None;
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
    cached_value(&DEVICE_KEY_CACHE, load_device_key)
}

fn load_device_key() -> Option<[u8; 32]> {
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

// ── Vault key (shared, for a Postgres profile) ─────────────────────────────
//
// The device key above is *per device* — fine for a local SQLite file that
// never leaves the machine, but the wrong choice for a shared Postgres: an
// R2 config or AI provider key sealed by device A is unreadable on device B,
// so a Cloudflare account or a saved OpenAI key can't roam. The vault key
// fixes that. It is one random 32-byte key, stored in the `vault_key` table,
// sealed with a key derived from the *Postgres connection password*. Every
// device and the web server that reaches the same Postgres derives the same
// unlock key from that password and opens the same vault key — so the sealed
// R2/AI rows decrypt everywhere, with no per-device env var to set.
//
// Local SQLite profiles never use the vault key; they keep sealing on the
// per-device keychain key (single machine, no roaming, at-rest protection).
// The vault key is resolved once in `connection::open` for a Postgres profile
// and attached to the `Conn`, so every `Conn` clone carries it to the deep
// seal/unseal helpers that only have `&Conn`, not `AppState`.

/// `info` string binding the vault unlock derivation to its purpose.
const VAULT_INFO: &[u8] = b"tanwords-vault";

/// Loads the shared vault key for a Postgres profile: reads the `vault_key`
/// row and unseals it with the password-derived key, or mints and stores a
/// fresh 32-byte key on first use (the first device to connect creates it;
/// every later device finds it ready). Called from `connection::open` after
/// `init_db` has created the `vault_key` table.
pub async fn load_or_create_vault_key(
    conn: &crate::db::Conn,
    password: &str,
) -> Result<[u8; 32], String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let row: Option<(String, String)> = crate::db::fetch_optional(
        conn,
        "SELECT key_enc, salt FROM vault_key WHERE id = 1",
        (),
        |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
    )
    .await
    .map_err(|e| e.to_string())?;

    if let Some((key_enc, salt_b64)) = row {
        let salt = STANDARD.decode(salt_b64.as_bytes()).map_err(|e| e.to_string())?;
        let unlock = crate::document_privacy::derive_vault_unlock_key(password, &salt, VAULT_INFO);
        let key_b64 = crate::document_privacy::decrypt_text(&unlock, &key_enc)
            .map_err(|_| "The Postgres password no longer unlocks the stored vault key (the database password was rotated outside the app)".to_string())?;
        let bytes = STANDARD.decode(key_b64.as_bytes()).map_err(|e| e.to_string())?;
        return bytes
            .try_into()
            .map_err(|_| "Stored vault key is not 32 bytes".to_string());
    }

    // First use: mint and store. Fresh random salt + vault key.
    let salt = crate::document_privacy::random::<16>();
    let unlock = crate::document_privacy::derive_vault_unlock_key(password, &salt, VAULT_INFO);
    let key = crate::document_privacy::random::<32>();
    let key_b64 = STANDARD.encode(key);
    let key_enc = crate::document_privacy::encrypt_text(&unlock, &key_b64)?;
    let salt_b64 = STANDARD.encode(salt);
    conn.execute(
        // `updated_at` is left to the column default (`CURRENT_TIMESTAMP` on
        // SQLite, `to_char(now()...)` on Postgres) — setting it inline would
        // collide with Postgres's TIMESTAMPTZ/TEXT typing the way other tables
        // in this schema avoid by using the default.
        //
        // `ON CONFLICT DO NOTHING`, not DO UPDATE: two devices bootstrapping
        // the same fresh database both see no row; whoever inserts second must
        // adopt the *first* key, or everything the first device already sealed
        // (R2 config, AI provider keys) is silently re-keyed and permanently
        // undecryptable.
        "INSERT INTO vault_key (id, key_enc, salt) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO NOTHING",
        crate::db::params![key_enc, salt_b64],
    )
    .await
    .map_err(|e| e.to_string())?;
    // A concurrent creator won the race: use its key, discard ours.
    let winner: Option<(String, String)> = crate::db::fetch_optional(
        conn,
        "SELECT key_enc, salt FROM vault_key WHERE id = 1",
        (),
        |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
    )
    .await
    .map_err(|e| e.to_string())?;
    if let Some((key_enc, salt_b64)) = winner {
        let salt = STANDARD.decode(salt_b64.as_bytes()).map_err(|e| e.to_string())?;
        let unlock = crate::document_privacy::derive_vault_unlock_key(password, &salt, VAULT_INFO);
        let key_b64 = crate::document_privacy::decrypt_text(&unlock, &key_enc)
            .map_err(|_| "The Postgres password no longer unlocks the stored vault key (the database password was rotated outside the app)".to_string())?;
        let bytes = STANDARD.decode(key_b64.as_bytes()).map_err(|e| e.to_string())?;
        return bytes
            .try_into()
            .map_err(|_| "Stored vault key is not 32 bytes".to_string());
    }
    Ok(key)
}

/// Re-seals the shared vault key under a *new* Postgres password. Called by
/// the web server's password-rotation flow after the role password is changed
/// but before the session is re-opened with it — so the vault key the new
/// connection will try to open is already sealed with the new password's
/// derived key. Cheap (one row decrypt + one row encrypt + one UPDATE), and
/// it leaves every sealed R2/AI row untouched (those are sealed with the
/// vault key itself, not the password-derived key). The old `conn` is still
/// connected with the *old* password and carries the vault key, so the
/// decrypt side works; only the seal side uses the new password.
pub async fn rekey_vault_key(
    conn: &crate::db::Conn,
    old_password: &str,
    new_password: &str,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    // The vault key bytes — either already on the Conn, or decrypted from the
    // row with the old password.
    let vault_key: [u8; 32] = if let Some(k) = conn.vault_key() {
        *k
    } else {
        let row = crate::db::fetch_optional::<(String, String), _>(
            conn,
            "SELECT key_enc, salt FROM vault_key WHERE id = 1",
            (),
            |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
        )
        .await?
        .ok_or("No vault key row to re-seal")?;
        let salt = STANDARD.decode(row.1.as_bytes()).map_err(|e| e.to_string())?;
        let unlock = crate::document_privacy::derive_vault_unlock_key(old_password, &salt, VAULT_INFO);
        let key_b64 = crate::document_privacy::decrypt_text(&unlock, &row.0)
            .map_err(|_| "The old Postgres password no longer unlocks the stored vault key".to_string())?;
        STANDARD
            .decode(key_b64.as_bytes())
            .map_err(|e| e.to_string())?
            .try_into()
            .map_err(|_| "Stored vault key is not 32 bytes".to_string())?
    };

    // Re-seal with a fresh salt under the new password.
    let salt = crate::document_privacy::random::<16>();
    let unlock = crate::document_privacy::derive_vault_unlock_key(new_password, &salt, VAULT_INFO);
    let key_b64 = STANDARD.encode(vault_key);
    let key_enc = crate::document_privacy::encrypt_text(&unlock, &key_b64)?;
    let salt_b64 = STANDARD.encode(salt);
    conn.execute(
        "UPDATE vault_key SET key_enc = ?1, salt = ?2 WHERE id = 1",
        crate::db::params![key_enc, salt_b64],
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Re-seals every vault-key-sealed secret row under the per-device key.
///
/// Called by the web server's *disable remote access* flow, right before it
/// snapshots the Postgres database into the local `tanwords.db`: a local
/// profile carries no vault key (its sealing key is the per-device keychain
/// key), so vault-sealed `r2_config`/`ai_providers` rows copied verbatim
/// would read as "not configured" the whole time remote access is off. With
/// them re-sealed under the device key first, the snapshot stays readable —
/// and the lazy migration on the read sites re-seals them under the vault
/// key again once the account re-enables Postgres.
///
/// Rows that don't decrypt under the vault key are left untouched: they are
/// either empty or already device-key-sealed (e.g. written by a pre-vault
/// device). Returns how many rows were re-sealed. A connection without a
/// vault key attached (already local, or keyless) is a no-op.
pub async fn downgrade_vault_rows_to_device_key(conn: &crate::db::Conn) -> Result<usize, String> {
    use crate::document_privacy::{decrypt_text, encrypt_text};

    let Some(vault) = conn.vault_key() else {
        return Ok(0);
    };
    let Some(device) = crate::secrets::device_key() else {
        return Err("this device has no usable keychain".to_string());
    };
    let mut resealed = 0usize;

    // r2_config: a single row (id = 1), or none at all.
    if let Ok(Some(sealed)) = crate::db::fetch_optional::<String, _>(
        conn,
        "SELECT COALESCE(config_enc, '') FROM r2_config WHERE id = 1",
        (),
        |r| r.get::<String>(0),
    )
    .await
    {
        if !sealed.is_empty() {
            if let Ok(plaintext) = decrypt_text(vault, &sealed) {
                if let Ok(downgraded) = encrypt_text(&device, &plaintext) {
                    conn.execute(
                        "UPDATE r2_config SET config_enc = ?1 WHERE id = 1",
                        crate::db::params![downgraded],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    resealed += 1;
                }
            }
        }
    }

    // ai_providers: one row per (device_id, id). `updated_at` is left to its
    // ON UPDATE trigger/default — a re-seal must not look like a user edit.
    let rows = crate::db::fetch_all::<(String, String, String), _>(
        conn,
        "SELECT device_id, id, api_key_enc FROM ai_providers WHERE api_key_enc <> ''",
        (),
        |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?, r.get::<String>(2)?)),
    )
    .await
    .map_err(|e| e.to_string())?;
    for (device_id, id, sealed) in rows {
        let Some(plaintext) = decrypt_text(vault, &sealed).ok() else {
            continue;
        };
        let Ok(downgraded) = encrypt_text(&device, &plaintext) else {
            continue;
        };
        conn.execute(
            "UPDATE ai_providers SET api_key_enc = ?1 WHERE device_id = ?2 AND id = ?3",
            crate::db::params![downgraded, device_id, id],
        )
        .await
        .map_err(|e| e.to_string())?;
        resealed += 1;
    }

    Ok(resealed)
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

#[cfg(test)]
mod tests {
    use super::cached_value;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier, Mutex,
    };

    #[test]
    fn concurrent_secret_reads_share_one_load() {
        let cache = Arc::new(Mutex::new(None));
        let loads = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(Barrier::new(5));
        let threads = (0..4)
            .map(|_| {
                let cache = Arc::clone(&cache);
                let loads = Arc::clone(&loads);
                let start = Arc::clone(&start);
                std::thread::spawn(move || {
                    start.wait();
                    cached_value(&cache, || {
                        loads.fetch_add(1, Ordering::SeqCst);
                        Some("secret".to_string())
                    })
                })
            })
            .collect::<Vec<_>>();

        start.wait();
        for thread in threads {
            assert_eq!(thread.join().unwrap().as_deref(), Some("secret"));
        }
        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }
}
