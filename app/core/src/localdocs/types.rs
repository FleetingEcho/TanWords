use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct LocalDocItem {
    pub rel_path: String,
    pub name: String,
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Serialize)]
pub struct LocalDocSearchHit {
    pub line_number: u64,
    pub line_text: String,
}

#[derive(Serialize)]
pub struct LocalDocSearchResult {
    pub rel_path: String,
    pub name: String,
    pub hits: Vec<LocalDocSearchHit>,
}

#[derive(Serialize)]
pub struct MarkdownSource {
    pub path: String,
    pub name: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct MarkdownExport {
    pub name: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAssetExport {
    pub name: String,
    pub data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownBundleExport {
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub assets: Vec<MarkdownAssetExport>,
}
