use std::collections::HashSet;
use std::time::Duration;

use dom_smoothie::{Article, Config, Readability};
use serde::Serialize;

#[derive(Serialize)]
pub struct FetchedArticle {
    pub title: String,
    pub byline: Option<String>,
    pub site_name: Option<String>,
    pub content_html: String,
    pub text_content: String,
    pub excerpt: Option<String>,
}

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

fn sanitize(html: &str) -> String {
    let allowed_tags: HashSet<&str> = [
        "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code",
        "img", "a", "strong", "em", "b", "i", "table", "thead", "tbody", "tr", "th", "td", "br",
        "figure", "figcaption",
    ]
    .into_iter()
    .collect();

    ammonia::Builder::default()
        .tags(allowed_tags)
        .link_rel(Some("noopener noreferrer nofollow"))
        .clean(html)
        .to_string()
}

/// Strip footnote back-reference arrows (↩ / ↩︎ with variation selectors) that
/// Readability carries over from footnote sections — they're link glyphs from
/// the original page's navigation, not prose.
fn strip_footnote_backrefs(text: &str) -> String {
    text.replace('\u{21A9}', "")
        .replace('\u{FE0E}', "")
        .replace('\u{FE0F}', "")
}

#[crate::shim::command]
pub async fn fetch_article(url: String) -> Result<FetchedArticle, String> {
    // Guarded, not a plain client: `url` is whatever the caller asked for, and
    // in the server build that caller is a logged-in stranger rather than the
    // person sitting at the machine. See http_util::fetch_guarded.
    let resp = crate::http_util::fetch_guarded(
        &url,
        USER_AGENT,
        Duration::from_secs(15),
        |request| {
            request
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .header("Accept-Language", "en-US,en;q=0.9")
        },
    )
    .await?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    // Same cap as the RSS path — the parsed DOM cost scales with input size.
    // (Trade-off accepted: charset from Content-Type is no longer honored for
    // non-UTF-8 legacy pages; they used to decode via resp.text().)
    let html = String::from_utf8_lossy(
        &crate::http_util::read_body_capped(resp, 25 * 1024 * 1024).await?,
    )
    .into_owned();

    let cfg = Config {
        max_elements_to_parse: 20_000,
        ..Default::default()
    };
    let mut readability = Readability::new(html, Some(url.as_str()), Some(cfg))
        .map_err(|e| format!("Could not parse page: {e}"))?;
    let article: Article = readability
        .parse()
        .map_err(|e| format!("Could not extract article: {e}"))?;

    if article.text_content.trim().is_empty() {
        return Err("No readable content found on this page".to_string());
    }

    Ok(FetchedArticle {
        title: article.title,
        byline: article.byline,
        site_name: article.site_name,
        content_html: strip_footnote_backrefs(&sanitize(&article.content)),
        text_content: strip_footnote_backrefs(&article.text_content),
        excerpt: article.excerpt,
    })
}
