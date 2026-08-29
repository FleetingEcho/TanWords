use std::path::{Component, PathBuf};

use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

use super::{json_error, WebState};
use crate::embedded::Assets;

// ── the SPA ───────────────────────────────────────────────────────────────

/// Minimal extension->MIME map; the frontend build only emits a handful.
fn content_type_for(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

/// Resolves a request path inside the dist dir; `..` is rejected up front.
fn resolve_dist(web_dist: &std::path::Path, uri_path: &str) -> Option<PathBuf> {
    let mut out = web_dist.to_path_buf();
    for component in std::path::Path::new(uri_path.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

pub(super) async fn spa_handler(State(state): State<WebState>, request: Request) -> Response {
    if request.method() != axum::http::Method::GET && request.method() != axum::http::Method::HEAD {
        return json_error(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    let path = request.uri().path().to_string();

    // Unknown API-shaped paths must not silently return the app shell.
    for prefix in ["/api/", "/invoke/", "/events"] {
        if path.starts_with(prefix) {
            return json_error(StatusCode::NOT_FOUND, "not found");
        }
    }

    let (bytes, content_type, cache): (Vec<u8>, &'static str, &'static str) =
        if let Some(dist) = state.config.web_dist.as_ref() {
            let mut is_index = false;
            let mut is_hashed_asset = path.starts_with("/assets/");
            // `tokio::fs::metadata`, not `Path::is_file()`: this is the
            // hottest unauthenticated path in the server, and a blocking
            // stat inside async stalls a tokio worker on slow/network
            // filesystems.
            let candidate = resolve_dist(dist, &path);
            let is_file = match &candidate {
                Some(f) => tokio::fs::metadata(f).await.map(|m| m.is_file()).unwrap_or(false),
                None => false,
            };
            let mut file = if is_file {
                candidate.expect("checked just above")
            } else {
                // SPA fallback: client-side routes get index.html.
                is_index = true;
                is_hashed_asset = false;
                dist.join("index.html")
            };
            if !is_index && file == *dist {
                is_index = true;
                file = dist.join("index.html");
            }

            let bytes = match tokio::fs::read(&file).await {
                Ok(bytes) => bytes,
                Err(_) => {
                    return json_error(
                        StatusCode::NOT_FOUND,
                        "not found (is the frontend built into TANWORDS_WEB_DIST?)",
                    );
                }
            };
            let content_type = content_type_for(&file);
            let cache = if is_index {
                "no-store"
            } else if is_hashed_asset {
                "public, max-age=31536000, immutable"
            } else {
                "public, max-age=3600"
            };
            (bytes, content_type, cache)
        } else {
            let relative = path.trim_start_matches('/');
            let mut is_index = false;
            let mut is_hashed_asset = path.starts_with("/assets/");
            let data = Assets::get(relative).or_else(|| {
                is_index = true;
                is_hashed_asset = false;
                Assets::get("index.html")
            });
            let Some(data) = data else {
                return json_error(
                    StatusCode::NOT_FOUND,
                    "not found (is the frontend built into TANWORDS_WEB_DIST?)",
                );
            };
            let served_path = if is_index { "index.html" } else { relative };
            let content_type = content_type_for(std::path::Path::new(served_path));
            let cache = if is_index {
                "no-store"
            } else if is_hashed_asset {
                "public, max-age=31536000, immutable"
            } else {
                "public, max-age=3600"
            };
            (data.data.into_owned(), content_type, cache)
        };

    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, cache),
        ],
        bytes,
    )
        .into_response()
}
