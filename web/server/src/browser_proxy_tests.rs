use super::*;

fn base() -> url::Url {
    url::Url::parse("https://example.com/styles/main.css").unwrap()
}

#[test]
fn rewrites_relative_and_absolute_css_urls() {
    let css = "a{background:url(/img.png)} b{background:url(./sprite.png)} c{src:url(https://cdn.test/x.png)}";
    let out = rewrite_css(css, &base(), true);
    assert!(
        out.contains("url(/api/browser/proxy?u=https://example.com/img.png)"),
        "root-relative: {out}"
    );
    assert!(
        out.contains("url(/api/browser/proxy?u=https://example.com/styles/sprite.png)"),
        "dir-relative: {out}"
    );
    assert!(
        out.contains("url(/api/browser/proxy?u=https://cdn.test/x.png)"),
        "absolute: {out}"
    );
}

#[test]
fn preserves_quote_style() {
    let out = rewrite_css("a{b:url(\"q.png\")} c{d:url('r.png')}", &base(), true);
    assert!(
        out.contains("url(\"/api/browser/proxy?u=https://example.com/styles/q.png\")"),
        "double-quoted: {out}"
    );
    assert!(
        out.contains("url('/api/browser/proxy?u=https://example.com/styles/r.png')"),
        "single-quoted: {out}"
    );
}

#[test]
fn leaves_data_blob_and_fragment_urls_alone() {
    let css = "a{b:url(data:image/png;base64,abc)} c{d:url(#frag)} e{f:url(blob:https://x/y)}";
    let out = rewrite_css(css, &base(), true);
    assert_eq!(out, css, "data/blob/fragment URLs must be left untouched");
}

#[test]
fn rewrites_import_string_and_url_forms() {
    let out = rewrite_css("@import \"sub.css\"; @import url(deep.css);", &base(), true);
    assert!(
        out.contains("@import \"/api/browser/proxy?u=https://example.com/styles/sub.css\""),
        "import string: {out}"
    );
    assert!(
        out.contains("@import url(/api/browser/proxy?u=https://example.com/styles/deep.css)"),
        "import url: {out}"
    );
}

#[test]
fn does_not_double_wrap_already_proxied_urls() {
    let css = "a{b:url(/api/browser/proxy?u=https://x/y)}";
    let out = rewrite_css(css, &base(), true);
    assert_eq!(out, css, "already-proxied URLs must not be wrapped again");
}

#[test]
fn threads_block0_when_filtering_disabled() {
    let out = rewrite_css("a{b:url(/img.png)}", &base(), false);
    assert!(
        out.contains("?u=https://example.com/img.png&block=0"),
        "block=0 appended: {out}"
    );
}

#[test]
fn extract_target_decodes_percent_encoded_u() {
    // The frontend sends u= via encodeURIComponent, so `:`/`/` arrive as
    // %3A/%2F. A raw read would hand `https%3A%2F%2F...` to Url::parse,
    // which sees no scheme and fails — the original "missing or invalid u"
    // bug. query_pairs() form-decodes it back to a real URL.
    let u = extract_target_url(Some("u=https%3A%2F%2Fwww.youtube.com&token=abc&block=1"));
    assert_eq!(
        u.expect("decoded u must parse").host_str(),
        Some("www.youtube.com")
    );
}

#[test]
fn extract_target_preserves_url_query_and_amp() {
    // A target URL containing `&`/`=` (e.g. a watch?v=... link) survives
    // encodeURIComponent on the way in and comes back out intact.
    let encoded = "u=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daqz-KE-bpKQ%26t%3D10s";
    let u = extract_target_url(Some(encoded)).expect("must parse");
    assert_eq!(u.host_str(), Some("www.youtube.com"));
    assert_eq!(u.path(), "/watch");
    assert_eq!(u.query(), Some("v=aqz-KE-bpKQ&t=10s"));
}

#[test]
fn extract_target_returns_none_when_u_absent() {
    assert!(extract_target_url(Some("token=abc&block=0")).is_none());
    assert!(extract_target_url(None).is_none());
    // Garbage that isn't a URL: `u=` is present but unparseable.
    assert!(extract_target_url(Some("u=not-a-url")).is_none());
}
