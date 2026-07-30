use libsql::params;
use crate::shim::State;

use crate::db;
use crate::document_privacy::{self, decrypt_bytes, decrypt_text};
use crate::AppState;

#[crate::shim::command]
pub async fn db_duplicate_document(id: i64, conn: State<'_, AppState>) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    if document_privacy::document_is_protected(&db, id).await? {
        let key = conn.document_privacy.key(id)?;
        let (title, stored_content, stored_text, tags, word_count) = db::fetch_one(
            &db,
            "SELECT title,content,content_text,tags,word_count FROM documents WHERE id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<String>(0)?,
                    row.get::<String>(1)?,
                    row.get::<String>(2)?,
                    row.get::<String>(3)?,
                    row.get::<i64>(4)?,
                ))
            },
        )
        .await?;
        let mut content = decrypt_text(&key, &stored_content)?;
        let content_text = decrypt_text(&key, &stored_text)?;
        db.execute(
            "INSERT INTO documents(title,content,content_text,tags,word_count) VALUES(?1,?2,?3,?4,?5)",
            params![format!("{title} (copy)"), content.clone(), content_text, tags, word_count],
        ).await.map_err(|e| e.to_string())?;
        let new_document_id = db.last_insert_rowid();
        let assets = db::fetch_all(
            &db,
            "SELECT id,file_name,mime_type,data,size FROM document_assets WHERE document_id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<String>(0)?,
                    row.get::<String>(1)?,
                    row.get::<String>(2)?,
                    row.get::<Vec<u8>>(3)?,
                    row.get::<i64>(4)?,
                ))
            },
        )
        .await?;
        for (old_id, file_name, mime_type, encrypted, size) in assets {
            let new_id = uuid::Uuid::new_v4().to_string();
            db.execute(
                "INSERT INTO document_assets(id,document_id,file_name,mime_type,data,size) VALUES(?1,?2,?3,?4,?5,?6)",
                params![new_id.clone(), new_document_id, file_name, mime_type, decrypt_bytes(&key, &encrypted)?, size],
            ).await.map_err(|e| e.to_string())?;
            content = content.replace(
                &format!("tanwords-asset://{old_id}"),
                &format!("tanwords-asset://{new_id}"),
            );
        }
        db.execute(
            "UPDATE documents SET content=?1 WHERE id=?2",
            params![content, new_document_id],
        )
        .await
        .map_err(|e| e.to_string())?;
        return Ok(new_document_id);
    }
    db.execute(
        "INSERT INTO documents (title, content, content_text, tags, word_count)
         SELECT title || ' (copy)', content, content_text, tags, word_count
         FROM documents WHERE id = ?1",
        params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    let new_document_id = db.last_insert_rowid();
    let mut content = db::fetch_one(
        &db,
        "SELECT content FROM documents WHERE id = ?1",
        params![new_document_id],
        |row| row.get::<String>(0),
    )
    .await?;
    let assets = db::fetch_all(
        &db,
        "SELECT id, file_name, mime_type, data, size FROM document_assets WHERE document_id = ?1",
        params![id],
        |row| {
            Ok((
                row.get::<String>(0)?,
                row.get::<String>(1)?,
                row.get::<String>(2)?,
                row.get::<Vec<u8>>(3)?,
                row.get::<i64>(4)?,
            ))
        },
    )
    .await?;
    for (old_id, file_name, mime_type, data, size) in assets {
        let new_id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO document_assets (id, document_id, file_name, mime_type, data, size)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                new_id.clone(),
                new_document_id,
                file_name,
                mime_type,
                data,
                size
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
        content = content.replace(
            &format!("tanwords-asset://{old_id}"),
            &format!("tanwords-asset://{new_id}"),
        );
    }
    db.execute(
        "UPDATE documents SET content = ?1 WHERE id = ?2",
        params![content, new_document_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(new_document_id)
}
