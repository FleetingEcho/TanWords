import type { Dict } from "../types";

/** Shared with the RSS reader's inline AI-notes/translation panes
 *  (ArticleReader, WordSearchBox, TranslationPane) — not tied to any
 *  dedicated "Reading" page (there isn't one). */
export const reading: Dict = {
    "reading.article": "文章",
    "reading.notesTitle": "AI 笔记",
    "reading.notesEmpty": "这篇文章还没有 AI 笔记。",
    "reading.translate.button": "翻译为中文",
    "reading.translate.loading": "翻译中…",
    "reading.translate.error": "翻译失败。",
    "reading.translate.noProvider": "未配置 AI 提供商，请在设置中配置。",
    "reading.translate.article": "文章",
    "reading.translate.comments": "评论",
    "reading.translate.close": "关闭",
    "reading.translate.retry": "重新翻译",
    "reading.search.placeholder": "查询或添加单词…",
    "reading.search.inVocab": "已在词库",
    "reading.search.add": "添加「{word}」到词库",
    "reading.search.adding": "添加中…",
    "reading.search.added": "已添加「{word}」",
    "reading.search.markKnown": "标记「{word}」为已认识",
    "reading.search.marking": "标记中…",
    "reading.search.markedKnown": "已标记「{word}」为已认识",
};
