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
    pub source: String,
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
    pub phonetics: Vec<PhoneticItem>,
    pub etymology: Option<EtymologyItem>,
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
pub struct PhoneticItem {
    pub locale: String,
    pub ipa: String,
    pub accent_label: Option<String>,
}

#[derive(Serialize)]
pub struct EtymologyItem {
    pub parts: Option<String>,
    pub story: Option<String>,
    pub origin_lang: Option<String>,
}

#[derive(Serialize)]
pub struct AddWordResult {
    pub id: i64,
    pub is_new: bool,
}

#[derive(Serialize)]
pub struct WordExtras {
    pub notes: String,
    pub messages: String,
}

#[derive(Serialize)]
pub struct WordGraphItem {
    pub id: i64,
    pub word: String,
    pub level: Option<String>,
    pub word_freq: i64,
    pub enrichment_json: Option<String>,
}

// ── Enrichment input structs (db_add_word_enriched payload) ─────────────────

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordEnrichmentInput {
    pub definitions: Vec<DefInput>,
    pub synonyms: Vec<RelInput>,
    pub antonyms: Vec<String>,
    pub collocations: Vec<String>,
    pub derivatives: Vec<DerInput>,
    pub sentence_patterns: Vec<PatInput>,
    pub idioms: Vec<IdiomInput>,
    pub authority_quotes: Vec<QuoteInput>,
    pub etymology: Option<EtyInput>,
    pub level: Option<String>,
    pub mnemonic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub complete: Option<bool>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefInput {
    pub pos: String,
    pub zh: String,
    pub en: Option<String>,
    pub example_en: Option<String>,
    pub example_zh: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelInput {
    pub word: String,
    pub note: Option<String>,
    pub note_zh: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DerInput {
    pub word: String,
    pub word_type: Option<String>,
    pub zh: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct PatInput {
    pub pattern: String,
    pub explanation: Option<String>,
    pub example: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct IdiomInput {
    pub idiom: String,
    pub explanation: Option<String>,
    pub example: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct QuoteInput {
    pub text: String,
    pub source: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtyInput {
    pub parts: Option<Vec<EtyPartInput>>,
    pub story: Option<String>,
    pub origin_lang: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct EtyPartInput {
    pub seg: String,
    pub role: String,
    pub meaning: String,
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
