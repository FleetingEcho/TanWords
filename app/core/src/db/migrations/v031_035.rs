use super::Migration;

/// A document's lifecycle status — "None", active, on hold, completed, dropped.
///
/// Empty string is "None" (the plan's sketch explicitly says don't use NULL:
/// the list query would need a coalesce on every row). Values are a closed set
/// (`active | onhold | completed | dropped`) validated in Rust before the
/// write, so the list can be filtered without sanitising free text.
pub(super) const MIGRATION_31: Migration = Migration {
    version: 31,
    description: "document lifecycle status column",
    sql: "
            ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT '';
        ",
};

/// Per-feed opt-out from bulk/background refreshes. Directly opening the feed
/// can still force a sync, so pausing controls network churn without making the
/// subscription inaccessible.
pub(super) const MIGRATION_32: Migration = Migration {
    version: 32,
    description: "per-feed RSS update pause",
    sql: "
            ALTER TABLE rss_feeds ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
        ",
};

/// Metadata-only writes must not make FTS5 delete and rebuild a large body.
/// Title and plaintext-content changes remain searchable immediately; tags,
/// pins, status, folders, and other bookkeeping columns bypass the trigger.
pub(super) const MIGRATION_33: Migration = Migration {
    version: 33,
    description: "limit document FTS updates to indexed columns",
    sql: "
            DROP TRIGGER IF EXISTS docs_au;
            CREATE TRIGGER docs_au AFTER UPDATE OF title, content_text ON documents
            WHEN old.title IS NOT new.title OR old.content_text IS NOT new.content_text
            BEGIN
                INSERT INTO documents_fts(documents_fts, rowid, title, content_text)
                VALUES ('delete', old.id, old.title, old.content_text);
                INSERT INTO documents_fts(rowid, title, content_text)
                VALUES (new.id, new.title, new.content_text);
            END;
        ",
};
