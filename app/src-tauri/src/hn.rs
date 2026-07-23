use std::collections::HashSet;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

const HN_API_BASE: &str = "https://hacker-news.firebaseio.com/v0";
const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/// Hard caps so a mega-thread (front-page Show HNs routinely clear 1000+
/// comments) can't turn one command into a thousand sequential HTTP round
/// trips or stall the UI — good enough to read the discussion without
/// waiting on every last nested reply.
const MAX_COMMENTS: usize = 300;
const MAX_DEPTH: u32 = 6;
const MAX_CONCURRENCY: usize = 12;

#[derive(Serialize, Clone)]
pub struct HnComment {
    pub id: i64,
    pub by: Option<String>,
    /// Sanitized HTML (HN comment bodies use a handful of tags: `<p>`, `<i>`, `<a>`, `<pre><code>`).
    pub text: String,
    pub time: Option<i64>,
    pub children: Vec<HnComment>,
}

#[derive(Deserialize)]
struct HnItemRaw {
    id: i64,
    by: Option<String>,
    text: Option<String>,
    time: Option<i64>,
    kids: Option<Vec<i64>>,
    deleted: Option<bool>,
    dead: Option<bool>,
    // Story-only fields (absent/None on comment items).
    title: Option<String>,
    url: Option<String>,
    score: Option<i64>,
    descendants: Option<i64>,
}

/// One entry in a ranked HN section list (New / Top / Best).
#[derive(Serialize, Clone)]
pub struct HnStorySummary {
    pub id: i64,
    pub title: String,
    /// The story's external link; for text-only posts (Ask HN etc. surfaced
    /// on these ranked lists) falls back to the HN discussion page itself.
    pub url: String,
    pub by: Option<String>,
    pub score: Option<i64>,
    pub time: Option<i64>,
    pub descendants: Option<i64>,
}

#[derive(Serialize)]
pub struct HnSectionPage {
    pub stories: Vec<HnStorySummary>,
    pub total: i64,
}

const HN_SECTIONS: &[(&str, &str)] = &[("new", "newstories"), ("top", "topstories"), ("best", "beststories")];

const ALGOLIA_SEARCH_URL: &str = "https://hn.algolia.com/api/v1/search";

#[derive(Serialize)]
pub struct HnSearchPage {
    pub stories: Vec<HnStorySummary>,
    pub page: i64,
    pub total_pages: i64,
}

#[derive(Deserialize)]
struct AlgoliaHit {
    #[serde(rename = "objectID")]
    object_id: String,
    title: Option<String>,
    url: Option<String>,
    author: Option<String>,
    points: Option<i64>,
    created_at_i: Option<i64>,
    num_comments: Option<i64>,
}

#[derive(Deserialize)]
struct AlgoliaResponse {
    hits: Vec<AlgoliaHit>,
    page: i64,
    #[serde(rename = "nbPages")]
    nb_pages: i64,
}

fn sanitize_comment(html: &str) -> String {
    let allowed_tags: HashSet<&str> = ["p", "i", "em", "b", "strong", "a", "pre", "code", "blockquote", "br"]
        .into_iter()
        .collect();
    ammonia::Builder::default()
        .tags(allowed_tags)
        .link_rel(Some("noopener noreferrer nofollow"))
        .clean(html)
        .to_string()
}

/// Deleted/flagged items come back as a bare JSON `null` rather than an
/// object, so the item itself (not just its fields) is optional.
async fn fetch_item(client: &reqwest::Client, id: i64) -> Result<Option<HnItemRaw>, String> {
    let url = format!("{HN_API_BASE}/item/{id}.json");
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<Option<HnItemRaw>>(&body).map_err(|e| e.to_string())
}

async fn fetch_id_list(client: &reqwest::Client, endpoint: &str) -> Result<Vec<i64>, String> {
    let url = format!("{HN_API_BASE}/{endpoint}.json");
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<Vec<i64>>(&body).map_err(|e| e.to_string())
}

async fn fetch_story(client: &reqwest::Client, sem: &Semaphore, id: i64) -> Option<HnStorySummary> {
    let permit = sem.acquire().await.ok()?;
    let item = fetch_item(client, id).await.ok().flatten()?;
    drop(permit);

    if item.deleted.unwrap_or(false) || item.dead.unwrap_or(false) {
        return None;
    }
    Some(HnStorySummary {
        id: item.id,
        title: item.title.unwrap_or_default(),
        url: item
            .url
            .unwrap_or_else(|| format!("https://news.ycombinator.com/item?id={}", item.id)),
        by: item.by,
        score: item.score,
        time: item.time,
        descendants: item.descendants,
    })
}

