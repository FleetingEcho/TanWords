import type { Dict } from "../types";

/** Shared by ArticleReader/ReaderView (used by both Feeds and, historically, HN).
 *  Keeping the `hn.` prefix avoids touching those call sites for a rename-only diff. */
export const hackernews: Dict = {
    "hn.learn": "Learn",
    "hn.reader.back": "Back to list",
    "hn.reader.external": "Open in browser",
};
