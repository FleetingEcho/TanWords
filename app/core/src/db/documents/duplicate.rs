use crate::db::params;
use crate::shim::State;

use crate::db;
use crate::document_privacy::{self, decrypt_bytes, decrypt_text};
use crate::AppState;

#[crate::shim::command]
pub async fn db_duplicate_document(id: i64, conn: State<'_, AppState>) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    // The copy is filed beside the original, so a locked folder has to receive
    // it protected. Resolve that before writing anything: refusing up front
    // (no master key in the session) beats leaving a plaintext copy inside a
    // folder the UI presents as sealed.
    let source_folder = db::fetch_one(
        &db,
        "SELECT folder FROM documents WHERE id=?1",
        [id],
        |row| row.get::<String>(0),
    )
    .await?;
    if document_privacy::folder_lock_requires_password(&db, &conn.document_privacy, &source_folder)
        .await?
    {
        return Err(document_privacy::LOCKED_ERROR.to_string());
    }
    if document_privacy::document_is_protected(&db, id).await? {
        let key = conn.document_privacy.key(id)?;
        let (title, stored_content, stored_text, tags, word_count, status) = db::fetch_one(
            &db,
            "SELECT title,content,content_text,tags,word_count,status FROM documents WHERE id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<String>(0)?,
                    row.get::<String>(1)?,
                    row.get::<String>(2)?,
                    row.get::<String>(3)?,
                    row.get::<i64>(4)?,
                    row.get::<String>(5)?,
                ))
            },
        )
        .await?;
        let mut content = decrypt_text(&key, &stored_content)?;
        let content_text = decrypt_text(&key, &stored_text)?;
        let (task_total, task_done) = super::tasks::count_tasks(&content);
        let new_document_id = db::fetch_one(
            &db,
            "INSERT INTO documents(title,content,content_text,tags,word_count,task_total,task_done,status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) RETURNING id",
            params![
                format!("{title} (copy)"),
                content.clone(),
                content_text,
                tags,
                word_count,
                task_total,
                task_done,
                status
            ],
            |r| r.get::<i64>(0),
        )
        .await?;
        // The copy belongs beside the original, not at the library root.
        db.execute(
            "UPDATE documents SET folder=(SELECT folder FROM documents WHERE id=?1) WHERE id=?2",
            params![id, new_document_id],
        )
        .await
        .map_err(|e| e.to_string())?;
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
        // The copy just arrived in the source's folder; a locked chain must
        // receive it protected, like any other arrival.
        document_privacy::protect_if_folder_locked(
            &db,
            &conn.document_privacy,
            new_document_id,
            &source_folder,
        )
        .await?;
        return Ok(new_document_id);
    }
    let new_document_id = db::fetch_one(
        &db,
        "INSERT INTO documents (title, content, content_text, tags, word_count, folder, task_total, task_done, status)
         SELECT title || ' (copy)', content, content_text, tags, word_count, folder, task_total, task_done, status
         FROM documents WHERE id = ?1 RETURNING id",
        params![id],
        |r| r.get::<i64>(0),
    )
    .await?;
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
    // Same arrival rule as the protected branch above.
    document_privacy::protect_if_folder_locked(
        &db,
        &conn.document_privacy,
        new_document_id,
        &source_folder,
    )
    .await?;
    Ok(new_document_id)
}
