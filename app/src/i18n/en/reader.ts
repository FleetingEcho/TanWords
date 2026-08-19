import type { Dict } from "../types";

/** Reader mode — in-app article extraction (used by the HN drawer's "AI analysis" flow). */
export const reader: Dict = {
    "reader.loading": "Extracting article…",
    "reader.extractFailed": "Could not extract this page — it may be paywalled or block scraping",
    "reader.fontSmaller": "Smaller text",
    "reader.fontLarger": "Larger text",
    "reader.analyzeNotes": "Analyze words & sentences worth learning",
    "reader.copyMarkdown": "Copy article & comments as Markdown",
    "reader.copyFailed": "Couldn't copy to clipboard",
    "reader.urlPlaceholder": "Paste an article URL…",
    "reader.open": "Open",
    "reader.openUrl": "Open URL",
    "reader.learn": "Learn with AI chat (Reading Tutor)",
    "reader.learnActions": "Reading Tutor is generating — view or cancel",
    "reader.learnCancel": "Cancel",
    "reader.learnOpen": "Open in AI Chat",
    "reader.learnDone": "\"{title}\" is ready — open it in AI Chat",
    "reader.learnDoneTruncated": "\"{title}\" is ready from shortened content — open it in AI Chat",
    "reader.learnFailed": "Couldn't analyze \"{title}\"",
    "reader.learnStalled": "Analyzing \"{title}\" stalled — no response from the model. Try again or choose another model",
    "reader.learnEmptyResponse": "The model returned an empty response. Try again or choose another model",
    "reader.learnTruncated": "The article was shortened to fit your model's context window",
    "reader.learnContextOverflow": "The article is too long for your model's context window — try a model with a larger context size, or a shorter article",
    "reader.pastePrompt": "Paste the article text below and we'll pick it up from there.",
    "reader.pastePlaceholder": "Paste the article you copied…",
    "reader.pasteSubmit": "Use this text",
};
