use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::Response;

use tanwords_lib::db;
use tanwords_lib::AppState;

use super::{json_error, UserSession, WebState};

// ── AI provider proxy (keys stay on the server) ───────────────────────────

/// Forwards provider API calls with the credential injected from the
/// encrypted `ai_providers` row, mirroring exactly how the desktop renderer's
/// providers authenticate (`x-api-key` for Anthropic, Bearer otherwise).
/// The response body — typically an SSE token stream — is proxied through
/// unbuffered, status included.
pub(super) async fn ai_proxy(
    State(state): State<WebState>,
    Path((provider_id, rest)): Path<(String, String)>,
    method: Method,
    axum::Extension(session): axum::Extension<UserSession>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let app_state = runtime.ctx.state::<AppState>();
    let conn = match db::conn(&app_state) {
        Ok(c) => c,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let device = tanwords_lib::appconfig::device_id();
    let providers = match db::ai_providers::list(&conn, &device).await {
        Ok(p) => p,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let Some(provider) = providers.into_iter().find(|p| p.id == provider_id) else {
        return json_error(
            StatusCode::NOT_FOUND,
            format!("unknown provider `{provider_id}`"),
        );
    };
    let api_key = match db::ai_providers::key(&conn, &device, &provider_id).await {
        Ok(k) => k,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };

    let base = if !provider.api_base.trim().is_empty() {
        provider.api_base.trim_end_matches('/').to_string()
    } else if provider_id == "openai" {
        "https://api.openai.com/v1".to_string()
    } else if provider_id == "claude" {
        "https://api.anthropic.com".to_string()
    } else {
        return json_error(
            StatusCode::BAD_REQUEST,
            format!("provider `{provider_id}` has no base URL configured"),
        );
    };

    let rest = rest.trim_start_matches('/');
    if rest.is_empty() || rest.contains("..") {
        return json_error(StatusCode::BAD_REQUEST, "invalid upstream path");
    }

    // `api_base` is set by the user through ai_provider_upsert, so this is a
    // URL of their choosing that the *server* dials — the same SSRF the core's
    // fetch guard exists for. Without this, pointing a "provider" at
    // 169.254.169.254 turns the proxy into a reader for the cloud metadata
    // service, credentials included, and streams the answer back.
    let target = format!("{base}/{rest}");
    if let Err(e) = tanwords_lib::http_util::guard::resolve_public(&target).await {
        return json_error(StatusCode::BAD_REQUEST, e);
    }

    // Build a fresh header set: forward content intent, inject credentials —
    // never forward the caller's own Authorization/Cookie/Host headers, so a
    // web client cannot talk to the provider with anything but the stored key.
    let mut up_headers = reqwest::header::HeaderMap::new();
    if let Some(ct) = headers.get(header::CONTENT_TYPE) {
        up_headers.insert(reqwest::header::CONTENT_TYPE, ct.clone());
    }
    if let Some(accept) = headers.get(header::ACCEPT) {
        up_headers.insert(reqwest::header::ACCEPT, accept.clone());
    }
    let is_anthropic = provider_id == "claude";
    match HeaderValue::from_str(&api_key) {
        Ok(key_value) => {
            if is_anthropic {
                up_headers.insert("x-api-key", key_value);
                let version = headers
                    .get("anthropic-version")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("2023-06-01");
                if let Ok(v) = HeaderValue::from_str(version) {
                    up_headers.insert("anthropic-version", v);
                }
                if let Some(beta) = headers.get("anthropic-beta") {
                    up_headers.insert("anthropic-beta", beta.clone());
                }
            } else if !api_key.is_empty() {
                if let Ok(v) = HeaderValue::from_str(&format!("Bearer {api_key}")) {
                    up_headers.insert(reqwest::header::AUTHORIZATION, v);
                }
            }
        }
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "stored API key is not a valid header value",
            )
        }
    }

    // Forward with the caller's method, not a hardcoded POST: the settings
    // page lists models with a GET /models call (OpenAI-compatible
    // convention), while chat/completions is POST. Only body-carrying
    // methods forward the request payload — a GET never has one.
    let mut upstream_req = state.http.request(method.clone(), &target).headers(up_headers);
    if matches!(method, Method::POST | Method::PUT | Method::PATCH) {
        upstream_req = upstream_req.body(body);
    }
    let upstream = match upstream_req.send().await {
        Ok(r) => r,
        Err(e) => {
            return json_error(
                StatusCode::BAD_GATEWAY,
                format!("upstream request failed: {e}"),
            )
        }
    };

    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut builder = Response::builder().status(status);
    if let Some(ct) = upstream.headers().get(reqwest::header::CONTENT_TYPE) {
        builder = builder.header(header::CONTENT_TYPE, ct);
    }
    // Pass the stream straight through: buffering an OpenAI/Anthropic SSE
    // completion would leave the chat UI blank until the model finished.
    builder
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|_| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to build upstream response",
            )
        })
}
