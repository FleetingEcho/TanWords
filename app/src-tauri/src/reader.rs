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

#[tauri::command]
pub async fn fetch_article(url: String) -> Result<FetchedArticle, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let html = resp.text().await.map_err(|e| e.to_string())?;

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
        content_html: sanitize(&article.content),
        text_content: article.text_content.to_string(),
        excerpt: article.excerpt,
    })
}
