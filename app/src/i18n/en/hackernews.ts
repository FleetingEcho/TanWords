import type { Dict } from "../types";

/** Shared by ArticleReader/ReaderView (used by both Feeds and, historically, HN).
 *  Keeping the `hn.` prefix avoids touching those call sites for a rename-only diff. */
export const hackernews: Dict = {
    "hn.learn": "Learn",
    "hn.reader.back": "Back to list",
    "hn.reader.external": "Open in browser",
    "hn.reader.openDiscussion": "Open on Hacker News",
    "hn.comments.title": "Comments",
    "hn.comments.loading": "Loading comments…",
    "hn.comments.error": "Couldn't load comments.",
    "hn.comments.empty": "No comments yet.",
    "hn.comments.anonymous": "[deleted]",
    "hn.comments.replyingTo": "Replying to @{name}",
    "hn.comments.replyCount": "{n} replies",
    "hn.comments.listen": "Listen to comments",
    "hn.tab": "Hacker News",
    "hn.section.top": "Top",
    "hn.section.new": "New",
    "hn.section.best": "Best",
    "hn.section.error": "Couldn't load Hacker News.",
    "hn.search.placeholder": "Search Hacker News…",
    "hn.search.clear": "Clear search",
    "hn.search.empty": "No results.",
};
