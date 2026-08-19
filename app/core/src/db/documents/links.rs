use crate::db::params;
use crate::shim::State;

use super::types::{DocumentLinkContext, DocumentLinkItem};
use crate::db;
use crate::document_privacy::{self, decrypt_text};
use crate::AppState;

#[crate::shim::command]
pub async fn db_get_document_link_context(
    document_id: i64,
    conn: State<'_, AppState>,
) -> Result<DocumentLinkContext, String> {
    let database = db::conn(&conn)?;
    let key = document_privacy::require_key(&database, &conn.document_privacy, document_id).await?;
    let candidates = db::fetch_all(
        &database,
        "SELECT id, title FROM documents WHERE id != ?1 ORDER BY title COLLATE NOCASE",
        params![document_id],
        |row| {
            Ok(DocumentLinkItem {
                id: row.get(0)?,
                title: row.get(1)?,
            })
        },
    )
    .await?;
    let stored_content = db::fetch_one(
        &database,
        "SELECT content FROM documents WHERE id = ?1",
        params![document_id],
        |row| row.get::<String>(0),
    )
    .await?;
    let content = match key {
        Some(key) => decrypt_text(&key, &stored_content)?,
        None => stored_content,
    };
    let outgoing = candidates
        .iter()
        .filter(|item| content.contains(&format!("tanwords-doc://{}", item.id)))
        .map(|item| DocumentLinkItem {
            id: item.id,
            title: item.title.clone(),
        })
        .collect();
    let backlinks = db::fetch_all(
        &database,
        "SELECT id, title FROM documents
         WHERE id != ?1 AND protected=0 AND instr(content, 'tanwords-doc://' || ?1) > 0
         ORDER BY title COLLATE NOCASE",
        params![document_id],
        |row| {
            Ok(DocumentLinkItem {
                id: row.get(0)?,
                title: row.get(1)?,
            })
        },
    )
    .await?;
    Ok(DocumentLinkContext {
        outgoing,
        backlinks,
        candidates,
    })
}
