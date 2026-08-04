use super::Migration;

pub(super) const MIGRATION_27: Migration = Migration {
    version: 27,
    description: "persisted bookmarks for RSS and Hacker News articles",
    sql: "
            CREATE TABLE IF NOT EXISTS feed_bookmarks (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                url            TEXT NOT NULL UNIQUE,
                title          TEXT NOT NULL DEFAULT '',
                feed_title     TEXT NOT NULL DEFAULT '',
                domain         TEXT NOT NULL DEFAULT '',
                summary        TEXT NOT NULL DEFAULT '',
                image_url      TEXT,
                audio_url      TEXT,
                audio_duration INTEGER,
                hn_item_id     INTEGER,
                published      TEXT NOT NULL DEFAULT '',
                created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_feed_bookmarks_created
                ON feed_bookmarks(created_at DESC);
        ",
};

/// Folders for library documents, mirroring the local vault's directory tree.
///
/// `documents.folder` holds a normalised relative path ("" = library root,
/// otherwise "a/b" with no leading or trailing slash) — the same shape
/// `LocalDocItem.rel_path`'s directory part has, so a local folder can be
/// imported into a library folder without translating between two models.
///
/// `document_folders` exists only so a folder can be *empty*: the tree is the
/// union of this table and the distinct non-empty `documents.folder` values,
/// which means dragging the last document out of a folder does not make the
/// folder vanish under the user's cursor.
pub(super) const MIGRATION_28: Migration = Migration {
    version: 28,
    description: "folders for library documents",
    sql: "
            ALTER TABLE documents ADD COLUMN folder TEXT NOT NULL DEFAULT '';
            CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder);
            CREATE TABLE IF NOT EXISTS document_folders (
                path       TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        ",
};

/// A folder can be locked, and everything filed into it inherits that.
///
/// Protection was already a per-document toggle; what it lacked was a way to
/// say "and anything I put here later, too". Without that the guarantee leaks
/// the moment you drag one more document in, which is precisely when you are
/// not thinking about encryption.
pub(super) const MIGRATION_29: Migration = Migration {
    version: 29,
    description: "lockable library folders",
    sql: "
            ALTER TABLE document_folders ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
        ",
};
