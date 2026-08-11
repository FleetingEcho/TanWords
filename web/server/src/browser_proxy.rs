//! Server-side filtering proxy for the web-mode Browser page.
//!
//! The desktop Browser page intercepts requests with Electron's
//! `session.webRequest` and asks the shared Rust adblock engine (in the
//! core sidecar) whether to block each subresource. The web build has no
//! Electron, and browser security forbids the app's JS from intercepting
//! cross-origin iframe traffic — so the only way to block ads there is to
//! route the page through this server, which fetches upstream, runs the same
//! `tanwords_lib::adblock` engine, and returns cleaned content with every
//! URL rewritten to come back through the proxy.
//!
//! Route: `GET /api/browser/proxy?u=<absolute-url>`. Auth is the existing
//! session gate (`?token=` on the top-level load, then an HttpOnly
//! `tw_proxy` cookie the handler sets so subresource requests made by the
//! returned HTML stay authenticated without a token in every URL). HTML is
//! rewritten with `lol_html`; other content types are streamed through and
//! engine-checked first.
//!
//! Honest v1 limits (inherent to in-page web proxies): no upstream cookie
//! persistence (login-gated sites won't work), no `<style>`/`url()` or
//! JS-constructed-URL rewriting, and JS-heavy SPAs that build URLs at runtime
//! break. Static/content sites — news, blogs, wikis — work.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Extension,
};
use lol_html::{element, html_content::Element, HtmlRewriter, Settings};
use tanwords_lib::adblock::{self, BlockDecision};

use crate::server::{json_error, UserSession, WebState};

/// The session cookie the proxy sets so subresource requests stay
/// authenticated. Scoped to the proxy path, HttpOnly (no JS), SameSite=Lax
/// (same-origin subresources carry it; never sent cross-site).
const PROXY_COOKIE: &str = "tw_proxy";
const PROXY_PATH: &str = "/api/browser/proxy";

pub async fn browser_proxy(
    State(state): State<WebState>,
    Extension(_session): Extension<UserSession>,
    request: axum::http::Request<Body>,
) -> Response {
    // Extract `u=` from the query (the only parameter the route takes).
    let target_url = match request
        .uri()
        .query()
        .and_then(|q| q.split('&').find_map(|p| p.strip_prefix("u=").map(str::to_string)))
    {
        Some(u) => url::Url::parse(&u).ok(),
        None => None,
    };
    let Some(target) = target_url else {
        return json_error(StatusCode::BAD_REQUEST, "missing or invalid `u` parameter");
    };
    if !matches!(target.scheme(), "http" | "https") {
        return json_error(StatusCode::BAD_REQUEST, "only http/https URLs are proxied");
    }

    // `block=0` disables filtering for this page (the web-mode shield toggle).
    // Defaults on so a missing param still blocks.
    let block_enabled = request
        .uri()
        .query()
        .map(|q| !q.split('&').any(|p| p == "block=0"))
        .unwrap_or(true);

    // SSRF: never let the proxy reach a private/loopback address. Reuses the
    // same guard the AI proxy uses — the user picks the URL, so this is
    // server-dialing-user-URL territory.
    if let Err(e) = tanwords_lib::http_util::guard::resolve_public(target.as_str()).await {
        return json_error(StatusCode::BAD_REQUEST, e);
    }

    // The original page URL, for ad-block `source_url` and Referer. On a
    // subresource request the browser sends the proxy URL of the *page* as
    // Referer; we recover the real page URL from its `u=` query.
    let source_url = referer_original(&request);

    // Build a clean upstream request — never forward our auth/cookies/host.
    let mut up_headers = reqwest::header::HeaderMap::new();
    up_headers.insert(
        reqwest::header::USER_AGENT,
        HeaderValue::from_static("TanWordsBrowser/1.0 (web proxy)"),
    );
    up_headers.insert(reqwest::header::ACCEPT, HeaderValue::from_static("*/*"));
    if let Some(src) = &source_url {
        if let Ok(v) = HeaderValue::from_str(src) {
            up_headers.insert(reqwest::header::REFERER, v);
        }
    }

    let upstream = match state.http.get(target.as_str()).headers(up_headers).send().await {
        Ok(r) => r,
        Err(e) => return json_error(StatusCode::BAD_GATEWAY, format!("upstream fetch failed: {e}")),
    };

    let final_url = upstream.url().clone();
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // For non-document requests, run the engine *before* streaming the body.
    // A blocked subresource gets an empty response (scripts/images vanish
    // cleanly instead of leaving a broken placeholder).
    let is_html = content_type.contains("text/html");
    if !is_html && block_enabled {
        let rtype = guess_resource_type(&content_type, target.as_str());
        let decision = adblock::engine().await.check(target.as_str(), source_url.as_deref().unwrap_or(target.as_str()), rtype).await;
        if let BlockDecision::Block = decision {
            return empty_response(status);
        }
        if let BlockDecision::Redirect(data_url) = decision {
            return redirect_or_data(&data_url);
        }
    }

    // Strip upstream framing/CSP headers — the page must render in our iframe
    // and under our origin, so the upstream's CSP would break it.
    let mut builder = Response::builder().status(status);
    builder = strip_framing_headers(builder, &content_type);

    // If top-level HTML: rewrite URLs through the proxy.
    if is_html {
        let body = match upstream.bytes().await {
            Ok(b) => b,
            Err(e) => return json_error(StatusCode::BAD_GATEWAY, format!("upstream read failed: {e}")),
        };
        // Fetch cosmetic resources (CSS + YouTube script) for this URL from
        // the shared engine, in-process. Injected at the TOP of <head> so the
        // script runs before YouTube's own inline scripts.
        let cosmetics = if block_enabled {
            adblock::cosmetics_for(final_url.as_str()).await
        } else {
            tanwords_lib::adblock::CosmeticResources { stylesheet: String::new(), script: String::new() }
        };
        match rewrite_html(&body, &final_url, block_enabled, &cosmetics) {
            Ok(rewritten) => {
                let mut resp = builder.body(Body::from(rewritten)).unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "rewrite failed"));
                set_proxy_cookie(&mut resp, &request);
                return resp;
            }
            Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "html rewrite failed"),
        }
    }

    // Everything else: stream bytes through verbatim (already engine-checked).
    builder
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "failed to stream upstream"))
}

