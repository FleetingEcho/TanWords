use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SearchVocabulary {
    #[schemars(description = "Word or Chinese meaning to search for")]
    pub(super) query: String,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct ListKnownWords {
    #[schemars(description = "Optional prefix or full word to filter by")]
    pub(super) query: Option<String>,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct GetVocabulary {
    #[schemars(description = "Unique vocabulary ID")]
    pub(super) id: i64,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AddVocabulary {
    pub(super) word: String,
    #[serde(default)]
    pub(super) zh: String,
    pub(super) word_type: Option<String>,
    pub(super) level: Option<String>,
    pub(super) context: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AddVocabularyBatch {
    pub(super) words: Vec<AddVocabulary>,
    pub(super) tag: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SearchDocuments {
    pub(super) query: String,
    pub(super) tag: Option<String>,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct ListDocuments {
    #[schemars(description = "Optional full-text query; omit to list recent documents")]
    pub(super) query: Option<String>,
    pub(super) tag: Option<String>,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
    #[serde(default)]
    pub(super) offset: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct GetDocument {
    #[schemars(description = "Unique document ID")]
    pub(super) id: i64,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct CreateDocument {
    pub(super) title: String,
    #[schemars(description = "Markdown content")]
    pub(super) content: String,
    #[serde(default)]
    pub(super) tags: Vec<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct UpdateDocument {
    pub(super) id: i64,
    pub(super) title: Option<String>,
    #[schemars(description = "Replacement Markdown content")]
    pub(super) content: Option<String>,
    pub(super) tags: Option<Vec<String>>,
    pub(super) expected_updated_at: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AppendDocument {
    pub(super) id: i64,
    #[schemars(description = "Markdown to append")]
    pub(super) content: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct UpdateVocabulary {
    #[schemars(description = "Unique vocabulary ID")]
    pub(super) id: i64,
    #[schemars(description = "Replacement Chinese meaning")]
    pub(super) zh: Option<String>,
    pub(super) word_type: Option<String>,
    pub(super) level: Option<String>,
    pub(super) notes: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SearchPatterns {
    #[schemars(description = "Pattern skeleton, meaning, or example sentence to search for")]
    pub(super) query: String,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct ListPatterns {
    #[schemars(description = "Optional pattern skeleton, meaning, or example to filter by")]
    pub(super) query: Option<String>,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
    #[serde(default)]
    pub(super) offset: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AddPattern {
    #[schemars(description = "Reusable skeleton, e.g. 'be shortlisted for + noun'")]
    pub(super) pattern: String,
    #[serde(default)]
    #[schemars(description = "Chinese gloss of what the pattern expresses")]
    pub(super) zh: String,
    #[serde(default)]
    #[schemars(description = "Short note on the scenario or register it fits")]
    pub(super) note: String,
    #[schemars(description = "CEFR level: A1|A2|B1|B2|C1|C2")]
    pub(super) level: Option<String>,
    #[schemars(description = "Example sentence the pattern was taken from")]
    pub(super) example: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AddArticle {
    #[schemars(description = "Article title")]
    pub(super) title: String,
    #[schemars(description = "Full article text, plain text")]
    pub(super) content: String,
    #[schemars(description = "Where the article came from, if it has a URL")]
    pub(super) source_url: Option<String>,
    #[serde(default)]
    #[schemars(description = "Topic tags, e.g. [\"postgres\", \"career\"]")]
    pub(super) tags: Vec<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct ListArticles {
    #[schemars(description = "Full-text search over title and body; omit to list the most recent")]
    pub(super) query: Option<String>,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct GetArticle {
    #[schemars(description = "Unique article ID")]
    pub(super) id: i64,
    #[serde(default)]
    #[schemars(description = "Include the comments left on this article")]
    pub(super) with_comments: bool,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AddArticleComment {
    #[schemars(description = "Unique article ID")]
    pub(super) article_id: i64,
    #[schemars(description = "The note itself, in Markdown")]
    pub(super) body: String,
    #[schemars(
        description = "The exact sentence from the article this note is about, copied verbatim. Omit for a note about the whole article."
    )]
    pub(super) anchor_text: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct ListFeeds {}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct ListFeedEntries {
    pub(super) feed_id: Option<i64>,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
    #[serde(default)]
    pub(super) offset: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct HackerNewsList {
    #[schemars(description = "Hacker News section: new, top, or best")]
    pub(super) section: String,
    #[serde(default)]
    pub(super) offset: i64,
    #[serde(default = "default_limit_i64")]
    pub(super) limit: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct HackerNewsSearch {
    pub(super) query: String,
    #[serde(default)]
    pub(super) page: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct HackerNewsComments {
    #[schemars(description = "Hacker News story/item ID")]
    pub(super) story_id: i64,
}

/// Turns a user query into an FTS5 MATCH expression: every word becomes a
/// prefix term, ANDed together. Quoting each term keeps FTS operators and
/// punctuation in the query from being parsed as syntax (an unbalanced quote
/// or a bare `-` otherwise makes the whole query error out).
pub(super) fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|term| term.replace('"', ""))
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

pub(super) fn default_limit() -> usize {
    20
}
pub(super) fn default_limit_i64() -> i64 {
    20
}
pub(super) fn json_text(value: Value) -> String {
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into())
}
