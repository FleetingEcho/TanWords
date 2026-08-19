//! Folders for library documents.
//!
//! A folder is just a normalised relative path string stored on
//! `documents.folder` — deliberately the same shape as the directory part of a
//! local vault's `rel_path`, so importing `notes/rust/a.md` into the library
//! folder `Study` is a string concatenation rather than a translation between
//! two different models.
//!
//! The tree the sidebar draws is the union of `document_folders.path` and the
//! distinct non-empty `documents.folder` values. `document_folders` carries the
//! folders that hold no documents: without it, dragging the last document out
//! of a folder would make the folder disappear under the user's cursor, and a
//! folder could never be created before there was something to put in it.

use crate::db::params; use crate::db::Conn;

use crate::db;
use crate::shim::State;
use crate::AppState;

/// Canonical form of a folder path: no leading/trailing slash, no empty or
/// `.`/`..` segments, no backslashes. `""` is the library root and is valid.
///
/// Rejecting rather than silently repairing traversal segments is deliberate —
/// these strings are concatenated when a local folder tree is imported, and a
/// silently-repaired `..` would land documents somewhere the user did not pick.
pub fn normalize_folder(input: &str) -> Result<String, String> {
    let unified = input.replace('\\', "/");
    let mut segments: Vec<&str> = Vec::new();
    for segment in unified.split('/') {
        let segment = segment.trim();
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err("folder path may not contain '..'".into());
        }
        segments.push(segment);
    }
    Ok(segments.join("/"))
}

