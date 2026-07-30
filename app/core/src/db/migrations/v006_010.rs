use super::Migration;

pub(super) const MIGRATION_06: Migration = Migration {
    version: 6,
    description: "add rss_feeds for RSS feed subscriptions",
    sql: "
            CREATE TABLE IF NOT EXISTS rss_feeds (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                title           TEXT NOT NULL DEFAULT '',
                url             TEXT NOT NULL,
                site_link       TEXT NOT NULL DEFAULT '',
                description     TEXT NOT NULL DEFAULT '',
                last_fetched_at TEXT,
                created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_feeds_url ON rss_feeds(url);
        ",
};

pub(super) const MIGRATION_07: Migration = Migration {
    version: 7,
    description: "add pattern_practice for production practice (造句练习)",
    sql: "
            CREATE TABLE IF NOT EXISTS pattern_practice (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_id  INTEGER NOT NULL,
                sentence    TEXT NOT NULL,
                feedback    TEXT NOT NULL DEFAULT '',
                verdict     TEXT NOT NULL DEFAULT '',
                saved       INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(pattern_id) REFERENCES patterns(id)
            );
            CREATE INDEX IF NOT EXISTS idx_pattern_practice_pattern ON pattern_practice(pattern_id);
        ",
};

pub(super) const MIGRATION_08: Migration = Migration {
    version: 8,
    description: "add words.enrichment_text for freeform AI word explanations",
    sql: "
            ALTER TABLE words ADD COLUMN enrichment_text TEXT;
        ",
};

pub(super) const MIGRATION_09: Migration = Migration {
    version: 9,
    description: "drop the sentence-pattern library (patterns page removed)",
    sql: "
            DROP TABLE IF EXISTS pattern_practice;
            DROP TABLE IF EXISTS pattern_examples;
            DROP TABLE IF EXISTS patterns;
        ",
};

pub(super) const MIGRATION_10: Migration = Migration {
    version: 10,
    description: "add rss_entries for cached RSS articles (read state, cover images)",
    sql: "
            CREATE TABLE IF NOT EXISTS rss_entries (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id     INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                url         TEXT NOT NULL UNIQUE,
                author      TEXT NOT NULL DEFAULT '',
                summary     TEXT NOT NULL DEFAULT '',
                image_url   TEXT,
                published   TEXT NOT NULL DEFAULT '',
                is_read     INTEGER NOT NULL DEFAULT 0,
                fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_rss_entries_feed ON rss_entries(feed_id, published DESC);
        ",
};
