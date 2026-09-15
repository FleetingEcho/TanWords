//! AI provider configuration — one shared list, per-origin keys.
//!
//! Provider metadata (name, base URL, model) and the API key both live in the
//! `ai_providers` table, so they travel with the database instead of being
//! stranded in the renderer's localStorage and the local OS keychain — which
//! is why a Postgres-synced second device used to come up with no providers at
//! all despite being "already configured".
//!
//! Rows are a single shared list: every device on the database sees every
//! provider, and an edit from any device updates the one row. `device_id`
//! records which installation *added* a row (the origin badge, resolved
//! against the `devices` registry) — it no longer hides anything. What
//! actually gates secret material is the sealing:
//!
//! 1. On a Postgres profile every device derives the same vault key from the
//!    shared connection password, so a key sealed on one machine decrypts on
//!    all of them — config roams the way its owner expects.
//! 2. On a local file profile the sealing key is this device's keychain, so a
//!    row that reaches another machine through a *copied* file decrypts to
//!    nothing there. That device still sees the row's metadata, but `key()`
//!    reads as unconfigured and `list()` reports `key_available: false`, so
//!    the UI says "key needed" instead of failing silently at call time.
//!
//! Rows whose key was sealed by a pre-vault device fall back to that device's
//! keychain key and are lazily re-sealed under the active profile's key (see
//! `key`), which is how an upgrading install starts roaming without a
//! re-entry ritual.

use crate::db::params; use crate::db::Conn;
use serde::{Deserialize, Serialize};

use crate::db;
use crate::document_privacy::{decrypt_text, encrypt_text};
use crate::shim::State;
use crate::AppState;

/// A provider as the settings UI sees it: everything except the key itself.
/// `has_key` says a key is stored; `key_available` says this device can
/// actually decrypt it — the two differ for a row sealed by another
/// machine's keychain (the copied-local-file case). The plaintext is a
/// separate, explicit call so listing providers never moves secrets around.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProvider {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub api_base: String,
    pub model_id: String,
    pub has_key: bool,
    /// The installation that added this row — the origin badge. Empty
    /// label/platform mean the adding device never registered (a row from
    /// before the `devices` table existed); the UI falls back to "another
    /// device".
    pub origin_device_id: String,
    pub origin_label: String,
    pub origin_platform: String,
    /// Whether this device can decrypt the stored key right now.
    pub key_available: bool,
}

const NO_KEYCHAIN: &str = "Cannot store the API key: this device's keychain is unavailable, so it could only be saved unencrypted.";

fn seal(conn: &Conn, plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key = conn.sealing_key().ok_or(NO_KEYCHAIN)?;
    encrypt_text(&key, plaintext)
}

/// Unseals with the active profile's sealing key (the shared vault key on
/// Postgres, the per-device keychain key on local). Returns the plaintext on
/// success, `None` if it can't be decrypted with this key.
fn unseal(conn: &Conn, sealed: &str) -> Option<String> {
    if sealed.is_empty() {
        return None;
    }
    conn.sealing_key().and_then(|key| decrypt_text(&key, sealed).ok())
}

/// Every provider on this database, from all devices, oldest first. Origin
/// columns are resolved against the `devices` registry; `key_available` is
/// answered by actually attempting the decrypt, so the UI never promises a
/// key this device cannot produce.
pub async fn list(conn: &Conn) -> Result<Vec<AiProvider>, String> {
    let rows = db::fetch_all(
        conn,
        "SELECT p.id, p.name, p.kind, p.api_base, p.model_id, p.api_key_enc,
                p.device_id, COALESCE(d.label, ''), COALESCE(d.platform, '')
           FROM ai_providers p
           LEFT JOIN devices d ON d.device_id = p.device_id
          ORDER BY p.created_at, p.device_id, p.id",
        (),
        |row| {
            Ok((
                row.get::<String>(0)?,
                row.get::<String>(1)?,
                row.get::<String>(2)?,
                row.get::<String>(3)?,
                row.get::<String>(4)?,
                row.get::<String>(5)?,
                row.get::<String>(6)?,
                row.get::<String>(7)?,
                row.get::<String>(8)?,
            ))
        },
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, name, kind, api_base, model_id, sealed, origin_device_id, origin_label, origin_platform)| {
                let has_key = !sealed.is_empty();
                let key_available = has_key && unseal(conn, &sealed).is_some();
                AiProvider {
                    id,
                    name,
                    kind,
                    api_base,
                    model_id,
                    has_key,
                    origin_device_id,
                    origin_label,
                    origin_platform,
                    key_available,
                }
            },
        )
        .collect())
}

