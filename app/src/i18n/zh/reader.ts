import type { Dict } from "../types";

/** Reader mode — in-app article extraction (used by the HN drawer's "AI 分析" flow). */
export const reader: Dict = {
    "reader.loading": "正在提取正文…",
    "reader.extractFailed": "无法提取正文，可能是付费墙或反爬限制",
    "reader.fontSmaller": "缩小字号",
    "reader.fontLarger": "放大字号",
    "reader.urlPlaceholder": "粘贴文章网址…",
    "reader.open": "打开",
    "reader.openUrl": "打开网址",
};
