//! Integration tests for the shared adblock engine.
//!
//! These hit the network (they build the engine from the real filter lists),
//! so they are `#[ignore]`d by default — run with `cargo test -- --ignored
//! adblock` or `cargo test -p tanwords --test adblock -- --ignored`.

use tanwords_lib::adblock;

/// The embedded resource bundle must parse into adblock-rust `Resource`s.
/// This runs without network and guards the whole scriptlet/redirect story:
/// if the bundle drifts out of the crate's expected format, every
/// `##+js(...)` rule silently goes dead.
#[test]
fn embedded_resources_parse() {
    let src = include_str!("../src/resources/ublock-resources.json");
    let resources: Vec<adblock::AdblockResource> =
        serde_json::from_str(src).expect("resource bundle must deserialize");
    assert!(!resources.is_empty(), "bundle must not be empty");
    // The names uBO's YouTube rules actually reference.
    let names: Vec<&str> = resources.iter().map(|r| r.name.as_str()).collect();
    assert!(names.contains(&"json-prune.js"), "json-prune scriptlet missing");
    assert!(names.contains(&"set-constant.js"), "set-constant scriptlet missing");
    assert!(names.contains(&"1x1.gif"), "1x1.gif redirect missing");
    assert!(names.contains(&"noop.js"), "noop.js redirect missing");
}

/// End-to-end: after a real build, YouTube pages must yield an injected
/// script (the uBO scriptlets — `json-prune` etc.) and non-trivial CSS
/// selectors. Network required.
#[tokio::test]
#[ignore = "network: fetches the real filter lists"]
async fn youtube_gets_scriptlets_and_selectors() {
    let res = wait_for_engine("https://www.youtube.com/watch?v=aqz-KE-bpKQ").await;
    // The scriptlet library must produce a real script for YouTube (uBO's
    // filters.txt / quick-fixes.txt target it with `##+js(...)` rules).
    assert!(
        !res.script.is_empty(),
        "expected injected script for youtube.com, got empty (resources not loaded?)"
    );
    assert!(
        res.script.contains("jsonPrune") || res.script.contains("json-prune"),
        "expected a json-prune scriptlet in the injected script"
    );
}

/// The network decision path: a well-known tracker should be blocked while a
/// benign host passes. Network required.
#[tokio::test]
#[ignore = "network: fetches the real filter lists"]
async fn network_decisions() {
    let engine = adblock::engine().await;
    // Cold starts serve allow-all until the build lands; poll for the first
    // blocking decision so this test doesn't race the background build.
    let mut ready = false;
    for _ in 0..40 {
        if engine
            .check(
                "https://ad.doubleclick.net/pixel.gif",
                "https://example.com/",
                "image",
            )
            .await
            == adblock::BlockDecision::Block
        {
            ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    assert!(ready, "engine never became ready");
    let allowed = engine
        .check(
            "https://cdn.example.com/app.js",
            "https://example.com/",
            "script",
        )
        .await;
    assert_eq!(allowed, adblock::BlockDecision::Allow);
}

/// Electron's `webRequest` reports Chromium's camelCase resource types, but
/// adblock-rust matches snake_case ABP tokens and silently degrades anything
/// it doesn't recognise to `Other`. Without normalization every ad iframe
/// arrived as `subFrame` → `Other`, so `$subdocument` rules never fired.
/// Network required.
#[tokio::test]
#[ignore = "network: fetches the real filter lists"]
async fn electron_resource_types_are_normalized() {
    let engine = wait_for_network_engine().await;
    // Matched by EasyList's `/ads_iframe.$subdocument` — a rule that applies
    // to frames and nothing else, so it can tell the two spellings apart.
    let url = "https://third-party.example.net/ads_iframe.html";
    let source = "https://example.com/page";
    assert_eq!(
        engine.check(url, source, "sub_frame").await,
        adblock::BlockDecision::Block,
        "$subdocument rule should block the ABP spelling",
    );
    assert_eq!(
        engine.check(url, source, "subFrame").await,
        adblock::BlockDecision::Block,
        "Electron's camelCase spelling must reach the same decision",
    );
    // Guards the premise: this URL is blocked *because* of its type, so the
    // assertions above would still pass if normalization regressed to Other.
    assert_eq!(
        engine.check(url, source, "other").await,
        adblock::BlockDecision::Allow,
        "the rule is type-scoped — an untyped request is not blocked",
    );
}

/// Domain-scoped rules (`$domain=youtube.com`, `$third-party`) are evaluated
/// against the *source document*, so the caller must pass the real page URL.
/// This is why the desktop panel reads the requesting frame's URL rather than
/// `details.referrer`, which is empty or origin-only for most subresources —
/// with no source, uBO's YouTube rules quietly stop matching. Network
/// required.
#[tokio::test]
#[ignore = "network: fetches the real filter lists"]
async fn domain_scoped_rules_need_the_source_document() {
    let engine = wait_for_network_engine().await;
    // uBO/EasyList: `||www.youtube.com/get_midroll_$domain=youtube.com`.
    let url = "https://www.youtube.com/get_midroll_info?v=1";
    assert_eq!(
        engine.check(url, "https://www.youtube.com/watch?v=abc", "xhr").await,
        adblock::BlockDecision::Block,
        "midroll rule should match when the source document is the watch page",
    );
    assert_eq!(
        engine.check(url, "", "xhr").await,
        adblock::BlockDecision::Allow,
        "premise: an empty source silently loses the $domain= match",
    );
}

/// Poll until the engine's first real (non-allow-all) decision lands, then
/// hand back the ready handle.
async fn wait_for_network_engine() -> adblock::AdblockEngine {
    let engine = adblock::engine().await;
    for _ in 0..40 {
        if engine
            .check("https://ad.doubleclick.net/pixel.gif", "https://example.com/", "image")
            .await
            == adblock::BlockDecision::Block
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    engine
}

/// Poll `cosmetics_for` until the engine build lands (cold starts serve
/// allow-all while the lists fetch in the background).
async fn wait_for_engine(url: &str) -> adblock::CosmeticResources {
    for _ in 0..40 {
        let res = adblock::cosmetics_for(url).await;
        if !res.script.is_empty() || !res.stylesheet.is_empty() {
            return res;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    adblock::cosmetics_for(url).await
}