pub async fn upsert(
    conn: &Conn,
    device: &str,
    provider: &AiProvider,
    api_key: Option<&str>,
) -> Result<(), String> {
    if provider.id.trim().is_empty() {
        return Err("Provider id is required".into());
    }

    // `api_key: None` means "leave whatever is stored alone" — the settings UI
    // saves name/model edits without re-sending the secret, and re-sealing a
    // key it never had would silently wipe it. COALESCE keeps the existing
    // ciphertext in that case.
    let sealed = match api_key {
        Some(key) => Some(seal(conn, key)?),
        None => None,
    };

    // Providers are one shared list: an edit from any device updates the one
    // row wherever it was created. Only the insert path — a genuinely new
    // provider — stamps this device as the origin.
    let updated = conn
        .execute(
            "UPDATE ai_providers
                SET name = ?2, kind = ?3, api_base = ?4, model_id = ?5,
                    api_key_enc = COALESCE(?6, api_key_enc),
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?1",
            params![
                provider.id.clone(),
                provider.name.clone(),
                provider.kind.clone(),
                provider.api_base.clone(),
                provider.model_id.clone(),
                sealed.clone(),
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
    if updated > 0 {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO ai_providers
            (device_id, id, name, kind, api_base, model_id, api_key_enc, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, ''), CURRENT_TIMESTAMP)",
        params![
            device,
            provider.id.clone(),
            provider.name.clone(),
            provider.kind.clone(),
            provider.api_base.clone(),
            provider.model_id.clone(),
            sealed,
        ],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes the provider everywhere — it is one shared row, not this device's
/// copy. (Two devices that independently created the same id keep two rows;
/// deleting removes whichever matches first, and a repeat call gets the rest.)
pub async fn delete(conn: &Conn, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM ai_providers WHERE id = ?1",
        params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn key(conn: &Conn, id: &str) -> Result<String, String> {
    let sealed = db::fetch_optional(
        conn,
        "SELECT api_key_enc FROM ai_providers WHERE id = ?1",
        params![id],
        |row| row.get::<String>(0),
    )
    .await?;
    let Some(sealed) = sealed else {
        return Ok(String::new());
    };

    // Prefer the active profile's key (vault key for Postgres, device key for
    // local); fall back to the per-device keychain key for rows a pre-vault
    // device (or the web server, under its master key) sealed before this
    // change. An undecryptable row reads as "" so the user can re-enter it.
    if let Some(plaintext) = unseal(conn, &sealed) {
        return Ok(plaintext);
    }
    let Some(fallback_key) = crate::secrets::device_key() else {
        return Ok(String::new());
    };
    let Some(plaintext) = decrypt_text(&fallback_key, &sealed).ok() else {
        return Ok(String::new());
    };

    // Lazy migration: re-seal under the active profile's key if we have one,
    // so the row roams from now on. Best-effort — a failure here must not
    // prevent the caller from using the key it just decrypted.
    if let Some(primary) = conn.sealing_key() {
        if let Ok(resealed) = encrypt_text(&primary, &plaintext) {
            let _ = conn
                .execute(
                    "UPDATE ai_providers SET api_key_enc = ?1 WHERE id = ?2",
                    params![resealed, id],
                )
                .await;
        }
    }
    Ok(plaintext)
}

// ── Commands ───────────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn ai_provider_list(state: State<'_, AppState>) -> Result<Vec<AiProvider>, String> {
    let conn = db::conn(&state)?;
    list(&conn).await
}

/// The plaintext key for one provider. The renderer genuinely needs it — it
/// calls the provider HTTP APIs directly — but requesting it per provider
/// keeps the secret off the list response that the settings page renders.
#[crate::shim::command]
pub async fn ai_provider_key(id: String, state: State<'_, AppState>) -> Result<String, String> {
    let conn = db::conn(&state)?;
    key(&conn, &id).await
}

/// Creates or updates a provider. Omit `apiKey` to preserve the stored key;
/// pass `""` to clear it. Editing an existing provider works from any device
/// (one shared row); a new provider is stamped with this device as origin.
#[crate::shim::command]
pub async fn ai_provider_upsert(
    id: String,
    name: String,
    kind: String,
    api_base: String,
    model_id: String,
    api_key: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = db::conn(&state)?;
    let provider = AiProvider {
        id,
        name,
        kind,
        api_base,
        model_id,
        has_key: false,
        origin_device_id: String::new(),
        origin_label: String::new(),
        origin_platform: String::new(),
        key_available: false,
    };
    upsert(
        &conn,
        &crate::appconfig::device_id(),
        &provider,
        api_key.as_deref(),
    )
    .await
}

#[crate::shim::command]
pub async fn ai_provider_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = db::conn(&state)?;
    delete(&conn, &id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::DbProfile;

    async fn memory_conn() -> Conn {
        let path = std::env::temp_dir()
            .join(format!("tanwords-aip-{}.db", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        db::connection::open(&DbProfile::Local { path }, None)
            .await
            .unwrap()
            .conn()
    }

    fn provider(id: &str) -> AiProvider {
        AiProvider {
            id: id.into(),
            name: "Ollama".into(),
            kind: "custom".into(),
            api_base: "http://localhost:11434/v1".into(),
            model_id: "llama3".into(),
            has_key: false,
            origin_device_id: String::new(),
            origin_label: String::new(),
            origin_platform: String::new(),
            key_available: false,
        }
    }

    #[tokio::test]
    async fn list_is_shared_across_devices_and_stamps_the_origin() {
        let conn = memory_conn().await;
        upsert(&conn, "device-a", &provider("custom_1"), Some("")).await.unwrap();
        upsert(&conn, "device-b", &provider("custom_2"), Some("")).await.unwrap();

        // Every device sees the whole list, each row tagged with its origin.
        let all = list(&conn).await.unwrap();
        assert_eq!(all.len(), 2);
        let first = all.iter().find(|p| p.id == "custom_1").unwrap();
        assert_eq!(first.origin_device_id, "device-a");
        assert!(!first.key_available); // no key stored at all

        // The registry may not know the adding device (no row in `devices`),
        // and that must degrade to empty strings, not an error.
        assert_eq!(first.origin_label, "");
        assert_eq!(first.origin_platform, "");

        // A second device editing the same id updates the ONE shared row
        // instead of forking a private copy — the origin stays where the
        // provider was born.
        upsert(&conn, "device-b", &provider("custom_1"), Some("")).await.unwrap();
        let all = list(&conn).await.unwrap();
        assert_eq!(all.len(), 2);
        let edited = all.iter().find(|p| p.id == "custom_1").unwrap();
        assert_eq!(edited.name, "Ollama");
        assert_eq!(edited.origin_device_id, "device-a");
    }

    #[tokio::test]
    async fn stored_key_is_never_plaintext_and_survives_metadata_edits() {
        let conn = memory_conn().await;
        let Some(_) = crate::secrets::device_key() else {
            return; // no usable keychain in this environment (headless CI)
        };

        upsert(&conn, "d", &provider("custom_1"), Some("sk-secret-value"))
            .await
            .unwrap();

        let stored = db::fetch_one(
            &conn,
            "SELECT api_key_enc FROM ai_providers WHERE device_id='d' AND id='custom_1'",
            (),
            |row| row.get::<String>(0),
        )
        .await
        .unwrap();
        assert!(!stored.contains("sk-secret-value"));
        assert_eq!(key(&conn, "custom_1").await.unwrap(), "sk-secret-value");
        assert!(list(&conn).await.unwrap()[0].has_key);
        assert!(list(&conn).await.unwrap()[0].key_available);

        // A metadata-only save (api_key = None) must not wipe the key.
        let mut renamed = provider("custom_1");
        renamed.name = "Renamed".into();
        upsert(&conn, "d", &renamed, None).await.unwrap();
        assert_eq!(key(&conn, "custom_1").await.unwrap(), "sk-secret-value");
        assert_eq!(list(&conn).await.unwrap()[0].name, "Renamed");

        // An explicit empty string clears it.
        upsert(&conn, "d", &renamed, Some("")).await.unwrap();
        assert_eq!(key(&conn, "custom_1").await.unwrap(), "");
        assert!(!list(&conn).await.unwrap()[0].has_key);
        assert!(!list(&conn).await.unwrap()[0].key_available);
    }

    #[tokio::test]
    async fn a_row_sealed_by_another_device_is_visible_but_reads_unconfigured() {
        let conn = memory_conn().await;
        conn.execute(
            "INSERT INTO ai_providers (device_id, id, name, kind, api_base, model_id, api_key_enc)
             VALUES ('d', 'custom_1', 'x', 'custom', '', '', 'bm90LXJlYWxseS1lbmNyeXB0ZWQ=')",
            (),
        )
        .await
        .unwrap();
        // The key is undecryptable here, so the plaintext reads as "" and the
        // user can re-enter it — but the row itself is no longer hidden: the
        // list shows it, with has_key (a key exists) distinct from
        // key_available (this device can produce it).
        assert_eq!(key(&conn, "custom_1").await.unwrap(), "");
        let row = &list(&conn).await.unwrap()[0];
        assert!(row.has_key);
        assert!(!row.key_available);
        assert_eq!(row.origin_device_id, "d");
    }

    /// Requires a live Postgres reachable at `TANWORDS_PG_TEST_URL` — skipped
    /// otherwise. The headline behaviour of the shared vault key: a provider
    /// key sealed on "device A" (one `open`) is read back on "device B" (a
    /// second, independent `open` of the same Postgres), because both derive
    /// the same vault key from the shared connection password. Pre-vault this
    /// returned "" on device B; now it returns the plaintext key.
    #[tokio::test]
    async fn a_key_sealed_on_one_device_reads_on_another_via_the_vault_key() {
        let Ok(url) = std::env::var("TANWORDS_PG_TEST_URL") else {
            eprintln!("skipping: TANWORDS_PG_TEST_URL not set");
            return;
        };
        // Wipe only this test's rows — NOT the shared `vault_key` table (which
        // is stable across runs: every test connects with the same Postgres
        // password, so `load_or_create_vault_key` derives the same key). The
        // PG tests run in parallel against one database, so dropping shared
        // tables would break other tests.
        let wipe = db::connection::open_blank_postgres(&url).await.unwrap();
        let _ = wipe.execute_batch("DELETE FROM ai_providers WHERE id = 'custom_1'").await;

        let conn_a = db::connection::open(&DbProfile::Postgres { url: url.clone() }, None)
            .await
            .unwrap()
            .conn();
        // The vault key must actually be attached (not a silent fallback to the
        // per-device keychain key) for this test to mean anything.
        let vault_a = conn_a.vault_key().map(|k| *k).expect("device A has a vault key");
        upsert(&conn_a, "device-a", &provider("custom_1"), Some("sk-roaming-value"))
            .await
            .unwrap();
        assert_eq!(key(&conn_a, "custom_1").await.unwrap(), "sk-roaming-value");

        // A second independent open = "device B". Same password → same vault
        // key → it can decrypt what A sealed.
        let conn_b = db::connection::open(&DbProfile::Postgres { url }, None)
            .await
            .unwrap()
            .conn();
        let vault_b = conn_b.vault_key().map(|k| *k).expect("device B has a vault key");
        // Same shared vault key, recovered independently from the same password.
        assert_eq!(vault_a, vault_b, "both devices share the vault key");
        assert_eq!(key(&conn_b, "custom_1").await.unwrap(), "sk-roaming-value");

        // And the shared list means B sees A's provider as fully usable —
        // this is the property the settings badges are built on.
        let seen_by_b = list(&conn_b).await.unwrap();
        let roaming = seen_by_b.iter().find(|p| p.id == "custom_1").unwrap();
        assert_eq!(roaming.origin_device_id, "device-a");
        assert!(roaming.key_available);

        // Cleanup.
        conn_b.execute("DELETE FROM ai_providers WHERE id = 'custom_1'", ()).await.unwrap();
    }
}
