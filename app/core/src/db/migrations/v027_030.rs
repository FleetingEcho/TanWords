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
