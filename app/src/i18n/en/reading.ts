import type { Dict } from "../types";

/** Shared with the RSS reader's inline AI-notes/translation panes
 *  (ArticleReader, WordSearchBox, TranslationPane) — not tied to any
 *  dedicated "Reading" page (there isn't one). */
export const reading: Dict = {
    "reading.article": "Article",
    "reading.notesTitle": "AI notes",
    "reading.notesEmpty": "No AI notes for this article.",
    "reading.translate.button": "Translate to Chinese",
    "reading.translate.loading": "Translating…",
    "reading.translate.error": "Translation failed.",
    "reading.translate.noProvider": "No AI provider configured — set one up in Settings.",
    "reading.translate.article": "Article",
    "reading.translate.comments": "Comments",
    "reading.translate.close": "Close",
    "reading.translate.retry": "Try again",
    "reading.search.placeholder": "Search or add a word…",
    "reading.search.inVocab": "In vocabulary",
    "reading.search.add": "Add \"{word}\" to vocabulary",
    "reading.search.adding": "Adding…",
    "reading.search.added": "Added \"{word}\"",
    "reading.search.markKnown": "Mark \"{word}\" as known",
    "reading.search.marking": "Marking…",
    "reading.search.markedKnown": "Marked \"{word}\" as known",
};
