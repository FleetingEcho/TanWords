//! Cloudflare R2 as the store for large attachments.
//!
//! Why at all: attachments normally live as blobs in the app database, and a
//! large one (an 85 MB video, say) is an awkward fit for either backend —
//! object storage is what that content actually wants, so a configured R2
//! bucket takes anything above `R2_THRESHOLD_BYTES` and the database keeps
//! only the row.
//!
//! Credentials: the secret access key goes to the OS keychain — see
//! `secrets` — everything else to `app_config.json`, which is deliberately
//! secret-free.

mod sigv4;

use crate::shim::{AppHandle, State};
use crate::AppState;
use serde::{Deserialize, Serialize};
use sigv4::Credentials;

/// Files at or above this go to R2 when a bucket is configured. Below it the
/// database blob is simpler and keeps small images working offline.
pub const R2_THRESHOLD_BYTES: usize = 10 * 1024 * 1024;

const PRESIGN_EXPIRY_SECS: u32 = 6 * 60 * 60;

/// Cloudflare's free R2 allowance.
pub const R2_FREE_LIMIT_BYTES: u64 = 10 * 1024 * 1024 * 1024;
/// Refuse uploads past this. The gap to the limit leaves room for the object
/// overhead R2 counts but a naive byte sum does not, and for the fact that a
/// rejected-at-the-edge upload is much nicer than a surprise bill.
pub const R2_BLOCK_AT_BYTES: u64 = 9 * 1024 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct R2Settings {
    pub account_id: String,
    pub bucket: String,
    pub access_key_id: String,
    /// Plaintext only in memory and inside the sealed record.
    #[serde(default)]
    pub secret_access_key: String,
    /// Optional public bucket / custom domain. When set, stored objects are
    /// addressed through it instead of a presigned URL — cheaper for a bucket
    /// the user has deliberately made public.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_base_url: Option<String>,
    /// Send *every* upload to the bucket, whatever its size. Off by default:
    /// small files are better off in the database, where they need no network
    /// round trip and keep working offline.
    #[serde(default)]
    pub always_upload: bool,
}

/// What the settings UI is allowed to see. No secret, by construction.
#[derive(Serialize)]
pub struct R2Usage {
    pub used_bytes: u64,
    pub object_count: u64,
    pub limit_bytes: u64,
    pub block_at_bytes: u64,
}

#[derive(Serialize)]
pub struct R2Status {
    pub configured: bool,
    pub account_id: String,
    pub bucket: String,
    pub access_key_id: String,
    pub public_base_url: Option<String>,
    /// Files at or above this many bytes are routed to R2.
    pub threshold_bytes: u64,
    pub always_upload: bool,
}

fn host(settings: &R2Settings) -> String {
    format!("{}.r2.cloudflarestorage.com", settings.account_id)
}

fn canonical_uri(settings: &R2Settings, key: &str) -> String {
    format!(
        "/{}/{}",
        sigv4::uri_encode(&settings.bucket, true),
        sigv4::uri_encode(key, false)
    )
}

fn amz_date() -> String {
    chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string()
}

fn credentials(settings: &R2Settings) -> Result<Credentials<'_>, String> {
    if settings.secret_access_key.is_empty() {
        return Err("R2 secret access key is missing — reconnect in Settings".into());
    }
    Ok(Credentials {
        access_key_id: &settings.access_key_id,
        secret_access_key: &settings.secret_access_key,
    })
}

// ── Storage ────────────────────────────────────────────────────────────────

/// Seals the whole record, so a field added later is covered automatically.
fn seal(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    crate::document_privacy::encrypt_text(key, plaintext)
}

/// Unseals with the active profile's sealing key. For a Postgres profile that
/// is the shared vault key; for local, the per-device keychain key.
fn unseal(key: &[u8; 32], sealed: &str) -> Option<String> {
    crate::document_privacy::decrypt_text(key, sealed).ok()
}

/// Moves a pre-existing desktop configuration out of `app_config.json` (and
/// the keychain) into the database, once. Without it, upgrading would look
/// like the bucket had silently disconnected.
pub async fn migrate_from_app_config(conn: &crate::db::Conn) {
    if load_settings(conn).await.is_some() {
        return;
    }
    let Some(old) = crate::appconfig::load_r2_settings() else { return };
    let Some(secret) = crate::secrets::r2_secret_get() else { return };
    let settings = R2Settings { secret_access_key: secret, ..old };
    if save_settings(conn, &settings).await.is_ok() {
        crate::appconfig::save_r2_settings(None);
        crate::secrets::r2_secret_clear();
    }
}

