import type { Dict } from "../types";

/** Per-word chat panel (WordChatPanel) — distinct from the standalone AI Chat page (see aichat.ts). */
export const chat: Dict = {
    "chat.tabChat": "AI 对话",
    "chat.tabNotes": "笔记",
    "chat.notesPlaceholder": "关于 \"{word}\" 的笔记、联想、例句…",
    "chat.notesNoId": "搜索模式下无法保存笔记，加入词库后可用",
    "chat.notesNoIdHint": "加入词库后可保存笔记",
    "chat.saveNotes": "保存笔记",
    "chat.saving": "保存中…",
    "chat.chatEmpty": "深入探讨这个词的用法、区别、例句…",
    "chat.inputPlaceholder": "回车发送，⇧回车换行",
    "chat.send": "发送",
    "chat.clear": "清空",
    "chat.noApiKey": "请先在「设置」中配置 AI API 密钥。",
    "chat.requestFailed": "请求失败，请重试",
    "chat.copy": "复制",
    "chat.close": "关闭对话",
    "chat.open": "AI 对话 / 笔记",
};
