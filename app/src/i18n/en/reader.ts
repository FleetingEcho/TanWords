import type { Dict } from "../types";

/** Reader mode — in-app article extraction (used by the HN drawer's "AI analysis" flow). */
export const reader: Dict = {
    "reader.loading": "Extracting article…",
    "reader.extractFailed": "Could not extract this page — it may be paywalled or block scraping",
    "reader.fontSmaller": "Smaller text",
    "reader.fontLarger": "Larger text",
    "reader.urlPlaceholder": "Paste an article URL…",
    "reader.open": "Open",
    "reader.openUrl": "Open URL",
};