/// Loads the R2 settings, sealed with the active profile's sealing key.
/// Falls back to the legacy per-device keychain key when the vault key (or
/// the current device, pre-vault) sealed the row — and, on a successful
/// fallback, lazily re-seals the row under the vault key so it roams from
/// then on. `None` if there's no row or it can't be decrypted by either key.
pub async fn load_settings(conn: &crate::db::Conn) -> Option<R2Settings> {
    let sealed = crate::db::fetch_one(
        conn,
        "SELECT COALESCE(config_enc, '') FROM r2_config WHERE id = 1",
        (),
        |row| row.get::<String>(0),
    )
    .await
    .ok()?;
    if sealed.is_empty() {
        return None;
    }

    // Prefer the active profile's key (vault key for Postgres, device key for
    // local); fall back to the device key for rows a pre-vault device (or the
    // web server, under its master key) sealed before this change.
    let primary = conn.sealing_key();
    if let Some(ref pk) = primary {
        if let Some(json) = unseal(pk, &sealed) {
            return serde_json::from_str(&json).ok();
        }
    }
    let device = crate::secrets::device_key()?;
    let json = unseal(&device, &sealed)?;
    let settings: R2Settings = serde_json::from_str(&json).ok()?;

    // Lazy migration: re-seal under the active profile's key if we have one,
    // so the row roams from now on. Best-effort — a failure here must not
    // prevent the caller from using the settings it just decrypted.
    if let Some(pk) = primary {
        if let Ok(json) = serde_json::to_string(&settings) {
            if let Ok(sealed) = seal(&pk, &json) {
                let _ = conn
                    .execute(
                        "UPDATE r2_config SET config_enc = ?1 WHERE id = 1",
                        crate::db::params![sealed],
                    )
                    .await;
            }
        }
    }
    Some(settings)
}

