import type { Dict } from "../types";

/** Shared by ArticleReader/ReaderView (used by both Feeds and, historically, HN).
 *  Keeping the `hn.` prefix avoids touching those call sites for a rename-only diff. */
export const hackernews: Dict = {
    "hn.learn": "学习",
    "hn.reader.back": "返回列表",
    "hn.reader.external": "浏览器打开",
};
