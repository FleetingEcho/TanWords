//! Shared ad/tracker-blocking engine for the Browser page.
//!
//! One implementation serves both hosts:
//!   - **Desktop**: the Electron main process intercepts requests with
//!     `session.webRequest.onBeforeRequest` (an Electron-only API the Rust
//!     sidecar can't reach) and asks this engine — running in the `tanwords`
//!     core sidecar over localhost — whether each subresource should be
//!     blocked. The matching logic is Rust, not a JS adblock library.
//!   - **Web**: the axum server runs this same engine as it proxies the
//!     iframe's page and subresources (see `web/server`).
//!
//! The engine is built from EasyList + EasyPrivacy (the same lists the
//! `@ghostery` "ads+tracking" preset uses). Lists are fetched from
//! easylist.to on first use and the compiled engine is cached to disk, so
//! later launches work offline and stay fast. The build is lazy and
//! fallible: if the fetch fails (first run, offline), checks allow
//! everything — a missing blocker never breaks browsing.
//!
//! `adblock::Engine` is `!Send + !Sync` (it owns `Rc`/`RefCell`), so it
//! cannot be shared across tokio worker threads via an `Arc`. Instead it
//! lives on one dedicated OS thread (with its own current-thread runtime
//! for the async list fetch); other tasks talk to it through a channel.
//! A check is a single in-process hop plus a microsecond engine match.

use std::sync::Arc;
use std::time::Duration;

use adblock::{
    lists::FilterSet,
    request::Request as AdRequest,
    Engine,
};
use serde::Serialize;
use tokio::sync::{mpsc, oneshot, OnceCell};

/// Where on disk the serialized engine lives. Sits in the OS cache dir
/// alongside the rest of the app's caches.
fn cache_path() -> Option<std::path::PathBuf> {
    let dir = dirs::cache_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(std::env::temp_dir);
    Some(dir.join("tanwords").join("adblock-engine.bin"))
}

/// The two lists that make up the "ads + tracking" preset. Mirrors the
/// `@ghostery/adblocker` `fromPrebuiltAdsAndTracking` bundle the desktop
/// build used before the move to Rust.
const LIST_URLS: &[&str] = &[
    "https://easylist.to/easylist/easylist.txt",
    "https://easylist.to/easyprivacy/easyprivacy.txt",
];

/// What to do with a request the engine was asked about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockDecision {
    /// Let it through unchanged.
    Allow,
    /// Cancel the request (ad/tracker matched).
    Block,
    /// Redirect to this URL/`data:` instead. `redirect` filters replace the
    /// resource (e.g. an empty pixel for a tracked beacon).
    Redirect(String),
}

/// A message to the engine worker thread: either a network check or a
/// cosmetics query, each with its reply slot.
enum WorkerMsg {
    Check {
        url: String,
        source: String,
        rtype: String,
        reply: oneshot::Sender<BlockDecision>,
    },
    Cosmetics {
        url: String,
        reply: oneshot::Sender<adblock::cosmetic_filter_cache::UrlSpecificResources>,
    },
}

/// Handle to the engine worker. Cheap to clone (the channel sender is shared);
/// every clone talks to the same single-threaded engine.
#[derive(Clone)]
pub struct AdblockEngine {
    tx: Arc<mpsc::UnboundedSender<WorkerMsg>>,
}

impl AdblockEngine {
    /// Decide what to do with one outgoing request.
    ///
    /// `source_url` is the page that triggered the request (the referer);
    /// `resource_type` is an ABP-style type token (`script`, `image`,
    /// `stylesheet`, `xhr`, `document`, `sub_frame`, `other`, …). The engine
    /// falls back to URL-based type guessing for `other`.
    ///
    /// Fails open: if the worker is unreachable or doesn't reply in time, the
    /// request is allowed — a blocker must never stall or blank a page.
    pub async fn check(&self, url: &str, source_url: &str, resource_type: &str) -> BlockDecision {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self
            .tx
            .send(WorkerMsg::Check {
                url: url.to_string(),
                source: source_url.to_string(),
                rtype: resource_type.to_string(),
                reply: reply_tx,
            })
            .is_err()
        {
            return BlockDecision::Allow;
        }
        match tokio::time::timeout(Duration::from_millis(500), reply_rx).await {
            Ok(Ok(d)) => d,
            _ => BlockDecision::Allow,
        }
    }

    /// Query the engine's cosmetic filter cache for a URL. Returns hide
    /// selectors + (if resources are loaded) injected scriptlets. Fails open
    /// with empty resources on timeout/worker-down.
    pub async fn url_cosmetic_resources(&self, url: &str) -> adblock::cosmetic_filter_cache::UrlSpecificResources {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self
            .tx
            .send(WorkerMsg::Cosmetics {
                url: url.to_string(),
                reply: reply_tx,
            })
            .is_err()
        {
            return adblock::cosmetic_filter_cache::UrlSpecificResources::empty();
        }
        match tokio::time::timeout(Duration::from_millis(500), reply_rx).await {
            Ok(Ok(r)) => r,
            _ => adblock::cosmetic_filter_cache::UrlSpecificResources::empty(),
        }
    }
}