async fn save_settings(conn: &crate::db::Conn, settings: &R2Settings) -> Result<(), String> {
    let key = conn
        .sealing_key()
        .ok_or("Cannot store the R2 key: this device has no usable keychain")?;
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO r2_config (id, config_enc) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET config_enc = excluded.config_enc",
        crate::db::params![seal(&key, &json)?],
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Uploads one object. Returns the key it was stored under.
pub async fn put_object(
    settings: &R2Settings,
    key: &str,
    content_type: &str,
    body: Vec<u8>,
) -> Result<(), String> {
    put_object_with_progress(settings, key, content_type, body, None, "").await
}

/// Chunk size for the streamed upload body. Small enough that progress moves
/// visibly on a slow link, large enough not to drown the event channel.
const UPLOAD_CHUNK_BYTES: usize = 256 * 1024;

/// As `put_object`, but streams the body so it can report bytes sent. An 85 MB
/// upload otherwise shows a spinner for a minute with no sign of life.
pub async fn put_object_with_progress(
    settings: &R2Settings,
    key: &str,
    content_type: &str,
    body: Vec<u8>,
    app: Option<&AppHandle>,
    file_name: &str,
) -> Result<(), String> {
    let creds = credentials(settings)?;

    let host = host(settings);
    let uri = canonical_uri(settings, key);
    let date = amz_date();
    let payload_hash = sigv4::hex_sha256(&body);

    let headers = vec![
        ("content-type".to_string(), content_type.to_string()),
        ("host".to_string(), host.clone()),
        ("x-amz-content-sha256".to_string(), payload_hash.clone()),
        ("x-amz-date".to_string(), date.clone()),
    ];
    let authorization =
        sigv4::authorization_header(&creds, "PUT", &uri, "", &headers, &payload_hash, &date);

    let total = body.len() as u64;
    let request = reqwest::Client::new()
        .put(format!("https://{host}{uri}"))
        .header("content-type", content_type)
        .header("x-amz-content-sha256", &payload_hash)
        .header("x-amz-date", &date)
        .header("authorization", authorization)
        // Explicit: a streamed body would otherwise go out chunked, and S3
        // signing requires a known length.
        .header("content-length", total.to_string());

    let request = match app {
        None => request.body(body),
        Some(app) => {
            let app = app.clone();
            let name = file_name.to_string();
            let mut sent = 0u64;
            let chunks = body
                .chunks(UPLOAD_CHUNK_BYTES)
                .map(|chunk| chunk.to_vec())
                .collect::<Vec<_>>();
            let stream = futures_util::stream::iter(chunks.into_iter().map(move |chunk| {
                sent += chunk.len() as u64;
                let _ = app.emit(
                    "r2:upload-progress",
                    serde_json::json!({ "fileName": name, "sent": sent, "total": total }),
                );
                Ok::<_, std::io::Error>(chunk)
            }));
            request.body(reqwest::Body::wrap_stream(stream))
        }
    };

    let response = request
        .send()
        .await
        .map_err(|e| format!("R2 upload failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("R2 rejected the upload ({status}): {}", s3_error_message(&detail)));
    }
    Ok(())
}

/// S3 errors come back as an XML document. The `<Message>` is the only part
/// worth showing; the rest is envelope.
fn s3_error_message(body: &str) -> String {
    match (body.find("<Message>"), body.find("</Message>")) {
        (Some(start), Some(end)) if end > start => body[start + 9..end].to_string(),
        _ => body.trim().to_string(),
    }
}

pub async fn delete_object(settings: &R2Settings, key: &str) -> Result<(), String> {
    let creds = credentials(settings)?;

    let host = host(settings);
    let uri = canonical_uri(settings, key);
    let date = amz_date();
    let payload_hash = sigv4::hex_sha256(b"");

    let headers = vec![
        ("host".to_string(), host.clone()),
        ("x-amz-content-sha256".to_string(), payload_hash.clone()),
        ("x-amz-date".to_string(), date.clone()),
    ];
    let authorization =
        sigv4::authorization_header(&creds, "DELETE", &uri, "", &headers, &payload_hash, &date);

    let response = reqwest::Client::new()
        .delete(format!("https://{host}{uri}"))
        .header("x-amz-content-sha256", &payload_hash)
        .header("x-amz-date", &date)
        .header("authorization", authorization)
        .send()
        .await
        .map_err(|e| format!("R2 delete failed: {e}"))?;

    // 404 is fine: the row is going away either way.
    if !response.status().is_success() && response.status().as_u16() != 404 {
        return Err(format!("R2 rejected the delete ({})", response.status()));
    }
    Ok(())
}

/// Walks the bucket with ListObjectsV2 and totals object sizes. Paginated:
/// one page is capped at 1000 keys regardless of `max-keys`.
pub async fn bucket_usage(settings: &R2Settings) -> Result<(u64, u64), String> {
    let creds = credentials(settings)?;

    let host = host(settings);
    let uri = format!("/{}", sigv4::uri_encode(&settings.bucket, true));
    let payload_hash = sigv4::hex_sha256(b"");
    let mut token: Option<String> = None;
    let mut total_bytes = 0u64;
    let mut total_objects = 0u64;

    loop {
        // Canonical query must be sorted by key and percent-encoded — the
        // continuation token in particular is full of `+`, `/` and `=`.
        let query = match &token {
            Some(value) => format!(
                "continuation-token={}&list-type=2&max-keys=1000",
                sigv4::uri_encode(value, true)
            ),
            None => "list-type=2&max-keys=1000".to_string(),
        };
        let date = amz_date();
        let headers = vec![
            ("host".to_string(), host.clone()),
            ("x-amz-content-sha256".to_string(), payload_hash.clone()),
            ("x-amz-date".to_string(), date.clone()),
        ];
        let authorization =
            sigv4::authorization_header(&creds, "GET", &uri, &query, &headers, &payload_hash, &date);

        let response = reqwest::Client::new()
            .get(format!("https://{host}{uri}?{query}"))
            .header("x-amz-content-sha256", &payload_hash)
            .header("x-amz-date", &date)
            .header("authorization", authorization)
            .send()
            .await
            .map_err(|e| format!("R2 listing failed: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("R2 listing failed ({status}): {}", s3_error_message(&body)));
        }
        let body = response.text().await.map_err(|e| e.to_string())?;

        for size in tag_values(&body, "Size") {
            total_bytes += size.parse::<u64>().unwrap_or(0);
            total_objects += 1;
        }
        let truncated = tag_values(&body, "IsTruncated")
            .first()
            .map(|v| v == "true")
            .unwrap_or(false);
        if !truncated {
            break;
        }
        token = tag_values(&body, "NextContinuationToken").into_iter().next();
        if token.is_none() {
            break;
        }
    }
    Ok((total_bytes, total_objects))
}

/// Every `<tag>…</tag>` body in an S3 XML response. Enough for the three
/// fields this needs; pulling in an XML crate for them would be overkill.
fn tag_values(xml: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after = &rest[start + open.len()..];
        let Some(end) = after.find(&close) else { break };
        out.push(after[..end].to_string());
        rest = &after[end + close.len()..];
    }
    out
}

/// A URL the renderer can hand to `<video src>` / `<img src>`. Presigned
/// unless the user configured a public base URL.
pub fn object_url(settings: &R2Settings, key: &str) -> Result<String, String> {
    if let Some(base) = settings.public_base_url.as_deref().filter(|b| !b.trim().is_empty()) {
        return Ok(format!("{}/{}", base.trim_end_matches('/'), sigv4::uri_encode(key, false)));
    }
    let creds = credentials(settings)?;
    Ok(sigv4::presign_get(
        &creds,
        &host(settings),
        &canonical_uri(settings, key),
        PRESIGN_EXPIRY_SECS,
        &amz_date(),
    ))
}

/// `<uuid>/<sanitised name>` — the uuid keeps two files of the same name apart
/// while the readable tail keeps a bucket listing navigable.
pub fn object_key(file_name: &str) -> String {
    let safe: String = file_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' })
        .collect();
    let safe = safe.trim_matches('-');
    format!(
        "assets/{}/{}",
        uuid::Uuid::new_v4(),
        if safe.is_empty() { "file" } else { safe }
    )
}

// ── Commands ───────────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn r2_get_status(state: State<'_, AppState>) -> Result<R2Status, String> {
    let db = crate::db::conn(&state)?;
    Ok(match load_settings(&db).await {
        Some(settings) => R2Status {
            configured: !settings.secret_access_key.is_empty()
                && !settings.account_id.is_empty()
                && !settings.bucket.is_empty(),
            account_id: settings.account_id,
            bucket: settings.bucket,
            access_key_id: settings.access_key_id,
            public_base_url: settings.public_base_url,
            threshold_bytes: R2_THRESHOLD_BYTES as u64,
            always_upload: settings.always_upload,
        },
        None => R2Status {
            configured: false,
            account_id: String::new(),
            bucket: String::new(),
            access_key_id: String::new(),
            public_base_url: None,
            threshold_bytes: R2_THRESHOLD_BYTES as u64,
            always_upload: false,
        },
    })
}

/// Saves the bucket details and verifies them with a real round trip, so a
/// typo in the key surfaces here instead of on the user's first big upload.
#[crate::shim::command]
pub async fn r2_connect(
    account_id: String,
    bucket: String,
    access_key_id: String,
    secret_access_key: String,
    public_base_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = crate::db::conn(&state)?;
    let settings = R2Settings {
        account_id: account_id.trim().to_string(),
        bucket: bucket.trim().to_string(),
        access_key_id: access_key_id.trim().to_string(),
        secret_access_key: secret_access_key.trim().to_string(),
        public_base_url: public_base_url.filter(|url| !url.trim().is_empty()),
        // Preserved across a reconnect — it is a routing preference, not a
        // credential.
        always_upload: load_settings(&db).await.is_some_and(|s| s.always_upload),
    };
    if settings.account_id.is_empty() || settings.bucket.is_empty() || settings.access_key_id.is_empty() {
        return Err("Account ID, bucket and access key ID are all required".into());
    }
    if settings.secret_access_key.is_empty() {
        return Err("Secret access key is required".into());
    }

    // Verified before it is stored, so a typo fails here rather than on the
    // user's first real upload.
    let key = object_key("tanwords-connection-test.txt");
    put_object(&settings, &key, "text/plain", b"tanwords".to_vec()).await?;
    let _ = delete_object(&settings, &key).await;

    save_settings(&db, &settings).await
}

/// Toggles "everything goes to the bucket". Separate from `r2_connect` so
/// flipping it does not require re-entering the secret key.
#[crate::shim::command]
pub async fn r2_set_always_upload(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let db = crate::db::conn(&state)?;
    let mut settings = load_settings(&db)
        .await
        .ok_or_else(|| "No R2 bucket is connected".to_string())?;
    settings.always_upload = enabled;
    save_settings(&db, &settings).await
}

#[crate::shim::command]
pub async fn r2_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let db = crate::db::conn(&state)?;
    db.execute("DELETE FROM r2_config", ())
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Uploads a file that the renderer already holds. Kept for parity with the
/// database path; the size ceiling is enforced by the caller.
#[crate::shim::command(async)]
pub async fn r2_get_usage(state: State<'_, AppState>) -> Result<R2Usage, String> {
    let db = crate::db::conn(&state)?;
    let settings = load_settings(&db)
        .await
        .ok_or_else(|| "No R2 bucket is connected".to_string())?;
    let (used_bytes, object_count) = match bucket_usage(&settings).await {
        Ok(value) => value,
        // A listing failure (offline, token without list permission) must not
        // leave the settings page blank — the rows we wrote are a floor.
        Err(_) => (recorded_bytes(&state).await.unwrap_or(0), 0),
    };
    Ok(R2Usage {
        used_bytes,
        object_count,
        limit_bytes: R2_FREE_LIMIT_BYTES,
        block_at_bytes: R2_BLOCK_AT_BYTES,
    })
}

/// Bytes this app knows it put in the bucket. Cheap (one SQL sum) and good
/// enough to gate an upload without a network round trip per file.
async fn recorded_bytes(state: &State<'_, AppState>) -> Result<u64, String> {
    let db = crate::db::conn(state)?;
    crate::db::fetch_one(
        &db,
        "SELECT COALESCE(SUM(size), 0) FROM standalone_assets WHERE COALESCE(remote_key, '') <> ''",
        (),
        |row| row.get::<i64>(0),
    )
    .await
    .map(|value| value.max(0) as u64)
}

#[crate::shim::command(async)]
pub async fn r2_put_asset(
    app: AppHandle,
    file_name: String,
    mime_type: String,
    data_base64: String,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    let db = crate::db::conn(&_state)?;
    let settings = load_settings(&db)
        .await
        .ok_or_else(|| "No R2 bucket is connected".to_string())?;
    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data_base64)
        .map_err(|_| "Invalid attachment data")?;

    let used = recorded_bytes(&_state).await.unwrap_or(0);
    if used + data.len() as u64 > R2_BLOCK_AT_BYTES {
        return Err(format!(
            "This upload would put the bucket over {} GB of the {} GB free allowance. Delete something first.",
            R2_BLOCK_AT_BYTES / (1024 * 1024 * 1024),
            R2_FREE_LIMIT_BYTES / (1024 * 1024 * 1024)
        ));
    }

    let key = object_key(&file_name);
    put_object_with_progress(&settings, &key, &mime_type, data, Some(&app), &file_name).await?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::{DbProfile, open};

    /// Requires a live Postgres reachable at `TANWORDS_PG_TEST_URL` — skipped
    /// otherwise. The R2 analogue of the AI-provider cross-device test: an
    /// R2 config saved on one device reads back on another via the shared
    /// vault key, so a Cloudflare account configured once roams everywhere.
    #[tokio::test]
    async fn r2_config_saved_on_one_device_reads_on_another_via_the_vault_key() {
        let Ok(url) = std::env::var("TANWORDS_PG_TEST_URL") else {
            eprintln!("skipping: TANWORDS_PG_TEST_URL not set");
            return;
        };
        // Wipe only this test's row — NOT the shared `vault_key` table (stable
        // across runs; every PG test shares the same password → same key).
        let wipe = crate::db::connection::open_blank_postgres(&url).await.unwrap();
        let _ = wipe.execute_batch("DELETE FROM r2_config").await;

        let conn_a = open(&DbProfile::Postgres { url: url.clone() }, None).await.unwrap().conn();
        let vault_a = conn_a.vault_key().map(|k| *k).expect("device A has a vault key");
        let settings = R2Settings {
            account_id: "acct".into(),
            bucket: "bucket".into(),
            access_key_id: "AKID".into(),
            secret_access_key: "secret".into(),
            public_base_url: None,
            always_upload: false,
        };
        save_settings(&conn_a, &settings).await.unwrap();
        let loaded_a = load_settings(&conn_a).await.expect("device A reads its own config");
        assert_eq!(loaded_a.bucket, "bucket");

        // A second independent open = "device B".
        let conn_b = open(&DbProfile::Postgres { url }, None).await.unwrap().conn();
        let vault_b = conn_b.vault_key().map(|k| *k).expect("device B has a vault key");
        assert_eq!(vault_a, vault_b, "both devices share the vault key");
        let loaded_b = load_settings(&conn_b).await.expect("device B reads A's config");
        assert_eq!(loaded_b.bucket, "bucket");
        assert_eq!(loaded_b.secret_access_key, "secret");

        // Cleanup.
        conn_b.execute("DELETE FROM r2_config", ()).await.unwrap();
    }
}
