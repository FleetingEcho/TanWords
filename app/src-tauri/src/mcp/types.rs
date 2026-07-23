use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SearchVocabulary {
    #[schemars(description = "Word or Chinese meaning to search for")]
    pub(super) query: String,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct GetVocabulary {
    #[schemars(description = "Unique vocabulary ID")]
    pub(super) id: i64,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AddVocabulary {
    pub(super) word: String,
    #[serde(default)]
    pub(super) zh: String,
    pub(super) word_type: Option<String>,
    pub(super) level: Option<String>,
    pub(super) context: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AddVocabularyBatch {
    pub(super) words: Vec<AddVocabulary>,
    pub(super) tag: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SearchDocuments {
    pub(super) query: String,
    pub(super) tag: Option<String>,
    #[serde(default = "default_limit")]
    pub(super) limit: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct GetDocument {
    #[schemars(description = "Unique document ID")]
    pub(super) id: i64,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct CreateDocument {
    pub(super) title: String,
    #[schemars(description = "Markdown content")]
    pub(super) content: String,
    #[serde(default)]
    pub(super) tags: Vec<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct UpdateDocument {
    pub(super) id: i64,
    pub(super) title: Option<String>,
    #[schemars(description = "Replacement Markdown content")]
    pub(super) content: Option<String>,
    pub(super) tags: Option<Vec<String>>,
    pub(super) expected_updated_at: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct AppendDocument {
    pub(super) id: i64,
    #[schemars(description = "Markdown to append")]
    pub(super) content: String,
}

pub(super) fn default_limit() -> usize {
    20
}
pub(super) fn json_text(value: Value) -> String {
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into())
}
