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
    /// Normalised relative folder path; "" is the library root.
    pub folder: String,
    pub task_total: i64,
    pub task_done: i64,
    /// Lifecycle status: one of "", "active", "onhold", "completed",
    /// "dropped". String so it rides DocumentListItem's serialisation.
    pub status: String,
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
    /// Normalised relative folder path; "" is the library root.
    pub folder: String,
    /// Lifecycle status: one of "", "active", "onhold", "completed",
    /// "dropped". See `normalize_status` in crud.rs.
    pub status: String,
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
    /// Set when the bytes live in R2 rather than in the row: a URL the
    /// renderer can use directly, which also gets Range support (seeking in a
    /// video) for free. `data_base64` is empty in that case.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
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
    /// Uploaded from the asset manager, not from inside a document. Never
    /// auto-deleted — see the `standalone_assets` comment in db/mod.rs.
    pub standalone: bool,
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
