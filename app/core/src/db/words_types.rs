use serde::{Deserialize, Serialize};

// ── Query result structs ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct WordListItem {
    pub id: i64,
    pub word: String,
    pub word_type: Option<String>,
    pub level: Option<String>,
    pub word_freq: i64,
    pub zh: Option<String>,
    pub srs_level: i64,
    pub next_review_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub source: String,
    /// Whether this word already has an AI-generated enrichment_text —
    /// lets the vocabulary page find "un-analyzed" words without a
    /// per-word detail fetch.
    pub enriched: bool,
    pub starred: bool,
}

#[derive(Serialize)]
pub struct WordDetail {
    pub id: i64,
    pub word: String,
    pub word_type: Option<String>,
    pub level: Option<String>,
    pub word_freq: i64,
    pub mnemonic: Option<String>,
    pub notes: Option<String>,
    pub source: String,
    pub srs_level: i64,
    pub next_review_at: Option<String>,
    pub created_at: String,
    pub definitions: Vec<WordDefItem>,
    pub enrichment_text: Option<String>,
    /// Old structured-enrichment JSON, kept only so the UI can detect
    /// "legacy explanation, click to regenerate" for words enriched before
    /// the freeform-text rewrite. Never written to going forward.
    pub enrichment_json: Option<String>,
}

#[derive(Serialize)]
pub struct WordDefItem {
    pub pos: String,
    pub zh: String,
    pub en: Option<String>,
    pub example_en: Option<String>,
    pub example_zh: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddWordResult {
    pub id: i64,
    pub is_new: bool,
}

#[derive(Serialize)]
pub struct WordExtras {
    pub notes: String,
    pub messages: String,
}

// ── Enrichment input struct (db_add_word_enriched payload) ──────────────────

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordEnrichmentInput {
    /// The freeform AI-generated markdown explanation.
    pub text: String,
    /// Short (<=10 char) Chinese gloss from the separate structured
    /// "basic info" call (see src/lib/basicInfo.ts). Only written if the
    /// word doesn't already have one.
    pub zh_short: Option<String>,
    /// CEFR level from the "basic info" call. Only written if the word
    /// doesn't already have one (e.g. Reading already supplied it).
    pub level: Option<String>,
}

// ── Batch add payload (db_add_words_batch) ───────────────────────────────────

#[derive(Deserialize)]
pub struct NewVocabWord {
    pub word: String,
    pub zh: String,
    pub word_type: Option<String>,
    pub level: Option<String>,
    pub context: Option<String>,
}

#[derive(Serialize)]
pub struct BatchAddResult {
    pub added: i64,
    pub skipped: i64,
}