/// Recover the real page URL from a `Referer` that is itself a proxy URL.
fn referer_original(request: &axum::http::Request<Body>) -> Option<String> {
    let r = request.headers().get(reqwest::header::REFERER)?.to_str().ok()?;
    let u = url::Url::parse(r).ok()?;
    u.query_pairs().find(|(k, _)| k == "u").map(|(_, v)| v.into_owned())
}

/// Strip headers that would prevent the response rendering inside our iframe
/// (CSP, X-Frame-Options), and set our own content-type.
fn strip_framing_headers(mut builder: axum::http::response::Builder, content_type: &str) -> axum::http::response::Builder {
    // We deliberately do NOT copy Content-Security-Policy or X-Frame-Options
    // from upstream — they'd block framing and inline scripts under our origin.
    builder = builder.header(header::CONTENT_TYPE, content_type);
    if content_type.is_empty() {
        builder = builder.header(header::CONTENT_TYPE, "application/octet-stream");
    }
    builder
}

fn empty_response(_status: StatusCode) -> Response {
    // A 204 with no body: scripts/images just don't load, no broken icon.
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .unwrap()
}

fn redirect_or_data(data_url: &str) -> Response {
    if data_url.starts_with("data:") || data_url.starts_with("http") {
        return axum::response::Redirect::temporary(data_url).into_response();
    }
    empty_response(StatusCode::NO_CONTENT)
}

/// Set the `tw_proxy` session cookie on a top-level proxy response so that
/// the subresource requests the returned HTML makes are authenticated.
fn set_proxy_cookie(resp: &mut Response, request: &axum::http::Request<Body>) {
    // Only set when the caller authenticated via `?token=` (top-level load).
    // Subresource requests arrive with the cookie, not a query token.
    let has_query_token = request
        .uri()
        .query()
        .map(|q| q.split('&').any(|p| p.starts_with("token=")))
        .unwrap_or(false);
    if !has_query_token {
        return;
    }
    let token = request
        .uri()
        .query()
        .and_then(|q| q.split('&').find_map(|p| p.strip_prefix("token=").map(str::to_string)));
    let Some(token) = token else { return };
    let value = format!(
        "{}={}; HttpOnly; SameSite=Lax; Path={}; Max-Age=3600",
        PROXY_COOKIE, token, PROXY_PATH
    );
    if let Ok(v) = HeaderValue::from_str(&value) {
        resp.headers_mut().insert(HeaderName::from_static("set-cookie"), v);
    }
}

/// Map a content-type (or URL) to an ABP-style resource type for the engine.
fn guess_resource_type(content_type: &str, url: &str) -> &'static str {
    if content_type.contains("text/css") {
        "stylesheet"
    } else if content_type.contains("javascript") || content_type.contains("ecmascript") {
        "script"
    } else if content_type.contains("image/") {
        "image"
    } else if content_type.contains("font/") || content_type.contains("application/font") {
        "font"
    } else if content_type.contains("video/") {
        "media"
    } else if content_type.contains("xmlhttprequest") || content_type.contains("json") {
        "xhr"
    } else if url.ends_with(".css") {
        "stylesheet"
    } else if url.ends_with(".js") {
        "script"
    } else if matches!(url.rsplit('.').next(), Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "ico")) {
        "image"
    } else {
        "other"
    }
}

