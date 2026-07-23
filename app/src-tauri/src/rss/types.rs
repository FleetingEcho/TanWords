use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct RssEntry {
    pub title: String,
    pub url: String,
    pub author: String,
    pub summary: String,
    pub published: String,
    pub image_url: Option<String>,
    /// Podcast enclosure (direct mp3/m4a URL); None for regular article entries.
    pub audio_url: Option<String>,
    /// Episode length in seconds, when the feed provides it.
    pub audio_duration: Option<i64>,
    /// Hacker News item id, when this entry came from an hnrss.org-style feed
    /// (which reuses the RSS guid as the `news.ycombinator.com/item?id=` discussion
    /// link) — lets the reader fetch and show that story's comments.
    pub hn_item_id: Option<i64>,
}

/// A cached article row from `rss_entries` (plan2.md §A).
#[derive(Serialize)]
pub struct RssEntryRow {
    pub id: i64,
    pub feed_id: i64,
    pub title: String,
    pub url: String,
    pub author: String,
    pub summary: String,
    pub image_url: Option<String>,
    pub audio_url: Option<String>,
    pub audio_duration: Option<i64>,
    pub hn_item_id: Option<i64>,
    pub published: String,
    pub is_read: bool,
    pub fetched_at: String,
}

#[derive(Serialize)]
pub struct RssFeedMeta {
    pub title: String,
    pub description: String,
    pub site_link: String,
    pub entries: Vec<RssEntry>,
}

#[derive(Serialize)]
pub struct RssFeed {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub site_link: String,
    pub description: String,
    pub last_fetched_at: Option<String>,
    pub created_at: String,
    /// True when any cached entry of this feed carries an audio enclosure —
    /// the UI groups such feeds under "Podcasts" instead of "Articles".
    pub is_podcast: bool,
    pub category: String,
    pub category_override: Option<String>,
    pub is_pinned: bool,
    pub pin_order: Option<i64>,
}
