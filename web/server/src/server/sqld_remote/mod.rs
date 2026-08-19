//! Per-user dedicated sqld container: a desktop app can connect to it
//! directly over libsql (Settings > Cloud tab) and share this web account's
//! *own* data live. Deliberately not the same thing as the `turso_*` routes
//! in `db.rs` (a user-supplied external Turso/self-hosted target) — this is
//! a container the server provisions and manages on the user's behalf.
//!
//! One sqld process per user, not sqld's namespace feature: namespaces were
//! tried for a different reason this session and rejected every write with
//! "x-proxy-authorization not set" (an internal inter-node auth header a
//! single-node primary with no replicas never populates) — a real sqld bug,
//! not a config mistake. A dedicated container per user sidesteps it by
//! reusing the exact non-namespaced primary mode already proven reliable.
//!
//! `app` never talks to the Docker daemon directly — `docker-proxy`
//! (tecnativa/docker-socket-proxy, see deploy/compose.yml) exposes a
//! deliberately narrow slice of the Docker Engine API (containers + volumes,
//! no exec, no image pull) over plain HTTP on the internal compose network.
//! Per-user vhost routing goes through Caddy's own admin API
//! (`caddy:2019`), not the Docker API — no privilege for that is needed at
//! all.

use serde::{Deserialize, Serialize};
use serde_json::json;

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};

use tanwords_lib::db::connection::DbProfile;
use tanwords_lib::AppState;

use super::{UserSession, WebState};

mod handlers;
pub(super) use handlers::{sqld_remote_disable, sqld_remote_enable, sqld_remote_rotate, sqld_remote_status};

const DOCKER_API_BASE: &str = "http://docker-proxy:2375";
/// Matches `name: tanwords` at the top of deploy/compose.yml — compose
/// derives the network name from the project name.
const COMPOSE_NETWORK: &str = "tanwords_default";
const SQLD_IMAGE: &str = "ghcr.io/tursodatabase/libsql-server:latest";
const SQLD_MEM_LIMIT_BYTES: i64 = 256 * 1024 * 1024;
/// Must match the range `deploy/deploy-server.sh` opens via `ufw` at
/// bootstrap — `app` can never open new host firewall rules itself at
/// runtime, so the usable port space is fixed up front.
const PORT_RANGE_START: i64 = 8444;
const PORT_RANGE_END: i64 = 8543;

fn container_name(user_id: i64) -> String {
    format!("tanwords-sqld-user-{user_id}")
}

fn volume_name(user_id: i64) -> String {
    format!("tanwords-sqld-user-{user_id}-data")
}

#[derive(Serialize, Deserialize)]
struct SqldClaims {
    exp: i64,
}

/// Empty claims + a 10-year `exp` — full read-write access to sqld's default
/// database, no namespace scoping (this container only ever serves one). The
/// same shape verified working against the real server earlier this session
/// (deploy/sqld/sign-token.mjs signs the identical claims by hand).
fn sign_token(key_der: &[u8]) -> Result<String, String> {
    let exp = chrono_now_secs() + 10 * 365 * 24 * 3600;
    let key = EncodingKey::from_ed_der(key_der);
    encode(&Header::new(Algorithm::EdDSA), &SqldClaims { exp }, &key).map_err(|e| e.to_string())
}

fn chrono_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A fresh Ed25519 keypair, PKCS8 DER-encoded (what `set_sqld_remote` stores
/// and `sign_token`/`public_key_b64url` both derive from — sign with
/// `EncodingKey::from_ed_der`, or reload via `Ed25519KeyPair::from_pkcs8` to
/// get the public half back out).
fn generate_keypair_der() -> Result<Vec<u8>, String> {
    let rng = SystemRandom::new();
    let doc = Ed25519KeyPair::generate_pkcs8(&rng).map_err(|_| "failed to generate keypair".to_string())?;
    Ok(doc.as_ref().to_vec())
}

/// sqld's `SQLD_AUTH_JWT_KEY` accepts "plain bytes of the Ed25519 public key
/// in URL-safe base64" directly — no PEM/SPKI wrapping needed, this is the
/// same encoding `jsonwebtoken`'s own EdDSA decoding key parsing expects
/// (confirmed by reading sqld's `parse_jwt_keys` source this session).
fn public_key_b64url(key_der: &[u8]) -> Result<String, String> {
    use base64::Engine;
    let keypair = Ed25519KeyPair::from_pkcs8(key_der).map_err(|_| "stored sqld key is invalid".to_string())?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(keypair.public_key().as_ref()))
}

