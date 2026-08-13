use super::json_error;
use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::Response;

/// The Service Worker that proxied pages register (scope `/api/browser/proxy`)
/// to re-route runtime-constructed fetches through the filtering proxy. Served
/// as a public static JS body — it carries no secrets, and the browser's SW
/// update fetch may not carry the `tw_proxy` cookie, so it must not require a
/// session. See `rewrite_html` for the registration injection.
pub(crate) async fn proxy_sw() -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from(SW_SCRIPT))
        .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "sw build failed"))
}

const SW_SCRIPT: &str = r#"
// TanWords browser-proxy Service Worker.
// Registered with scope /api/browser/proxy so it controls the proxied iframe
// (served at /api/browser/proxy?u=...). It intercepts fetches the page makes
// at runtime — including URLs constructed in JS — and re-routes them back
// through the filtering proxy, which the rewritten HTML attributes already do
// for static URLs. Requests already targeting the proxy, plus navigations and
// data:/blob: URIs, pass through untouched, so static sites are unaffected.
const PROXY_PATH = '/api/browser/proxy';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

function pageOf(referrer) {
  if (!referrer) return null;
  try {
    const u = new URL(referrer, self.location.origin);
    if (u.pathname !== PROXY_PATH) return null;
    return { u: u.searchParams.get('u'), block0: u.searchParams.get('block') === '0' };
  } catch (e) { return null; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode === 'navigate') return;
  let u;
  try { u = new URL(req.url); } catch (e) { return; }
  if (u.pathname === PROXY_PATH) return;                         // already proxied
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return; // data:/blob:/...

  event.respondWith((async () => {
    try {
      // Recover the page's original URL (to resolve relative URLs the browser
      // already collapsed onto our origin) and its block state. Prefer the
      // referrer (fast, sync); fall back to the client's URL.
      let page = pageOf(req.referrer);
      if (!page || !page.u) {
        const client = event.clientId ? await self.clients.get(event.clientId) : null;
        page = client ? pageOf(client.url) : null;
      }
      const base = page && page.u ? page.u : null;
      const blockSuffix = page && page.block0 ? '&block=0' : '';

      let resolved;
      if (u.origin === self.location.origin) {
        // The browser resolved a runtime URL against OUR origin (the page is
        // served by us). Re-resolve its path+query against the original page URL
        // so it targets the upstream, then route through the proxy.
        if (!base) return fetch(req);
        try { resolved = new URL(u.pathname + u.search, base).href; }
        catch (e) { return fetch(req); }
      } else {
        resolved = req.url; // cross-origin absolute → wrap directly
      }

      const proxied = PROXY_PATH + '?u=' + encodeURIComponent(resolved) + blockSuffix;
      const init = {
        method: req.method,
        headers: req.headers,
        redirect: req.redirect,
        credentials: 'same-origin',
        mode: 'same-origin',
      };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // Forward the body as bytes, NOT `req.body` (a ReadableStream).
        // Stream request bodies fail outright in several Chromium builds
        // (TypeError: Failed to fetch, request never sent) — that broke every
        // POST through the proxy. Reading the body once and resending it as a
        // Uint8Array works everywhere and is byte-exact. Body sizes here are
        // API payloads (KBs); a huge upload would buffer in the SW, which is
        // fine for a browser page.
        init.body = new Uint8Array(await req.clone().arrayBuffer());
        // `req.headers` is an immutable Headers; copy to a mutable one so the
        // stale Content-Length can be dropped (the browser recomputes it from
        // the new body). Deleting on the original throws "Headers are
        // immutable", which failed every POST through the proxy.
        const hdrs = new Headers(req.headers);
        hdrs.delete('Content-Length');
        init.headers = hdrs;
      }
      return await fetch(proxied, init);
    } catch (e) {
      if (req.method === 'GET' || req.method === 'HEAD') return fetch(req);
      throw e;
    }
  })());
});
"#;