/// Global, lazily-initialized handle to the worker thread.
static ENGINE: OnceCell<AdblockEngine> = OnceCell::const_new();

/// Returns a handle to the shared engine, spawning the worker on first call.
/// The worker builds the engine in the background (fetch → cache) and answers
/// `Allow` for everything until the build completes, so the first page load
/// after a cold start isn't blocked behind the list fetch.
pub async fn engine() -> AdblockEngine {
    ENGINE
        .get_or_init(|| async {
            let (tx, rx) = mpsc::unbounded_channel::<WorkerMsg>();
            std::thread::Builder::new()
                .name("tanwords-adblock".into())
                .spawn(move || engine_worker(rx))
                .expect("spawn adblock engine worker");
            AdblockEngine { tx: Arc::new(tx) }
        })
        .await
        .clone()
}

/// The worker thread: owns the `!Send` engine, never shares it. Runs a
/// current-thread tokio runtime so the list fetch can be async.
fn engine_worker(mut rx: mpsc::UnboundedReceiver<WorkerMsg>) {
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(_) => {
            drain_allow(&mut rx);
            return;
        }
    };
    rt.block_on(async move {
        // Build first (or load from cache); until it's ready, every check
        // is allowed. The build is awaited, so early-arriving checks queue
        // in the unbounded channel and are answered once the engine exists.
        let engine = build_engine().await;
        while let Some(msg) = rx.recv().await {
            match msg {
                WorkerMsg::Check { url, source, rtype, reply } => {
                    let decision = match &engine {
                        Some(e) => decide(e, &url, &source, &rtype),
                        None => BlockDecision::Allow,
                    };
                    let _ = reply.send(decision);
                }
                WorkerMsg::Cosmetics { url, reply } => {
                    let res = match &engine {
                        Some(e) => e.url_cosmetic_resources(&url),
                        None => adblock::cosmetic_filter_cache::UrlSpecificResources::empty(),
                    };
                    let _ = reply.send(res);
                }
            }
        }
    });
}

/// Drain a channel with `Allow`/empty — used only when the runtime itself
/// failed to build, which is effectively never.
fn drain_allow(rx: &mut mpsc::UnboundedReceiver<WorkerMsg>) {
    while let Ok(msg) = rx.try_recv() {
        match msg {
            WorkerMsg::Check { reply, .. } => { let _ = reply.send(BlockDecision::Allow); }
            WorkerMsg::Cosmetics { reply, .. } => { let _ = reply.send(adblock::cosmetic_filter_cache::UrlSpecificResources::empty()); }
        }
    }
}

fn decide(engine: &Engine, url: &str, source: &str, rtype: &str) -> BlockDecision {
    // Never block a top-level document load — that would blank the page.
    if rtype.eq_ignore_ascii_case("document")
        || rtype.eq_ignore_ascii_case("main_frame")
    {
        return BlockDecision::Allow;
    }
    let request = match AdRequest::new(url, source, rtype) {
        Ok(r) => r,
        Err(_) => return BlockDecision::Allow,
    };
    let result = engine.check_network_request(&request);
    if result.matched {
        BlockDecision::Block
    } else if let Some(redirect) = result.redirect {
        BlockDecision::Redirect(redirect)
    } else {
        BlockDecision::Allow
    }
}

/// Fetch the lists (or load the cached compiled engine) and build an `Engine`.
/// Returns `None` on any failure so checks degrade to allow-all.
async fn build_engine() -> Option<Engine> {
    if let Some(engine) = load_cached() {
        return Some(engine);
    }

    let client = reqwest::Client::builder()
        .gzip(true)
        .brotli(true)
        .timeout(Duration::from_secs(60))
        .build()
        .ok()?;

    let mut filter_set = FilterSet::new(false);
    for url in LIST_URLS {
        match client.get(*url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => {
                    let _ = filter_set.add_filter_list(&text, Default::default());
                }
                Err(_) => return None,
            },
            _ => return None, // a missing list means an incomplete engine
        }
    }
    let engine = Engine::from_filter_set(filter_set, true);
    if let Some(path) = cache_path() {
        if std::fs::create_dir_all(path.parent()?).is_ok() {
            let _ = std::fs::write(path, engine.serialize());
        }
    }
    Some(engine)
}

fn load_cached() -> Option<Engine> {
    let path = cache_path()?;
    let bytes = std::fs::read(path).ok()?;
    let mut engine = Engine::default();
    engine.deserialize(&bytes).ok()?;
    Some(engine)
}

/// Cosmetic resources for a page: a CSS stylesheet (EasyList `##selector` hide
/// rules — these work without a resource library) and an optional injected
/// script (for YouTube, a targeted `json-prune` that removes ad metadata from
/// the player config before YouTube's own scripts read it).
#[derive(Serialize, Clone)]
pub struct CosmeticResources {
    #[serde(rename = "stylesheet")]
    pub stylesheet: String,
    #[serde(rename = "script")]
    pub script: String,
}