async fn allocate_port(state: &WebState) -> Result<i64, String> {
    let used = state.users.used_sqld_ports().await?;
    (PORT_RANGE_START..=PORT_RANGE_END)
        .find(|p| !used.contains(p))
        .ok_or_else(|| "No free ports left in the reserved sqld range — contact the server admin".to_string())
}

fn public_host(state: &WebState) -> Result<&str, String> {
    state
        .public_host()
        .ok_or_else(|| "TANWORDS_PUBLIC_HOST is not configured on this server".to_string())
}

// ── Docker Engine API (via docker-proxy) ───────────────────────────────────

async fn docker_volume_create(state: &WebState, name: &str) -> Result<(), String> {
    let resp = state
        .http
        .post(format!("{DOCKER_API_BASE}/volumes/create"))
        .json(&json!({ "Name": name }))
        .send()
        .await
        .map_err(|e| format!("docker-proxy unreachable: {e}"))?;
    // 201 Created, or a plain 500 "volume already exists" we treat as fine.
    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if body.contains("already exists") {
            Ok(())
        } else {
            Err(format!("failed to create sqld volume: {status} {body}"))
        }
    }
}

async fn docker_container_remove(state: &WebState, name: &str) -> Result<(), String> {
    let resp = state
        .http
        .delete(format!("{DOCKER_API_BASE}/containers/{name}?force=true"))
        .send()
        .await
        .map_err(|e| format!("docker-proxy unreachable: {e}"))?;
    if resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_FOUND {
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("failed to remove sqld container: {status} {body}"))
    }
}

async fn docker_container_action(state: &WebState, name: &str, action: &str) -> Result<(), String> {
    let resp = state
        .http
        .post(format!("{DOCKER_API_BASE}/containers/{name}/{action}"))
        .send()
        .await
        .map_err(|e| format!("docker-proxy unreachable: {e}"))?;
    // 204 = did it; 304 = already in that state. For `stop` specifically,
    // 404 (container already gone entirely — e.g. manually removed) counts
    // as success too, so `disable` can't get permanently stuck; `start`
    // deliberately keeps failing on a missing container, since silently
    // "succeeding" there would report a working connection to nothing.
    if resp.status().is_success()
        || resp.status() == reqwest::StatusCode::NOT_MODIFIED
        || (action == "stop" && resp.status() == reqwest::StatusCode::NOT_FOUND)
    {
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("failed to {action} sqld container: {status} {body}"))
    }
}

/// Creates (does not start) the container fresh — callers that need to
/// replace an existing one (rotation) remove it first. The volume is
/// created if missing and is never removed by anything in this module, so
/// rotation naturally preserves data: only the trusted public key and the
/// container's own JWT-key env var change.
async fn docker_container_create(state: &WebState, user_id: i64, key_der: &[u8]) -> Result<(), String> {
    let name = container_name(user_id);
    let volume = volume_name(user_id);
    docker_volume_create(state, &volume).await?;

    let pubkey = public_key_b64url(key_der)?;
    let body = json!({
        "Image": SQLD_IMAGE,
        "Env": [
            "SQLD_NODE=primary",
            format!("SQLD_AUTH_JWT_KEY={pubkey}"),
        ],
        "HostConfig": {
            "Memory": SQLD_MEM_LIMIT_BYTES,
            "NetworkMode": COMPOSE_NETWORK,
            "RestartPolicy": { "Name": "unless-stopped" },
            "Binds": [format!("{volume}:/var/lib/sqld")],
        },
        "Labels": { "com.tanwords.sqld-user": user_id.to_string() },
    });
    let resp = state
        .http
        .post(format!("{DOCKER_API_BASE}/containers/create?name={name}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("docker-proxy unreachable: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("failed to create sqld container: {status} {text}"))
    }
}

// ── Caddy admin API ─────────────────────────────────────────────────────────

/// The static part of deploy/caddy/Caddyfile (the `app` vhost on 443 and the
/// shared/admin sqld vhost on 8443) — every push to Caddy's admin API
/// replaces the *entire* running config, so this always has to be included
/// alongside the dynamic per-user blocks below, not just the diff. Must be
/// kept in sync with deploy/caddy/Caddyfile by hand; there's no shared file
/// `app` and `caddy` both read (the Caddyfile on disk is a host bind mount
/// only `caddy` has), and duplicating a few lines of static config here is
/// far simpler than plumbing one across the container boundary.
const STATIC_CADDYFILE: &str = r#"
{
	default_sni {$TANWORDS_PUBLIC_HOST}
	admin 0.0.0.0:2019
}