/// Records `folder` and every ancestor of it, so a nested folder created in one
/// step still has clickable parents in the tree.
pub async fn ensure_folder_chain(conn: &Conn, folder: &str) -> Result<(), String> {
    let mut prefix = String::new();
    for segment in folder.split('/').filter(|s| !s.is_empty()) {
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(segment);
        conn.execute(
            "INSERT OR IGNORE INTO document_folders (path) VALUES (?1)",
            params![prefix.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct DocumentFolder {
    pub path: String,
    /// Everything filed here is encrypted, including what arrives later.
    pub locked: bool,
}

/// Every folder that exists, sorted — both the recorded ones and the ones
/// implied by the documents filed in them.
#[crate::shim::command]
pub async fn db_list_document_folders(
    conn: State<'_, AppState>,
) -> Result<Vec<DocumentFolder>, String> {
    let db = db::conn(&conn)?;
    // A folder implied purely by `documents.folder` has no row to carry a flag,
    // hence the 0 on that side of the UNION; MAX collapses the two into one row.
    db::fetch_all(
        &db,
        "SELECT path, MAX(locked) FROM (
             SELECT path, locked FROM document_folders
             UNION ALL
             SELECT folder, 0 FROM documents WHERE folder <> ''
         ) GROUP BY path ORDER BY path",
        (),
        |row| {
            Ok(DocumentFolder {
                path: row.get::<String>(0)?,
                locked: row.get::<i64>(1)? != 0,
            })
        },
    )
    .await
}

/// Creates a folder (and any missing ancestors). Returns the normalised path.
#[crate::shim::command]
pub async fn db_create_document_folder(
    path: String,
    conn: State<'_, AppState>,
) -> Result<String, String> {
    let path = normalize_folder(&path)?;
    if path.is_empty() {
        return Err("folder name is empty".into());
    }
    let db = db::conn(&conn)?;
    ensure_folder_chain(&db, &path).await?;
    Ok(path)
}

/// Renames a folder, carrying its subfolders and documents with it. `new_path`
/// is a full path, not a leaf name, so this doubles as "move folder".
#[crate::shim::command]
pub async fn db_rename_document_folder(
    path: String,
    new_path: String,
    conn: State<'_, AppState>,
) -> Result<String, String> {
    let old = normalize_folder(&path)?;
    let new = normalize_folder(&new_path)?;
    if old.is_empty() || new.is_empty() {
        return Err("folder name is empty".into());
    }
    if old == new {
        return Ok(new);
    }
    // Moving a folder into its own subtree would orphan everything below it.
    if new.starts_with(&format!("{old}/")) {
        return Err("cannot move a folder into itself".into());
    }
    let db = db::conn(&conn)?;
    ensure_folder_chain(&db, &new).await?;
    // `ensure_folder_chain` created the `new` leaf as a placeholder row so the
    // sidebar shows it immediately. The UPDATE below renames `old` -> `new` and
    // would collide with that placeholder on Postgres (SQLite's
    // `UPDATE OR REPLACE` silently deleted the conflicting row first; Postgres
    // has no such form). Drop the placeholder leaf here so the renamed row can
    // take the `new` path — net effect matches SQLite: `new` exists (the
    // renamed row), `old` is gone, ancestors are preserved.
    db.execute(
        "DELETE FROM document_folders WHERE path = ?1",
        params![new.clone()],
    )
    .await
    .map_err(|e| e.to_string())?;
    for (table, column) in [("documents", "folder"), ("document_folders", "path")] {
        // `substr(col, 1, n) = old || '/'` rather than LIKE: folder names may
        // contain `%` or `_`, which LIKE would read as wildcards.
        db.execute(
            &format!(
                "UPDATE OR REPLACE {table} SET {column} = ?1 || substr({column}, length(?2) + 1)
                 WHERE {column} = ?2 OR substr({column}, 1, length(?2) + 1) = ?2 || '/'"
            ),
            params![new.clone(), old.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(new)
}

/// Removes a folder without removing anything filed in it: its documents and
/// subfolders move up one level, into what used to be its parent.
#[crate::shim::command]
pub async fn db_delete_document_folder(
    path: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let path = normalize_folder(&path)?;
    if path.is_empty() {
        return Err("folder name is empty".into());
    }
    let db = db::conn(&conn)?;
    let parent = match path.rfind('/') {
        Some(index) => path[..index].to_string(),
        None => String::new(),
    };
    let prefix = format!("{path}/");

    let affected: Vec<String> = db::fetch_all(
        &db,
        "SELECT path FROM document_folders
         WHERE path = ?1 OR substr(path, 1, length(?1) + 1) = ?1 || '/'
         UNION
         SELECT DISTINCT folder FROM documents
         WHERE folder = ?1 OR substr(folder, 1, length(?1) + 1) = ?1 || '/'",
        params![path.clone()],
        |row| row.get::<String>(0),
    )
    .await?;

    for old in affected {
        let suffix = old.strip_prefix(&prefix).unwrap_or("");
        let new = match (parent.as_str(), suffix) {
            (parent, "") => parent.to_string(),
            ("", suffix) => suffix.to_string(),
            (parent, suffix) => format!("{parent}/{suffix}"),
        };
        db.execute(
            "UPDATE documents SET folder = ?1 WHERE folder = ?2",
            params![new.clone(), old.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;
        db.execute("DELETE FROM document_folders WHERE path = ?1", params![old])
            .await
            .map_err(|e| e.to_string())?;
        if !new.is_empty() {
            ensure_folder_chain(&db, &new).await?;
        }
    }
    Ok(())
}

/// Files documents into `folder` — one id when a row is dragged, many when a
/// multi-selection is. Passing `""` moves them back to the library root.
#[crate::shim::command]
pub async fn db_set_documents_folder(
    ids: Vec<i64>,
    folder: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let folder = normalize_folder(&folder)?;
    let db = db::conn(&conn)?;
    if !folder.is_empty() {
        ensure_folder_chain(&db, &folder).await?;
    }
    // `updated_at` stays put: filing a document is not editing it, and bumping
    // it would reshuffle the default "recently modified" sort on every drag.
    let placeholders = (0..ids.len())
        .map(|i| format!("?{}", i + 2))
        .collect::<Vec<_>>()
        .join(",");
    let mut values: Vec<crate::db::Value> = Vec::with_capacity(ids.len() + 1);
    values.push(folder.clone().into());
    values.extend(ids.iter().copied().map(crate::db::Value::from));
    db.execute(
        &format!("UPDATE documents SET folder = ?1 WHERE id IN ({placeholders})"),
        values,
    )
    .await
    .map_err(|e| e.to_string())?;
    // Filing into a locked folder encrypts what was just filed. Moving *out* of
    // one deliberately does not decrypt: dragging a document somewhere is not a
    // decision to publish its contents, and un-protecting stays an explicit act.
    if !folder.is_empty() {
        for id in &ids {
            crate::document_privacy::protect_if_folder_locked(
                &db,
                &conn.document_privacy,
                *id,
                &folder,
            )
            .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_folder;

    #[test]
    fn normalizes_separators_and_edges() {
        assert_eq!(normalize_folder("").unwrap(), "");
        assert_eq!(normalize_folder("/a/b/").unwrap(), "a/b");
        assert_eq!(normalize_folder("a//b").unwrap(), "a/b");
        assert_eq!(normalize_folder("a\\b").unwrap(), "a/b");
        assert_eq!(normalize_folder(" a / b ").unwrap(), "a/b");
        assert_eq!(normalize_folder("./a").unwrap(), "a");
    }

    #[test]
    fn rejects_traversal() {
        assert!(normalize_folder("../a").is_err());
        assert!(normalize_folder("a/../../b").is_err());
    }
}
