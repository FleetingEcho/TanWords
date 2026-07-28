use libsql::{Connection, Result as SqlResult};

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
mod v022_026;

use v001_005::{MIGRATION_01, MIGRATION_02, MIGRATION_03, MIGRATION_04, MIGRATION_05};
use v006_010::{MIGRATION_06, MIGRATION_07, MIGRATION_08, MIGRATION_09, MIGRATION_10};
use v011_015::{MIGRATION_11, MIGRATION_12, MIGRATION_13, MIGRATION_14, MIGRATION_15};
use v016_021::{MIGRATION_16, MIGRATION_17, MIGRATION_18, MIGRATION_19, MIGRATION_20, MIGRATION_21};
use v022_026::{MIGRATION_22, MIGRATION_23};

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
    MIGRATION_22,
    MIGRATION_23,
];

/// The version a fully-migrated database lands on. Exposed so tests can assert
/// "everything applied" without hard-coding a number that goes stale the next
/// time a migration is added.
pub fn latest_version() -> i64 {
    MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0)
}

pub async fn run(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
    )
    .await?;

    let current: i64 = match conn
        .query("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", ())
        .await
    {
        Ok(mut rows) => match rows.next().await {
            Ok(Some(row)) => row.get(0).unwrap_or(0),
            _ => 0,
        },
        Err(_) => 0,
    };

    for m in MIGRATIONS {
        if m.version <= current {
            continue;
        }
        conn.execute_batch(m.sql)
            .await
            .unwrap_or_else(|e| panic!("migration {} ({}) failed: {e}", m.version, m.description));
        conn.execute(
            "INSERT INTO schema_migrations (version) VALUES (?1)",
            [m.version],
        )
        .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Migrations are pure schema work, so an in-memory libsql database
    /// exercises them exactly like the real local profile does.
    async fn memory_conn() -> Connection {
        libsql::Builder::new_local(":memory:")
            .build()
            .await
            .unwrap()
            .connect()
            .unwrap()
    }

    /// `run` applies *every* pending migration, not just the one under test,
    /// so a test that seeds only the table it cares about trips over a later
    /// migration altering some other table. These are the pre-existing tables
    /// that migrations 16-23 touch, in their shape as of version 15.
    async fn seed_legacy_tables(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT NOT NULL UNIQUE
             );
             CREATE TABLE IF NOT EXISTS rss_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id INTEGER NOT NULL,
                url TEXT NOT NULL UNIQUE
             );
             CREATE TABLE IF NOT EXISTS extracted_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'word'
             );
             CREATE TABLE IF NOT EXISTS articles (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                origin     TEXT NOT NULL DEFAULT 'pasted',
                content    TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .await
        .unwrap();
    }

    async fn count(conn: &Connection, sql: &str) -> i64 {
        let mut rows = conn.query(sql, ()).await.unwrap();
        rows.next().await.unwrap().unwrap().get(0).unwrap()
    }

    async fn opt_text(conn: &Connection, sql: &str) -> Option<String> {
        let mut rows = conn.query(sql, ()).await.unwrap();
        rows.next().await.unwrap().unwrap().get(0).unwrap()
    }

    async fn opt_int(conn: &Connection, sql: &str) -> Option<i64> {
        let mut rows = conn.query(sql, ()).await.unwrap();
        rows.next().await.unwrap().unwrap().get(0).unwrap()
    }

    #[tokio::test]
    async fn migration_16_adds_feed_preferences_and_pins_five() {
        let conn = memory_conn().await;
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
        .await
        .unwrap();
        seed_legacy_tables(&conn).await;
        for i in 0..7 {
            conn.execute(
                "INSERT INTO rss_feeds(title, url) VALUES (?1, ?2)",
                libsql::params![format!("feed {i}"), format!("https://example.com/{i}")],
            )
            .await
            .unwrap();
        }

        run(&conn).await.unwrap();

        let pinned = count(&conn, "SELECT COUNT(*) FROM rss_feeds WHERE is_pinned = 1").await;
        let category = opt_text(&conn, "SELECT category_override FROM rss_feeds LIMIT 1").await;
        assert_eq!(pinned, 5);
        assert_eq!(category, None);
    }

    #[tokio::test]
    async fn migration_20_replaces_extracted_items_with_markdown_notes_and_saved_sentences() {
        let conn = memory_conn().await;
        conn.execute_batch("PRAGMA foreign_keys=ON;").await.unwrap();
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
        .await
        .unwrap();
        seed_legacy_tables(&conn).await;

        run(&conn).await.unwrap();

        // extracted_items is fully superseded and dropped.
        let extracted_items_exists = count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='extracted_items'",
        )
        .await;
        assert_eq!(extracted_items_exists, 0);

        // articles gained analysis_markdown, defaulting to '' for existing rows.
        let markdown = opt_text(&conn, "SELECT analysis_markdown FROM articles WHERE id = 1").await;
        assert_eq!(markdown.as_deref(), Some(""));
        conn.execute(
            "UPDATE articles SET analysis_markdown = ?1 WHERE id = 1",
            libsql::params!["## Words\n- **foo** — 中文"],
        )
        .await
        .unwrap();

        // saved_sentences supports the manual save flow, with article_id set null on delete.
        conn.execute(
            "INSERT INTO saved_sentences (text, zh, note, article_id, article_title) VALUES (?1, ?2, ?3, ?4, ?5)",
            libsql::params!["A great sentence.", "一句好句子", "note", 1, "Test Article"],
        )
        .await
        .unwrap();
        conn.execute("DELETE FROM articles WHERE id = 1", ()).await.unwrap();
        let article_id = opt_int(
            &conn,
            "SELECT article_id FROM saved_sentences WHERE text = 'A great sentence.'",
        )
        .await;
        assert_eq!(article_id, None);
    }
}
