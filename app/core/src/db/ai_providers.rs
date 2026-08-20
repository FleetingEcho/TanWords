//! Device-scoped AI provider configuration.
//!
//! Provider metadata (name, base URL, model) and the API key both live in the
//! `ai_providers` table, so they travel with the database instead of being
//! stranded in the renderer's localStorage and the local OS keychain — which
//! is why a Postgres-synced second device used to come up with no providers at
//! all despite being "already configured".
//!
//! Two properties make that safe to do with secret material in it:
//!
//! 1. Every row is stamped with `device_id` (see `appconfig::device_id`) and
//!    every query here filters on the current one. A device only ever sees
//!    what was configured on it.
//! 2. `api_key_enc` is AES-256-GCM sealed with a master key held in this
//!    device's OS keychain and never exposed to the webview. Rows that reach
//!    another machine through sync are undecryptable there, so scoping is
//!    enforced by cryptography and not only by the WHERE clause.

use crate::db::params; use crate::db::Conn;
use serde::{Deserialize, Serialize};

use crate::db;
use crate::document_privacy::{decrypt_text, encrypt_text};
use crate::shim::State;
use crate::AppState;

/// A provider as the settings UI sees it: everything except the key itself.
/// `has_key` is what the UI needs to render "configured"; the plaintext is a
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

pub async fn list(conn: &Conn, device: &str) -> Result<Vec<AiProvider>, String> {
    db::fetch_all(
        conn,
        "SELECT id, name, kind, api_base, model_id, api_key_enc <> ''
           FROM ai_providers WHERE device_id = ?1 ORDER BY created_at",
        params![device],
        |row| {
            Ok(AiProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                api_base: row.get(3)?,
                model_id: row.get(4)?,
                // `api_key_enc <> ''` is a comparison — BOOL on Postgres, 0/1
                // on SQLite; read as bool (portable both ways, like the EXISTS
                // and `IS NOT NULL` reads).
                has_key: row.get::<bool>(5)?,
            })
        },
    )
    .await
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
    // key it never had would silently wipe it. COALESCE on the excluded value
    // keeps the existing ciphertext in that case.
    let sealed = match api_key {
        Some(key) => Some(seal(conn, key)?),
        None => None,
    };

    conn.execute(
        "INSERT INTO ai_providers
            (device_id, id, name, kind, api_base, model_id, api_key_enc, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, ''), CURRENT_TIMESTAMP)
         ON CONFLICT(device_id, id) DO UPDATE SET
            name        = excluded.name,
            kind        = excluded.kind,
            api_base    = excluded.api_base,
            model_id    = excluded.model_id,
            api_key_enc = COALESCE(?7, ai_providers.api_key_enc),
            updated_at  = CURRENT_TIMESTAMP",
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

pub async fn delete(conn: &Conn, device: &str, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM ai_providers WHERE device_id = ?1 AND id = ?2",
        params![device, id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn key(conn: &Conn, device: &str, id: &str) -> Result<String, String> {
    let sealed = db::fetch_optional(
        conn,
        "SELECT api_key_enc FROM ai_providers WHERE device_id = ?1 AND id = ?2",
        params![device, id],
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
                    "UPDATE ai_providers SET api_key_enc = ?1 WHERE device_id = ?2 AND id = ?3",
                    params![resealed, device, id],
                )
                .await;
        }
    }
    Ok(plaintext)
}

// ── Commands ───────────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn ai_provider_list(
    state: State<'_, AppState>,
) -> Result<Vec<AiProvider>, String> {
    let conn = db::conn(&state)?;
    list(&conn, &crate::appconfig::device_id()).await
}

/// The plaintext key for one provider. The renderer genuinely needs it — it
/// calls the provider HTTP APIs directly — but requesting it per provider
/// keeps the secret off the list response that the settings page renders.
#[crate::shim::command]
pub async fn ai_provider_key(
    id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let conn = db::conn(&state)?;
    key(&conn, &crate::appconfig::device_id(), &id).await
}

/// Creates or updates a provider. Omit `apiKey` to preserve the stored key;
/// pass `""` to clear it.
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
    delete(&conn, &crate::appconfig::device_id(), &id).await
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
        }
    }

    #[tokio::test]
    async fn providers_are_scoped_to_the_device_that_added_them() {
        let conn = memory_conn().await;
        upsert(&conn, "device-a", &provider("custom_1"), Some("")).await.unwrap();
        upsert(&conn, "device-b", &provider("custom_2"), Some("")).await.unwrap();

        let a = list(&conn, "device-a").await.unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].id, "custom_1");

        let b = list(&conn, "device-b").await.unwrap();
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].id, "custom_2");

        // Same provider id on two devices is two independent rows, not a clash.
        upsert(&conn, "device-b", &provider("custom_1"), Some("")).await.unwrap();
        assert_eq!(list(&conn, "device-a").await.unwrap().len(), 1);
        assert_eq!(list(&conn, "device-b").await.unwrap().len(), 2);
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
        assert_eq!(key(&conn, "d", "custom_1").await.unwrap(), "sk-secret-value");
        assert!(list(&conn, "d").await.unwrap()[0].has_key);

        // A metadata-only save (api_key = None) must not wipe the key.
        let mut renamed = provider("custom_1");
        renamed.name = "Renamed".into();
        upsert(&conn, "d", &renamed, None).await.unwrap();
        assert_eq!(key(&conn, "d", "custom_1").await.unwrap(), "sk-secret-value");
        assert_eq!(list(&conn, "d").await.unwrap()[0].name, "Renamed");

        // An explicit empty string clears it.
        upsert(&conn, "d", &renamed, Some("")).await.unwrap();
        assert_eq!(key(&conn, "d", "custom_1").await.unwrap(), "");
        assert!(!list(&conn, "d").await.unwrap()[0].has_key);
    }

    #[tokio::test]
    async fn a_row_sealed_by_another_device_reads_as_unconfigured() {
        let conn = memory_conn().await;
        conn.execute(
            "INSERT INTO ai_providers (device_id, id, name, kind, api_base, model_id, api_key_enc)
             VALUES ('d', 'custom_1', 'x', 'custom', '', '', 'bm90LXJlYWxseS1lbmNyeXB0ZWQ=')",
            (),
        )
        .await
        .unwrap();
        assert_eq!(key(&conn, "d", "custom_1").await.unwrap(), "");
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
        assert_eq!(key(&conn_a, "device-a", "custom_1").await.unwrap(), "sk-roaming-value");

        // A second independent open = "device B". Same password → same vault
        // key → it can decrypt what A sealed.
        let conn_b = db::connection::open(&DbProfile::Postgres { url }, None)
            .await
            .unwrap()
            .conn();
        let vault_b = conn_b.vault_key().map(|k| *k).expect("device B has a vault key");
        // Same shared vault key, recovered independently from the same password.
        assert_eq!(vault_a, vault_b, "both devices share the vault key");
        assert_eq!(key(&conn_b, "device-a", "custom_1").await.unwrap(), "sk-roaming-value");

        // Cleanup.
        conn_b.execute("DELETE FROM ai_providers WHERE id = 'custom_1'", ()).await.unwrap();
    }
}
