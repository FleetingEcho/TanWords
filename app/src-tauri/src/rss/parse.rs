//! Feed fetching and parsing: turning a raw RSS/Atom document into our
//! `RssFeedMeta`/`RssEntry` shapes.

use std::time::Duration;

use super::types::{RssEntry, RssFeedMeta};

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/// Resolve a possibly-relative image URL against the entry/feed's page URL.
fn resolve_url(raw: &str, base: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    if let Ok(u) = url::Url::parse(raw) {
        return Some(u.to_string());
    }
    if let Ok(base_url) = url::Url::parse(base) {
        if let Ok(joined) = base_url.join(raw) {
            return Some(joined.to_string());
        }
    }
    None
}

/// Find the first `<img src="...">` in an HTML fragment (used as a last-resort cover).
fn first_img_src(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(rel) = lower[search_from..].find("<img") {
        let tag_start = search_from + rel;
        let tag_end = lower[tag_start..].find('>').map(|e| tag_start + e)?;
        let tag = &html[tag_start..tag_end];
        if let Some(src_pos) = tag.to_ascii_lowercase().find("src=") {
            let after = &tag[src_pos + 4..];
            let quote = after.chars().next()?;
            if quote == '"' || quote == '\'' {
                if let Some(end) = after[1..].find(quote) {
                    return Some(after[1..1 + end].to_string());
                }
            }
        }
        search_from = tag_end + 1;
    }
    None
}

/// True if the URL's path extension is a known non-image media type (podcast enclosures etc).
/// Extensionless URLs (common for CMS-generated image links) are treated as images.
fn looks_like_non_image(url_str: &str) -> bool {
    const NON_IMAGE_EXT: &[&str] = &[
        "mp3", "mp4", "m4a", "wav", "mov", "pdf", "zip", "ogg", "webm",
    ];
    url_str
        .rsplit('.')
        .next()
        .map(|ext| {
            let ext = ext
                .split(&['?', '#'][..])
                .next()
                .unwrap_or(ext)
                .to_ascii_lowercase();
            NON_IMAGE_EXT.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

/// Pick a cover image for an entry: media:content / enclosure / itunes:image / media:thumbnail
/// (all normalized into `entry.media` by feed-rs), falling back to the first `<img>` in the
/// entry's HTML body or summary. Relative URLs are resolved against `page_url`.
fn extract_image(entry: &feed_rs::model::Entry, page_url: &str) -> Option<String> {
    for media in &entry.media {
        for content in &media.content {
            if let Some(u) = &content.url {
                if !looks_like_non_image(u.as_str()) {
                    return resolve_url(u.as_str(), page_url);
                }
            }
        }
        for thumb in &media.thumbnails {
            if !thumb.image.uri.is_empty() {
                return resolve_url(&thumb.image.uri, page_url);
            }
        }
    }
    if let Some(body) = entry.content.as_ref().and_then(|c| c.body.as_ref()) {
        if let Some(src) = first_img_src(body) {
            return resolve_url(&src, page_url);
        }
    }
    if let Some(summary) = &entry.summary {
        if let Some(src) = first_img_src(&summary.content) {
            return resolve_url(&src, page_url);
        }
    }
    None
}

/// Pick the podcast audio enclosure for an entry, if any: the first `media:content`
/// (RSS `<enclosure>` is normalized into `entry.media` by feed-rs same as media:content)
/// whose MIME type starts with `audio/`, or failing that whose URL extension looks like
/// an audio file. Returns `(url, duration_seconds)`.
fn extract_audio(entry: &feed_rs::model::Entry, page_url: &str) -> (Option<String>, Option<i64>) {
    const AUDIO_EXT: &[&str] = &["mp3", "m4a", "wav", "ogg", "aac", "flac"];
    for media in &entry.media {
        for content in &media.content {
            let Some(u) = &content.url else { continue };
            let is_audio_type = content
                .content_type
                .as_ref()
                .is_some_and(|ct| ct.to_string().starts_with("audio/"));
            let is_audio_ext = u
                .path()
                .rsplit('.')
                .next()
                .map(|ext| AUDIO_EXT.contains(&ext.to_ascii_lowercase().as_str()))
                .unwrap_or(false);
            if is_audio_type || is_audio_ext {
                let url = resolve_url(u.as_str(), page_url);
                let duration = content
                    .duration
                    .or(media.duration)
                    .map(|d| d.as_secs() as i64);
                return (url, duration);
            }
        }
    }
    (None, None)
}

/// hnrss.org (and compatible HN-to-RSS bridges) sets the RSS `<guid>` to the
/// story's `news.ycombinator.com/item?id=<n>` discussion URL rather than a
/// synthetic id. feed-rs surfaces that guid as `Entry.id`; pull the numeric
/// item id back out of it so comments can be fetched later.
fn extract_hn_item_id(id: &str) -> Option<i64> {
    let rest = id
        .strip_prefix("https://news.ycombinator.com/item?id=")
        .or_else(|| id.strip_prefix("http://news.ycombinator.com/item?id="))?;
    rest.split(['&', '#']).next().unwrap_or(rest).parse().ok()
}

/// Strip HTML tags from a string, leaving plain text.
fn strip_html(input: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in input.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(c);
        }
    }
    result.trim().to_string()
}

/// Fetch and parse an RSS/Atom feed from a URL. Shared by the `fetch_rss` preview
/// command and `db_sync_rss_feed`.
pub(super) async fn fetch_feed_meta(url: &str) -> Result<RssFeedMeta, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    let feed = feed_rs::parser::parse(&body[..]).map_err(|e| format!("Feed parse error: {e}"))?;

    let site_link = feed
        .links
        .first()
        .map(|l| l.href.clone())
        .unwrap_or_default();

    let entries: Vec<RssEntry> = feed
        .entries
        .iter()
        .take(50)
        .map(|e| {
            let links = &e.links;
            let href = links.first().map(|l| l.href.clone()).unwrap_or_default();
            let page_url = if href.is_empty() { &site_link } else { &href };
            let (audio_url, audio_duration) = extract_audio(e, page_url);
            RssEntry {
                title: e
                    .title
                    .as_ref()
                    .map(|t| t.content.clone())
                    .unwrap_or_default(),
                url: href.clone(),
                author: e
                    .authors
                    .first()
                    .map(|a| a.name.clone())
                    .unwrap_or_default(),
                summary: e
                    .summary
                    .as_ref()
                    .map(|s| strip_html(&s.content))
                    .unwrap_or_default(),
                published: e
                    .published
                    .or(e.updated)
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_default(),
                image_url: extract_image(e, page_url),
                audio_url,
                audio_duration,
                hn_item_id: extract_hn_item_id(&e.id),
            }
        })
        .collect();

    Ok(RssFeedMeta {
        title: feed.title.map(|t| t.content).unwrap_or_default(),
        description: feed.description.map(|d| d.content).unwrap_or_default(),
        site_link,
        entries,
    })
}

/// Fetch and parse an RSS/Atom feed from a URL (used for the add-feed preview).
#[tauri::command]
pub async fn fetch_rss(url: String) -> Result<RssFeedMeta, String> {
    fetch_feed_meta(&url).await
}