/// Fetch one page of a ranked Hacker News section — "new", "top", or "best",
/// mapping to HN's own /newest, /news, and /best. The id list is re-fetched
/// fresh on every call rather than cached/frozen across pages, so a live
/// ranking shift mid-scroll can shift or repeat an item — the same drift
/// HN's own /news?p=N pagination has, and not worth solving for a live,
/// unpersisted view.
#[tauri::command]
pub async fn fetch_hn_section(section: String, offset: i64, limit: i64) -> Result<HnSectionPage, String> {
    let endpoint = HN_SECTIONS
        .iter()
        .find(|(name, _)| *name == section)
        .map(|(_, endpoint)| *endpoint)
        .ok_or_else(|| format!("Unknown HN section: {section}"))?;

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let ids = fetch_id_list(&client, endpoint).await?;
    let total = ids.len() as i64;
    let start = offset.clamp(0, total) as usize;
    let end = (offset.max(0) + limit.max(0)).clamp(0, total) as usize;

    let sem = Semaphore::new(MAX_CONCURRENCY);
    let futs: Vec<_> = ids[start..end]
        .iter()
        .map(|id| fetch_story(&client, &sem, *id))
        .collect();
    let stories = join_all(futs).await.into_iter().flatten().collect();

    Ok(HnSectionPage { stories, total })
}

/// Search Hacker News stories via Algolia's free HN Search API — the same
/// backend news.ycombinator.com/item's own "Search" box uses. Firebase (used
/// by `fetch_hn_section`) has no search of its own. Results are relevance-
/// ranked, restricted to stories (`tags=story`), and paginated by Algolia's
/// own page/nbPages rather than an offset.
#[tauri::command]
pub async fn search_hn(query: String, page: i64) -> Result<HnSearchPage, String> {
    if query.trim().is_empty() {
        return Ok(HnSearchPage { stories: Vec::new(), page: 0, total_pages: 0 });
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(ALGOLIA_SEARCH_URL)
        .query(&[
            ("query", query.as_str()),
            ("tags", "story"),
            ("page", &page.max(0).to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: AlgoliaResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let stories = parsed
        .hits
        .into_iter()
        .filter_map(|hit| {
            let id: i64 = hit.object_id.parse().ok()?;
            Some(HnStorySummary {
                title: hit.title.unwrap_or_default(),
                url: hit
                    .url
                    .unwrap_or_else(|| format!("https://news.ycombinator.com/item?id={id}")),
                by: hit.author,
                score: hit.points,
                time: hit.created_at_i,
                descendants: hit.num_comments,
                id,
            })
        })
        .collect();

    Ok(HnSearchPage { stories, page: parsed.page, total_pages: parsed.nb_pages })
}

fn fetch_comment_tree<'a>(
    client: &'a reqwest::Client,
    sem: &'a Semaphore,
    id: i64,
    depth: u32,
    budget: &'a AtomicUsize,
) -> Pin<Box<dyn std::future::Future<Output = Option<HnComment>> + Send + 'a>> {
    Box::pin(async move {
        if budget.load(Ordering::Relaxed) == 0 {
            return None;
        }

        let permit = sem.acquire().await.ok()?;
        let item = fetch_item(client, id).await.ok().flatten()?;
        drop(permit);

        if item.deleted.unwrap_or(false) || item.dead.unwrap_or(false) {
            return None;
        }
        let text = item.text?; // no body (e.g. a poll option) — nothing to show
        if budget
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |b| b.checked_sub(1))
            .is_err()
        {
            return None;
        }

        let children = if depth < MAX_DEPTH {
            match item.kids {
                Some(kids) => {
                    let futs: Vec<_> = kids
                        .iter()
                        .map(|kid| fetch_comment_tree(client, sem, *kid, depth + 1, budget))
                        .collect();
                    join_all(futs).await.into_iter().flatten().collect()
                }
                None => Vec::new(),
            }
        } else {
            Vec::new()
        };

        Some(HnComment {
            id: item.id,
            by: item.by,
            text: sanitize_comment(&text),
            time: item.time,
            children,
        })
    })
}

/// Fetch a Hacker News discussion's comments (recursively, via HN's free
/// Firebase item API) given the story's item id — captured from an RSS
/// entry's `hn_item_id` (see `rss.rs::extract_hn_item_id`) or read straight
/// off a `news.ycombinator.com/item?id=` URL. Capped at MAX_COMMENTS /
/// MAX_DEPTH so a mega-thread can't stall the UI.
#[tauri::command]
pub async fn fetch_hn_comments(story_id: i64) -> Result<Vec<HnComment>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let story = fetch_item(&client, story_id)
        .await?
        .ok_or_else(|| "Story not found".to_string())?;
    let kids = story.kids.unwrap_or_default();
    let budget = AtomicUsize::new(MAX_COMMENTS);
    let sem = Semaphore::new(MAX_CONCURRENCY);

    let futs: Vec<_> = kids
        .iter()
        .map(|kid| fetch_comment_tree(&client, &sem, *kid, 0, &budget))
        .collect();
    Ok(join_all(futs).await.into_iter().flatten().collect())
}