{$TANWORDS_PUBLIC_HOST} {
	tls {
		issuer acme https://acme-v02.api.letsencrypt.org/directory {
			profile shortlived
		}
	}
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
	}
	reverse_proxy app:8740 {
		flush_interval -1
	}
}

{$TANWORDS_PUBLIC_HOST}:8443 {
	tls {
		issuer acme https://acme-v02.api.letsencrypt.org/directory {
			profile shortlived
		}
	}
	reverse_proxy sqld:8080 {
		transport http {
			keepalive off
		}
	}
}
"#;

/// One vhost per currently-**enabled** user (`(user_id, port)` pairs), on
/// top of `STATIC_CADDYFILE` — Caddy's admin API replaces the whole running
/// config atomically on every push, so the static app/shared-sqld vhosts
/// have to be re-included every time, not just the dynamic diff.
/// `docker-proxy` is never touched for this: `app` only needs plain HTTP to
/// `caddy:2019`, which is not published outside the compose network.
async fn push_caddy_config(state: &WebState, routes: &[(i64, i64)]) -> Result<(), String> {
    // Fails fast if unconfigured rather than pushing a Caddyfile whose
    // `{$TANWORDS_PUBLIC_HOST}` placeholder (resolved by Caddy itself, from
    // its own process environment, not by us) would have nothing to resolve
    // to — `caddy`'s environment already carries this var (see compose.yml),
    // so this is purely a local sanity check before making the network call.
    public_host(state)?;
    let mut caddyfile = STATIC_CADDYFILE.to_string();
    for (user_id, port) in routes {
        let upstream = container_name(*user_id);
        caddyfile.push_str(&format!(
            "{{$TANWORDS_PUBLIC_HOST}}:{port} {{\n\
             \ttls {{\n\
             \t\tissuer acme https://acme-v02.api.letsencrypt.org/directory {{\n\
             \t\t\tprofile shortlived\n\
             \t\t}}\n\
             \t}}\n\
             \treverse_proxy {upstream}:8080 {{\n\
             \t\ttransport http {{\n\
             \t\t\tkeepalive off\n\
             \t\t}}\n\
             \t}}\n\
             }}\n\n"
        ));
    }
    let resp = state
        .http
        .post("http://caddy:2019/load")
        .header("Content-Type", "text/caddyfile")
        .body(caddyfile)
        .send()
        .await
        .map_err(|e| format!("caddy admin API unreachable: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("failed to push Caddy config: {status} {body}"))
    }
}

/// Recomputes and pushes the full set of per-user routes from the DB —
/// called after every enable/rotate (port unchanged, harmless to redo)/
/// disable, so Caddy's config never drifts from what `sqld_enabled` says.
async fn resync_caddy_routes(state: &WebState) -> Result<(), String> {
    let routes = state.users.enabled_sqld_routes().await?;
    push_caddy_config(state, &routes).await
}

// ── switching the web session's own connection ─────────────────────────────
//
// Creating the container is only half the point: the whole feature is "web
// and Electron share the same live data," so the browser session's own
// active connection has to move onto the same container too, not just stay
// on its old plain local file. Reused exactly like `turso_connect`/
// `db_select_source("turso")` in db.rs — a `DbProfile::Turso` embedded
// replica — except the target is `http://{container}:8080` on the internal
// compose network (reachable directly, no TLS, no Caddy hop) instead of a
// user-supplied external URL, so `http_util::guard::resolve_public`'s
// private-range refusal (meant for arbitrary user input) is skipped here on
// purpose: this URL is server-generated, not attacker-controlled.
//
// Persisted via the *existing* `turso_url`/`turso_token_enc` columns
// (`set_turso`), not a new "sqld_remote active" concept — that's what makes
// this free: `active_db='turso'` already means "reopen via turso_for() on
// next runtime_for()," so a server restart naturally reconnects this user to
// their own sqld container with no extra plumbing.

fn internal_url(user_id: i64) -> String {
    format!("http://{}:8080", container_name(user_id))
}

/// A container that was just created/recreated (enable's first-time path,
/// or rotate, which always recreates) takes a moment to bind its listener —
/// observed directly against the real server: an immediate connect attempt
/// gets ECONNREFUSED even though `docker_container_action(..., "start")`
/// already returned. Docker reports the container running well before the
/// process inside is actually accepting connections, so this retries briefly
/// rather than surfacing a spurious 500 on an otherwise-successful enable.
async fn open_remote_with_retry(profile: &DbProfile, token: &str) -> Result<tanwords_lib::db::connection::Db, String> {
    let mut last_err = String::new();
    for attempt in 0..10 {
        match tanwords_lib::db::connection::open(profile, Some(token)).await {
            Ok(db) => return Ok(db),
            Err(e) => {
                last_err = e;
                tokio::time::sleep(std::time::Duration::from_millis(300 * (attempt + 1))).await;
            }
        }
    }
    Err(last_err)
}

async fn switch_web_session_to_remote(state: &WebState, session: &UserSession, token: &str) -> Result<(), String> {
    let url = internal_url(session.user_id);
    let replica = state
        .pool
        .user_dir(session.user_id)
        .join("sqld-remote-replica.db");
    for suffix in ["", "-wal", "-shm", "-client_wal_index", "-info"] {
        let _ = std::fs::remove_file(format!("{}{}", replica.display(), suffix));
    }
    let profile = DbProfile::Turso {
        path: replica.to_string_lossy().to_string(),
        url: url.clone(),
    };
    let database = open_remote_with_retry(&profile, token).await?;
    state.users.set_turso(session.user_id, &url, token).await?;
    let runtime = state
        .runtime_for(session)
        .await
        .map_err(|_| "failed to access this account's runtime".to_string())?;
    runtime.ctx.state::<AppState>().replace_db(database)
}

/// Used on disable, so a stopped (unreachable) container doesn't strand the
/// web session — it falls back to the same plain local file it used before
/// remote access was ever turned on.
async fn switch_web_session_to_local(state: &WebState, session: &UserSession) -> Result<(), String> {
    let local_path = state
        .pool
        .user_dir(session.user_id)
        .join("tanwords.db")
        .to_string_lossy()
        .to_string();
    let database = tanwords_lib::db::connection::open(&DbProfile::Local { path: local_path }, None).await?;
    state.users.clear_turso(session.user_id).await?;
    let runtime = state
        .runtime_for(session)
        .await
        .map_err(|_| "failed to access this account's runtime".to_string())?;
    runtime.ctx.state::<AppState>().replace_db(database)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{decode, DecodingKey, Validation};

    // Confirmed against the real server this session: sqld's
    // `SQLD_AUTH_JWT_KEY` decodes the same url-safe-no-pad base64 this test
    // feeds back into `jsonwebtoken`'s own EdDSA decoder — so a token this
    // module signs and a key this module derives are provably a matched
    // pair, not just individually well-formed.
    #[test]
    fn signed_token_verifies_under_its_own_derived_public_key() {
        let key_der = generate_keypair_der().unwrap();
        let token = sign_token(&key_der).unwrap();
        let pubkey_b64 = public_key_b64url(&key_der).unwrap();

        let decoding_key = DecodingKey::from_ed_components(&pubkey_b64).unwrap();
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.validate_exp = true;
        let data = decode::<SqldClaims>(&token, &decoding_key, &validation).unwrap();
        assert!(data.claims.exp > chrono_now_secs());
    }

    #[test]
    fn a_different_keypairs_public_key_rejects_the_token() {
        let key_der = generate_keypair_der().unwrap();
        let token = sign_token(&key_der).unwrap();

        let other_key_der = generate_keypair_der().unwrap();
        let other_pubkey_b64 = public_key_b64url(&other_key_der).unwrap();

        let decoding_key = DecodingKey::from_ed_components(&other_pubkey_b64).unwrap();
        let validation = Validation::new(Algorithm::EdDSA);
        assert!(decode::<SqldClaims>(&token, &decoding_key, &validation).is_err());
    }

    #[test]
    fn generated_keypairs_are_not_reused() {
        let a = generate_keypair_der().unwrap();
        let b = generate_keypair_der().unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn container_and_volume_names_are_stable_and_user_scoped() {
        assert_eq!(container_name(42), "tanwords-sqld-user-42");
        assert_eq!(volume_name(42), "tanwords-sqld-user-42-data");
        assert_ne!(container_name(42), container_name(43));
    }

    #[test]
    fn internal_url_targets_the_containers_own_hostname_over_plain_http() {
        assert_eq!(internal_url(42), "http://tanwords-sqld-user-42:8080");
    }
}
