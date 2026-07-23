import type { Dict } from "../types";

/** Shared by ArticleReader/ReaderView (used by both Feeds and, historically, HN).
 *  Keeping the `hn.` prefix avoids touching those call sites for a rename-only diff. */
export const hackernews: Dict = {
    "hn.learn": "学习",
    "hn.reader.back": "返回列表",
    "hn.reader.external": "浏览器打开",
    "hn.reader.openDiscussion": "在 Hacker News 查看",
    "hn.comments.title": "评论",
    "hn.comments.loading": "评论加载中…",
    "hn.comments.error": "评论加载失败。",
    "hn.comments.empty": "暂无评论。",
    "hn.comments.anonymous": "[已删除]",
    "hn.comments.replyingTo": "回复 @{name}",
    "hn.comments.replyCount": "{n} 条回复",
    "hn.tab": "Hacker News",
    "hn.section.top": "热门",
    "hn.section.new": "最新",
    "hn.section.best": "精选",
    "hn.section.error": "加载 Hacker News 失败。",
    "hn.search.placeholder": "搜索 Hacker News…",
    "hn.search.clear": "清除搜索",
    "hn.search.empty": "没有找到结果。",
};
