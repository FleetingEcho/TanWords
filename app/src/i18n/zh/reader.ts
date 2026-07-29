import type { Dict } from "../types";

/** Reader mode — in-app article extraction (used by the HN drawer's "AI 分析" flow). */
export const reader: Dict = {
    "reader.loading": "正在提取正文…",
    "reader.extractFailed": "无法提取正文，可能是付费墙或反爬限制",
    "reader.fontSmaller": "缩小字号",
    "reader.fontLarger": "放大字号",
    "reader.analyzeNotes": "分析生词好句",
    "reader.copyMarkdown": "以 Markdown 复制正文和评论",
    "reader.copyFailed": "复制到剪贴板失败",
    "reader.urlPlaceholder": "粘贴文章网址…",
    "reader.open": "打开",
    "reader.openUrl": "打开网址",
    "reader.learn": "用 AI 对话学习（阅读导师）",
    "reader.learnActions": "阅读导师正在生成，可查看或取消",
    "reader.learnCancel": "取消",
    "reader.learnOpen": "在 AI 对话中打开",
    "reader.learnDone": "「{title}」已生成，可以在 AI 对话中查看",
    "reader.learnDoneTruncated": "「{title}」已根据精简内容生成，可以在 AI 对话中查看",
    "reader.learnFailed": "「{title}」分析失败",
    "reader.learnEmptyResponse": "模型返回了空内容，请重试或换用其他模型",
    "reader.learnTruncated": "文章内容过长，已自动精简以适配当前模型的上下文窗口",
    "reader.learnContextOverflow": "文章超出当前模型的上下文窗口，请更换支持更大上下文的模型，或选择更短的文章",
    "reader.pastePrompt": "把复制的文章内容粘贴到下面，我们会继续帮你处理。",
    "reader.pastePlaceholder": "粘贴你复制的文章…",
    "reader.pasteSubmit": "使用这段文字",
};
