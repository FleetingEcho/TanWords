use super::Migration;

pub(super) const MIGRATION_01: Migration = Migration {
    version: 1,
    description: "extend words with tags/status for batch tooling + SRS",
    sql: "
            ALTER TABLE words ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE words ADD COLUMN status TEXT NOT NULL DEFAULT 'learning';
            CREATE INDEX IF NOT EXISTS idx_words_source ON words(source);
            CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);
        ",
};

pub(super) const MIGRATION_02: Migration = Migration {
    version: 2,
    description: "drop the removed Grammar module's tables",
    sql: "
            DROP TABLE IF EXISTS grammar_rules;
            DROP TABLE IF EXISTS grammar_chats;
        ",
};

pub(super) const MIGRATION_03: Migration = Migration {
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
};

pub(super) const MIGRATION_04: Migration = Migration {
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
};

pub(super) const MIGRATION_05: Migration = Migration {
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
};
