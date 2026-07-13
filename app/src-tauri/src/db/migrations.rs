use rusqlite::{Connection, Result as SqlResult};

/// A single forward-only schema change. Migrations run in order once each,
/// tracked in `schema_migrations`. Unlike the old `ALTER ... .ok()` pattern
/// (still used for a few legacy columns in `init_db`), a migration that
/// fails aborts startup instead of silently no-op'ing.
struct Migration {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        description: "extend words with tags/status for batch tooling + SRS",
        sql: "
            ALTER TABLE words ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE words ADD COLUMN status TEXT NOT NULL DEFAULT 'learning';
            CREATE INDEX IF NOT EXISTS idx_words_source ON words(source);
            CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);
        ",
    },
    Migration {
        version: 2,
        description: "drop the removed Grammar module's tables",
        sql: "
            DROP TABLE IF EXISTS grammar_rules;
            DROP TABLE IF EXISTS grammar_chats;
        ",
    },
    Migration {
        version: 3,
        description: "add FSRS fields to srs_records for spaced-repetition review",
        sql: "
            ALTER TABLE srs_records ADD COLUMN stability REAL NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN difficulty REAL NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN elapsed_days INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN scheduled_days INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN state INTEGER NOT NULL DEFAULT 0;
        ",
    },
    Migration {
        version: 4,
        description: "add search_history for the dictionary page's recent-lookups list",
        sql: "
            CREATE TABLE IF NOT EXISTS search_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                word        TEXT NOT NULL,
                searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_search_history_searched_at ON search_history(searched_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_search_history_word ON search_history(word);
        ",
    },
    Migration {
        version: 5,
        description: "add patterns + pattern_examples for the sentence-pattern library",
        sql: "
            CREATE TABLE IF NOT EXISTS patterns (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern       TEXT NOT NULL,
                zh            TEXT NOT NULL DEFAULT '',
                function_tag  TEXT NOT NULL DEFAULT 'other',
                level         TEXT,
                note          TEXT NOT NULL DEFAULT '',
                analysis      TEXT,
                created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS pattern_examples (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_id  INTEGER NOT NULL,
                sentence    TEXT NOT NULL,
                source      TEXT NOT NULL DEFAULT '',
                article_id  INTEGER,
                created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(pattern_id) REFERENCES patterns(id)
            );
            CREATE INDEX IF NOT EXISTS idx_pattern_examples_pattern ON pattern_examples(pattern_id);
            CREATE INDEX IF NOT EXISTS idx_pattern_examples_article ON pattern_examples(article_id);
        ",
    },
    Migration {
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
    },
    Migration {
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
    },
    Migration {
        version: 8,
        description: "add words.enrichment_text for freeform AI word explanations",
        sql: "
            ALTER TABLE words ADD COLUMN enrichment_text TEXT;
        ",
    },
    Migration {
        version: 9,
        description: "drop the sentence-pattern library (patterns page removed)",
        sql: "
            DROP TABLE IF EXISTS pattern_practice;
            DROP TABLE IF EXISTS pattern_examples;
            DROP TABLE IF EXISTS patterns;
        ",
    },
    Migration {
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
    },
    Migration {
        version: 11,
        description: "add audio enclosure fields to rss_entries for podcast playback",
        sql: "
            ALTER TABLE rss_entries ADD COLUMN audio_url TEXT;
            ALTER TABLE rss_entries ADD COLUMN audio_duration INTEGER;
        ",
    },
];

pub fn run(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
    )?;

    let current: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .unwrap_or(0);

    for m in MIGRATIONS {
        if m.version <= current {
            continue;
        }
        conn.execute_batch(m.sql)
            .unwrap_or_else(|e| panic!("migration {} ({}) failed: {e}", m.version, m.description));
        conn.execute(
            "INSERT INTO schema_migrations (version) VALUES (?1)",
            [m.version],
        )?;
    }

    Ok(())
}
