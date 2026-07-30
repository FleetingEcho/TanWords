use serde::Serialize;

#[derive(Serialize)]
pub struct DocumentListItem {
    pub id: i64,
    pub title: String,
    pub tags: String,
    pub pinned: bool,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub content_text: String,
    pub protected: bool,
    pub unlocked: bool,
}

#[derive(Serialize)]
pub struct DocumentDetail {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub content_text: String,
    pub tags: String,
    pub pinned: bool,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub protected: bool,
}

#[derive(Serialize)]
pub struct DocumentListResult {
    pub items: Vec<DocumentListItem>,
    pub total: i64,
}

#[derive(Serialize)]
pub struct DocumentAsset {
    pub id: String,
    pub document_id: i64,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub data_base64: String,
}

#[derive(Serialize)]
pub struct DocumentAssetSummary {
    pub id: String,
    pub document_id: i64,
    pub document_title: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub created_at: String,
    pub referenced: bool,
    pub protected: bool,
    pub unlocked: bool,
}

#[derive(Serialize)]
pub struct DocumentLinkItem {
    pub id: i64,
    pub title: String,
}

#[derive(Serialize)]
pub struct DocumentLinkContext {
    pub outgoing: Vec<DocumentLinkItem>,
    pub backlinks: Vec<DocumentLinkItem>,
    pub candidates: Vec<DocumentLinkItem>,
}