/// The self-contained YouTube ad-pruning script. Distilled from uBlock Origin's
/// `json-prune` scriptlet approach into ~40 lines that run at document-start:
/// intercepts `ytInitialPlayerResponse` (the inline global YouTube sets) and
/// `JSON.parse` (catches the `/youtubei/v1/player` XHR response), deleting
/// `adPlacements`/`playerAds` so the player never learns an ad exists. Plus CSS
/// that hides any ad container that still renders.
const YOUTUBE_SCRIPT: &str = r#"(function(){'use strict';
var K=['adPlacements','playerAds','adParams','adBreakHeartbeatParams','adSignalingParams','adSlots'];
function p(o){if(!o||typeof o!=='object')return o;for(var i=0;i<K.length;i++){try{delete o[K[i]]}catch(e){}}if(o.playerResponse&&typeof o.playerResponse==='object'){for(var i=0;i<K.length;i++){try{delete o.playerResponse[K[i]]}catch(e){}}}return o}
// Wrap JSON.parse — YouTube's player config is parsed from JSON.
var _j=JSON.parse;JSON.parse=function(){var r=_j.apply(this,arguments);if(r&&typeof r==='object'&&(r.adPlacements||r.playerAds||r.adSlots)){return p(r)}return r};
// Wrap Response.prototype.json — YouTube loads /youtubei/v1/player via fetch().then(r=>r.json()).
if(self.Response){var _k=Response.prototype.json;Response.prototype.json=function(){return _k.call(this).then(function(r){if(r&&typeof r==='object'&&(r.adPlacements||r.playerAds||r.adSlots)){return p(r)}return r})}}
// CSS hides any ad container that still renders.
var s=document.createElement('style');s.textContent='.ad-showing,#masthead-ad,.ytd-ad-slot-renderer,.ytp-ad-overlay-container,.ytp-ad-module,.ytd-banner-promo-renderer,.ytd-search-pyv-renderer,.ytd-promo-video-renderer{display:none!important}';(document.head||document.documentElement).appendChild(s)
})();"#;

/// Returns the cosmetic resources (CSS + script) to inject for a given page
/// URL. EasyList hide-selectors are returned for every site (they work without
/// a resource library). YouTube pages additionally get the targeted ad-pruning
/// script — the one thing network blocking genuinely cannot do, since YouTube
/// streams ads from the same CDN as content.
pub async fn cosmetics_for(url: &str) -> CosmeticResources {
    let engine = engine().await;
    let mut stylesheet = String::new();

    // EasyList cosmetic hide-selectors (no resource library needed — these
    // are plain CSS `##selector` rules, not scriptlets).
    let res = engine.url_cosmetic_resources(url).await;
    if !res.hide_selectors.is_empty() {
        stylesheet.push_str(&res.hide_selectors.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(","));
        stylesheet.push_str("{display:none!important}");
    }

    // YouTube: append the targeted ad-pruning script.
    let is_youtube = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.ends_with("youtube.com") || h.ends_with("youtube-nocookie.com")))
        .unwrap_or(false);
    let script = if is_youtube { YOUTUBE_SCRIPT.to_string() } else { String::new() };

    CosmeticResources { stylesheet, script }
}

/// RPC result for `adblock_check` — what the desktop's Electron main process
/// asks the sidecar on every subresource request.
#[derive(Serialize)]
pub struct AdblockCheckResult {
    #[serde(rename = "block")]
    pub block: bool,
    #[serde(rename = "redirect")]
    pub redirect: Option<String>,
}

/// Decide what to do with one request, asked over the sidecar RPC by the
/// desktop Electron main's `session.webRequest.onBeforeRequest` handler. The
/// matching runs here, in the Rust core; Electron main only interprets the
/// answer. (On web the proxy calls `engine().check` in-process instead.)
#[crate::shim::command]
pub async fn adblock_check(
    url: String,
    source_url: String,
    resource_type: String,
) -> Result<AdblockCheckResult, String> {
    let engine = engine().await;
    Ok(match engine.check(&url, &source_url, &resource_type).await {
        BlockDecision::Allow => AdblockCheckResult { block: false, redirect: None },
        BlockDecision::Block => AdblockCheckResult { block: true, redirect: None },
        BlockDecision::Redirect(r) => AdblockCheckResult { block: false, redirect: Some(r) },
    })
}

/// RPC for `adblock_cosmetics` — returns the CSS + script to inject into a
/// page. Called by the desktop preload (via a sync IPC hop to main, which
/// fetches from the sidecar) and by the web proxy (in-process).
#[crate::shim::command]
pub async fn adblock_cosmetics(url: String) -> Result<CosmeticResources, String> {
    Ok(cosmetics_for(&url).await)
}