/// Rewrite every URL-bearing attribute in an HTML document to route through
/// the proxy, resolving relatives against the page's final URL. Also injects
/// cosmetic resources (CSS + YouTube script) at the top of `<head>`.
fn rewrite_html(body: &[u8], base_url: &url::Url, block_enabled: bool, cosmetics: &tanwords_lib::adblock::CosmeticResources) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let base = base_url.clone();
    let mut output: Vec<u8> = Vec::with_capacity(body.len());

    // Build the injection snippet: a <style> for hide-selectors and a <script>
    // for the YouTube json-prune. Placed at the TOP of <head> so it runs before
    // any of the page's own inline scripts.
    let mut inject = String::new();
    if !cosmetics.stylesheet.is_empty() {
        inject.push_str(&format!("<style>{}{{display:none!important}}</style>", cosmetics.stylesheet));
    }
    if !cosmetics.script.is_empty() {
        inject.push_str(&format!("<script>{}</script>", cosmetics.script));
    }
    let inject_for_head = inject.clone();

    let mut rewriter = HtmlRewriter::new(
        Settings::new()
            .append_element_content_handler(element!(
                "head",
                move |el| {
                    if !inject_for_head.is_empty() {
                        el.prepend(&inject_for_head, lol_html::html_content::ContentType::Html);
                    }
                    Ok(())
                }
            ))
            .append_element_content_handler(element!(
                "[src],[href],[data],[srcset],[poster],[action],[background]",
                move |el| {
                    rewrite_element_urls(el, &base, block_enabled);
                    Ok(())
                }
            )),
        |c: &[u8]| output.extend_from_slice(c),
    );

    rewriter.write(body)?;
    rewriter.end()?;
    Ok(output)
}

/// Rewrite the URL attributes on a single element, skipping `<base href>`
/// (rewriting it would mis-resolve the page's other relative URLs).
fn rewrite_element_urls(el: &mut Element, base: &url::Url, block_enabled: bool) {
    let tag = el.tag_name();
    for (attr, multi) in [
        ("src", false), ("href", false), ("data", false), ("poster", false),
        ("action", false), ("background", false), ("srcset", true),
    ] {
        if let Some(val) = el.get_attribute(attr) {
            if tag.eq_ignore_ascii_case("base") && attr == "href" {
                continue;
            }
            let new = if multi {
                rewrite_srcset(&val, base, block_enabled)
            } else {
                rewrite_one(&val, base, block_enabled)
            };
            if new != val {
                let _ = el.set_attribute(attr, &new);
            }
        }
    }
}

fn rewrite_one(val: &str, base: &url::Url, block_enabled: bool) -> String {
    match base.join(val) {
        Ok(resolved) => proxy_url(&resolved, block_enabled),
        Err(_) => val.to_string(),
    }
}

/// `srcset` is a comma list of `url [descriptor]` candidates.
fn rewrite_srcset(val: &str, base: &url::Url, block_enabled: bool) -> String {
    val.split(',')
        .map(|candidate| {
            let candidate = candidate.trim_start();
            let (url_part, desc) = match candidate.find(char::is_whitespace) {
                Some(i) => (&candidate[..i], &candidate[i..]),
                None => (candidate, ""),
            };
            let url_part = url_part.trim_matches(|c| c == '"' || c == '\'');
            let rewritten = rewrite_one(url_part, base, block_enabled);
            if desc.is_empty() { rewritten } else { format!("{rewritten}{desc}") }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn proxy_url(resolved: &url::Url, block_enabled: bool) -> String {
    let base = format!("{}?u={}", PROXY_PATH, urlencoding::encode(resolved.as_str()));
    if block_enabled { base } else { format!("{base}&block=0") }
}

// Percent-encode only the characters that would break the proxy's own
// `u=` query parsing (`&`, `=`, `#`) plus `%` (avoid double-encoding).
// The `url` crate already percent-encodes non-ASCII in `resolved.as_str()`,
// so the input here is ASCII and a byte-wise scan is correct.
mod urlencoding {
    pub fn encode(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        for &b in input.as_bytes() {
            match b {
                b'&' => out.push_str("%26"),
                b'=' => out.push_str("%3D"),
                b'#' => out.push_str("%23"),
                b'%' => out.push_str("%25"),
                _ => out.push(b as char),
            }
        }
        out
    }
}

// Keep the Arc import meaningful if future handlers need shared state.
#[allow(dead_code)]
fn _unused(_: Arc<()>) {}
