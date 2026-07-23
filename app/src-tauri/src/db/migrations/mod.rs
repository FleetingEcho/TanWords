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

mod v001_005;
mod v006_010;
mod v011_015;
mod v016_021;

use v001_005::{MIGRATION_01, MIGRATION_02, MIGRATION_03, MIGRATION_04, MIGRATION_05};
use v006_010::{MIGRATION_06, MIGRATION_07, MIGRATION_08, MIGRATION_09, MIGRATION_10};
use v011_015::{MIGRATION_11, MIGRATION_12, MIGRATION_13, MIGRATION_14, MIGRATION_15};
use v016_021::{MIGRATION_16, MIGRATION_17, MIGRATION_18, MIGRATION_19, MIGRATION_20, MIGRATION_21};

const MIGRATIONS: &[Migration] = &[
    MIGRATION_01,
    MIGRATION_02,
    MIGRATION_03,
    MIGRATION_04,
    MIGRATION_05,
    MIGRATION_06,
    MIGRATION_07,
    MIGRATION_08,
    MIGRATION_09,
    MIGRATION_10,
    MIGRATION_11,
    MIGRATION_12,
    MIGRATION_13,
    MIGRATION_14,
    MIGRATION_15,
    MIGRATION_16,
    MIGRATION_17,
    MIGRATION_18,
    MIGRATION_19,
    MIGRATION_20,
    MIGRATION_21,
];

pub fn run(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
    )?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |r| r.get(0),
        )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_16_adds_feed_preferences_and_pins_five() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME);
             INSERT INTO schema_migrations(version) VALUES (15);
             CREATE TABLE rss_feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
                site_link TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
                last_fetched_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .unwrap();
        for i in 0..7 {
            conn.execute(
                "INSERT INTO rss_feeds(title, url) VALUES (?1, ?2)",
                rusqlite::params![format!("feed {i}"), format!("https://example.com/{i}")],
            )
            .unwrap();
        }

        run(&conn).unwrap();

        let pinned: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rss_feeds WHERE is_pinned = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let category: Option<String> = conn
            .query_row("SELECT category_override FROM rss_feeds LIMIT 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(pinned, 5);
        assert_eq!(category, None);
    }

    #[test]
    fn migration_20_replaces_extracted_items_with_markdown_notes_and_saved_sentences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME);
             INSERT INTO schema_migrations(version) VALUES (19);
             CREATE TABLE articles (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                origin     TEXT NOT NULL DEFAULT 'pasted',
                content    TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE extracted_items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL,
                kind       TEXT NOT NULL DEFAULT 'word'
             );
             INSERT INTO articles (title, content) VALUES ('Test Article', 'Some content.');
             INSERT INTO extracted_items (article_id, kind) VALUES (1, 'word');",
        )
        .unwrap();

        run(&conn).unwrap();

        // extracted_items is fully superseded and dropped.
        let extracted_items_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='extracted_items'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(extracted_items_exists, 0);

        // articles gained analysis_markdown, defaulting to '' for existing rows.
        let markdown: String = conn
            .query_row("SELECT analysis_markdown FROM articles WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(markdown, "");
        conn.execute(
            "UPDATE articles SET analysis_markdown = ?1 WHERE id = 1",
            rusqlite::params!["## Words\n- **foo** — 中文"],
        )
        .unwrap();

        // saved_sentences supports the manual save flow, with article_id set null on delete.
        conn.execute(
            "INSERT INTO saved_sentences (text, zh, note, article_id, article_title) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["A great sentence.", "一句好句子", "note", 1, "Test Article"],
        )
        .unwrap();
        conn.execute("DELETE FROM articles WHERE id = 1", []).unwrap();
        let article_id: Option<i64> = conn
            .query_row("SELECT article_id FROM saved_sentences WHERE text = 'A great sentence.'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(article_id, None);
    }
}
