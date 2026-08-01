use rmcp::{handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::json;

use super::TanWordsMcp;
use crate::mcp::types::{json_text, HackerNewsComments, HackerNewsList, HackerNewsSearch};

#[tool_router(router = hackernews_tool_router, vis = "pub(crate)")]
impl TanWordsMcp {
    #[tool(description = "List Hacker News stories from a live section: new, top, or best")]
    pub(in crate::mcp) async fn hackernews_list(&self, Parameters(input): Parameters<HackerNewsList>) -> String {
        match crate::hn::fetch_hn_section(input.section.clone(), input.offset, input.limit).await {
            Ok(page) => json_text(json!(page)),
            Err(error) => json_text(json!({"error": error})),
        }
    }

    #[tool(description = "Search Hacker News stories by keyword using HN's Algolia search backend")]
    pub(in crate::mcp) async fn hackernews_search(&self, Parameters(input): Parameters<HackerNewsSearch>) -> String {
        match crate::hn::search_hn(input.query.clone(), input.page).await {
            Ok(page) => json_text(json!(page)),
            Err(error) => json_text(json!({"error": error})),
        }
    }

    #[tool(description = "Fetch a Hacker News story's threaded comments (capped by the app's safety limits)")]
    pub(in crate::mcp) async fn hackernews_comments(&self, Parameters(input): Parameters<HackerNewsComments>) -> String {
        match crate::hn::fetch_hn_comments(input.story_id).await {
            Ok(comments) => json_text(json!({"items": comments})),
            Err(error) => json_text(json!({"error": error})),
        }
    }
}
