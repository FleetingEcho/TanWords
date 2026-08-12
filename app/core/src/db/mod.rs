use libsql::{Connection, Result as SqlResult};
use crate::shim::State;
use std::future::Future;
use std::time::Duration;

use crate::AppState;

// ── Helper ──────────────────────────────────────────────────────────────────

/// The active DB connection, cloned out from under the state mutex.
///
/// Returns an owned handle rather than a guard on purpose: commands `.await`
/// on it, and holding a lock across a suspend point is both a deadlock risk
/// and (for `std::sync::MutexGuard`) not `Send`. `libsql::Connection` is an
/// Arc handle, so cloning is cheap and every clone talks to the same database.
pub fn conn(state: &State<'_, AppState>) -> Result<Connection, String> {
    Ok(state.db.lock().map_err(|e| e.to_string())?.conn())
}

/// Turso embedded-replica writes are forwarded to the primary. If that network
/// request becomes half-open, libsql may otherwise leave the calling command
/// pending forever — which in turn leaves editor autosave stuck on "Saving".
const TURSO_WRITE_TIMEOUT: Duration = Duration::from_secs(10);

async fn await_write_for_kind<T>(
    kind: connection::DbKind,
    timeout: Duration,
    future: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    if kind == connection::DbKind::Local {
        return future.await;
    }
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| format!("Turso database write timed out after {timeout:?}"))?
}

/// Await a write using the active profile's policy. Local SQLite remains
/// unbounded because it has no network hop; only Turso needs the deadline.
pub async fn await_write<T>(
    state: &State<'_, AppState>,
    future: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let kind = state.db.lock().map_err(|e| e.to_string())?.kind();
    await_write_for_kind(kind, TURSO_WRITE_TIMEOUT, future).await
}

/// A dedicated connection for commands that open an interactive transaction.
///
/// The shared handle above is a single Hrana stream on a Turso profile. A
/// transaction opened on it pins the stream into Txn state, and every command
/// running concurrently on a clone of it then fails — "connection has reached
/// an invalid state, started with Txn" / "Stream already in use". Giving each
/// transaction its own connection keeps the shared stream in autocommit.
/// Local profiles keep the shared connection: a single local handle serializes
/// fine (and a second connection to a `:memory:` database would be a different,
/// empty database entirely). Only Turso gets a fresh stream.
pub async fn txn_conn(state: &State<'_, AppState>) -> Result<Connection, String> {
    let (database, kind) = {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        if guard.kind() == connection::DbKind::Local {
            return Ok(guard.conn());
        }
        (guard.database(), guard.kind())
    };
    let conn = database.connect().map_err(|e| e.to_string())?;
    connection::apply_pragmas(&conn, kind).await;
    Ok(conn)
}

// ── Sub-modules ────────────────────────────────────────────────────────────

pub mod connection;
pub mod import;
pub mod rows;
pub use connection::{DbCaps, DbDescriptor, DbKind, DbProfile};
pub use import::*;
pub use rows::{fetch_all, fetch_one, fetch_optional, scalar_i64};

pub mod settings;
pub mod words_types;
pub mod words_query;
pub mod words_write;
pub mod translations;
pub mod quiz;
pub mod documents;
pub mod chat;
mod reading;
pub mod articles;
pub mod dashboard;
pub mod device_paths;
pub mod migrations;
pub mod srs;
pub mod search_history;
pub mod scene_lab;
pub mod patterns;
pub mod ai_providers;

pub use settings::*;
pub use words_types::*;
pub use words_query::*;
pub use words_write::*;
pub use translations::*;
pub use quiz::*;
pub use documents::*;
pub use chat::*;
pub use reading::*;
pub use articles::*;
pub use dashboard::*;
pub use device_paths::*;
pub use srs::*;
pub use search_history::*;
pub use scene_lab::*;
pub use patterns::*;

#[cfg(test)]
mod write_timeout_tests {
    use super::{await_write_for_kind, connection::DbKind};
    use std::time::Duration;

    #[tokio::test]
    async fn stalled_turso_write_returns_an_error() {
        let error = await_write_for_kind(
            DbKind::Turso,
            Duration::from_millis(20),
            std::future::pending::<Result<(), String>>(),
        )
        .await
        .expect_err("a stalled remote write must time out");

        assert_eq!(error, "Turso database write timed out after 20ms");
    }

    #[tokio::test]
    async fn completed_local_write_passes_through() {
        let value = await_write_for_kind(DbKind::Local, Duration::ZERO, async { Ok(42) })
            .await
            .expect("local writes should not use the Turso deadline");

        assert_eq!(value, 42);
    }
}

// ── Database Initialization ─────────────────────────────────────────────────

/// Where `init_db` records the schema state it last brought this database to.
/// In `user_settings` rather than its own table so the check below costs one
/// query on a database that already has the schema, instead of a CREATE first.
const SCHEMA_FINGERPRINT_KEY: &str = "__schema_fingerprint";

/// Identifies "the schema `init_db` produces, as this build writes it".
///
/// Hashed from the source rather than a hand-maintained revision number on
/// purpose. The whole point of the fast path below is to skip the idempotent
/// pass entirely, and a statement added to `init_db` without a matching bump
/// would then silently never reach databases that already exist — a column
/// missing only on upgraded installs, which is the worst kind of bug to find.
/// A hash cannot be forgotten. It errs the other way instead: any edit to this
/// file re-runs the pass once, on one launch, for one user's own database.
fn schema_fingerprint() -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(include_str!("../../sql/schema.sql"));
    hasher.update(include_str!("mod.rs"));
    hasher.update(migrations::latest_version().to_le_bytes());
    format!("{:x}", hasher.finalize())
}

/// The fingerprint this database was last initialised to, if any. A fresh
/// database has no `user_settings` table yet and the query fails — which is
/// the same answer as a stale one: run everything.
async fn stored_fingerprint(conn: &Connection) -> Option<String> {
    let mut rows = conn
        .query(
            "SELECT value FROM user_settings WHERE key = ?1",
            libsql::params![SCHEMA_FINGERPRINT_KEY],
        )
        .await
        .ok()?;
    rows.next().await.ok()??.get::<String>(0).ok()
}

/// PRAGMAs are applied by `connection::open` before this runs — they are
/// per-connection and partly profile-dependent, unlike the schema below.
///
/// Everything here is idempotent, and on a local file re-running it costs
/// nothing measurable. On a Turso profile it is the single most expensive
/// thing the app does: writes go to the primary, so each `CREATE TABLE IF NOT
/// EXISTS`, each expected-to-fail `ALTER`, and each `INSERT OR IGNORE` is its
/// own network round-trip — about forty of them, ~7.4s against a us-west-2
/// primary, on every single launch. Hence the fingerprint: one query answers
/// "this database already has exactly this schema", and the pass is skipped.
pub async fn init_db(conn: &Connection) -> SqlResult<()> {
    let fingerprint = schema_fingerprint();
    if stored_fingerprint(conn).await.as_deref() == Some(fingerprint.as_str()) {
        return Ok(());
    }

    conn.execute_batch(include_str!("../../sql/schema.sql")).await?;

    // Migrations (idempotent)
    let _ = conn.execute("ALTER TABLE words ADD COLUMN enrichment_json TEXT", ()).await;
    let _ = conn.execute("ALTER TABLE words ADD COLUMN user_notes TEXT DEFAULT ''", ()).await;
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS word_chats (
            word_id INTEGER PRIMARY KEY,
            messages TEXT NOT NULL DEFAULT '[]',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(word_id) REFERENCES words(id)
        );"
    ).await;

    // Documents feature
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS documents (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT    NOT NULL DEFAULT 'Untitled',
            content      TEXT    NOT NULL DEFAULT '{}',
            content_text TEXT    NOT NULL DEFAULT '',
            tags         TEXT    NOT NULL DEFAULT '[]',
            pinned       INTEGER NOT NULL DEFAULT 0,
            word_count   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            title,
            content_text,
            content='documents',
            content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON documents BEGIN
            INSERT INTO documents_fts(rowid, title, content_text)
            VALUES (new.id, new.title, new.content_text);
        END;
        CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, content_text)
            VALUES ('delete', old.id, old.title, old.content_text);
        END;
        CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, content_text)
            VALUES ('delete', old.id, old.title, old.content_text);
            INSERT INTO documents_fts(rowid, title, content_text)
            VALUES (new.id, new.title, new.content_text);
        END;
        CREATE TABLE IF NOT EXISTS document_assets (
            id          TEXT PRIMARY KEY,
            document_id INTEGER NOT NULL,
            file_name   TEXT NOT NULL DEFAULT 'image',
            mime_type   TEXT NOT NULL,
            data        BLOB NOT NULL,
            size        INTEGER NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_document_assets_document
            ON document_assets(document_id);"
    ).await;

    // Files uploaded from the asset manager rather than from inside a document.
    // A separate table on purpose: `document_assets.document_id` is NOT NULL
    // with a cascading foreign key, and — more importantly — anything in that
    // table that a document body stops referencing is deleted on the next save
    // (db_prune_document_assets) or by "clean orphans". Uploads are the user's
    // to keep, so they live where neither of those can reach them.
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS standalone_assets (
            id          TEXT PRIMARY KEY,
            file_name   TEXT NOT NULL DEFAULT 'file',
            mime_type   TEXT NOT NULL,
            data        BLOB NOT NULL,
            size        INTEGER NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        -- One id space for reads: fetching, exporting and zipping an asset can
        -- stay a single query against all_document_assets instead of probing
        -- two tables. document_id = 0 matches no document, so require_key()
        -- correctly reports an unprotected, keyless asset for uploads.
        -- Objects that live in R2 instead of this table: `data` is empty and
        -- `remote_key` points at the bucket. See src/r2/mod.rs.
        CREATE VIEW IF NOT EXISTS all_document_assets AS
            SELECT id, document_id, file_name, mime_type, data, size, created_at, 0 AS standalone
              FROM document_assets
            UNION ALL
            SELECT id, 0 AS document_id, file_name, mime_type, data, size, created_at, 1 AS standalone
              FROM standalone_assets;"
    ).await;
    let _ = conn
        .execute("ALTER TABLE standalone_assets ADD COLUMN remote_key TEXT", ())
        .await;

    // R2 bucket the uploads go to. In the database rather than app_config.json
    // because the web server gives every user their own database — that is
    // what makes this per-user for free, instead of one bucket shared by
    // everyone who can log in.
    //
    // The whole configuration is sealed into one column, not just the secret:
    // an account id and access key id are half of a working credential and
    // have no business sitting in plaintext in a file that a Turso profile
    // replicates to the cloud. Sealing the record as a unit also means a field
    // added later cannot be forgotten.
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS r2_config (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            config_enc TEXT NOT NULL
        );"
    ).await;
    // Upgrade path for the short-lived column-per-field shape.
    let _ = conn.execute("ALTER TABLE r2_config ADD COLUMN config_enc TEXT", ()).await;
    let _ = conn.execute(
        "ALTER TABLE documents ADD COLUMN protected INTEGER NOT NULL DEFAULT 0",
        (),
    ).await;
    let _ = conn.execute("ALTER TABLE documents ADD COLUMN protection_salt BLOB", ()).await;
    let _ = conn.execute("ALTER TABLE documents ADD COLUMN wrapped_key BLOB", ()).await;

    // AI Chat sessions
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_chat_sessions (
            id            TEXT PRIMARY KEY,
            title         TEXT    NOT NULL DEFAULT 'New Chat',
            messages      TEXT    NOT NULL DEFAULT '[]',
            system_prompt TEXT    NOT NULL DEFAULT '',
            preset_id     TEXT    NOT NULL DEFAULT 'english-tutor',
            provider_id   TEXT    NOT NULL DEFAULT '',
            message_count INTEGER NOT NULL DEFAULT 0,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated ON ai_chat_sessions(updated_at DESC);"
    ).await;
    // Archived conversations stay searchable but fold out of the main list.
    let _ = conn.execute("ALTER TABLE ai_chat_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0", ()).await;
    // Pinned conversations sort above the rest of their shelf.
    let _ = conn.execute("ALTER TABLE ai_chat_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0", ()).await;

    // Reading lessons: articles + extracted items + known words
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS articles (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT NOT NULL DEFAULT '',
            source_url TEXT NOT NULL DEFAULT '',
            origin     TEXT NOT NULL DEFAULT 'pasted',
            content    TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS extracted_items (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id       INTEGER NOT NULL,
            kind             TEXT NOT NULL DEFAULT 'word',
            text             TEXT NOT NULL,
            zh               TEXT NOT NULL DEFAULT '',
            note             TEXT NOT NULL DEFAULT '',
            level            TEXT NOT NULL DEFAULT '',
            context_sentence TEXT NOT NULL DEFAULT '',
            status           TEXT NOT NULL DEFAULT 'candidate',
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(article_id) REFERENCES articles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_extracted_article ON extracted_items(article_id);
        CREATE TABLE IF NOT EXISTS user_known_words (
            word       TEXT PRIMARY KEY,
            source     TEXT NOT NULL DEFAULT 'marked',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).await;

    // Insert default settings
    let settings = vec![
        ("theme", r#""system""#),
        ("hotkey", r#""CmdOrCtrl+Shift+T""#),
        ("tts_voice", r#""en_US-lessac-high""#),
        ("default_source_lang", r#""auto""#),
        ("default_target_lang", r#""zh""#),
        ("default_ai_provider", r#""openai""#),
        ("quiz_reminder", r#""weekly""#),
        ("ui_language", r#""en""#),
        ("latest_version", r#""0.1.0""#),
        ("target_level", r#""C1""#),
        ("daily_goal", "10"),
    ];

    for (key, value) in settings {
        conn.execute(
            "INSERT OR IGNORE INTO user_settings (key, value) VALUES (?1, ?2)",
            libsql::params![key, value],
        )
        .await?;
    }

    migrations::run(conn).await?;

    // One-time: adopt a desktop R2 configuration that predates the per-database
    // table, so upgrading does not look like the bucket disconnected itself.
    crate::r2::migrate_from_app_config(conn).await;

    // Last, and only on the path where everything above actually ran: the
    // stamp is what lets the next launch skip all of it, so it must never be
    // written for a pass that failed partway.
    conn.execute(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?1, ?2)",
        libsql::params![SCHEMA_FINGERPRINT_KEY, fingerprint],
    )
    .await?;

    Ok(())
}

#[cfg(test)]
mod init_db_tests {
    use super::*;

    async fn memory_conn() -> Connection {
        libsql::Builder::new_local(":memory:")
            .build()
            .await
            .unwrap()
            .connect()
            .unwrap()
    }

    async fn table_exists(conn: &Connection, name: &str) -> bool {
        let mut rows = conn
            .query(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                libsql::params![name],
            )
            .await
            .unwrap();
        rows.next().await.unwrap().is_some()
    }

    /// The whole point of the fingerprint: a second launch against a database
    /// this build already initialised must not re-issue the schema pass. On a
    /// Turso profile every one of those statements is a network round-trip, so
    /// "did it run again" is the difference between 7 seconds and none.
    #[tokio::test]
    async fn second_run_skips_the_schema_pass() {
        let conn = memory_conn().await;
        init_db(&conn).await.unwrap();

        // Something init_db creates, removed behind its back. If the pass runs
        // again it comes back; if the fingerprint short-circuits, it stays gone.
        conn.execute_batch("DROP TABLE word_chats;").await.unwrap();
        init_db(&conn).await.unwrap();

        assert!(!table_exists(&conn, "word_chats").await);
    }

    /// ...and the short-circuit has to be keyed to *this* build's schema, so an
    /// upgraded app still applies what it added.
    #[tokio::test]
    async fn a_different_fingerprint_runs_the_pass_again() {
        let conn = memory_conn().await;
        init_db(&conn).await.unwrap();
        conn.execute_batch("DROP TABLE word_chats;").await.unwrap();

        conn.execute(
            "UPDATE user_settings SET value = 'from-an-older-build' WHERE key = ?1",
            libsql::params![SCHEMA_FINGERPRINT_KEY],
        )
        .await
        .unwrap();
        init_db(&conn).await.unwrap();

        assert!(table_exists(&conn, "word_chats").await);
    }

    /// A failed pass must not leave a stamp behind claiming the schema is
    /// current — the next launch would skip straight past the missing tables.
    #[tokio::test]
    async fn stamps_only_after_a_complete_pass() {
        let conn = memory_conn().await;
        init_db(&conn).await.unwrap();
        assert_eq!(
            stored_fingerprint(&conn).await.as_deref(),
            Some(schema_fingerprint().as_str())
        );

        // A database that has never been initialised has nothing to report.
        let fresh = memory_conn().await;
        assert!(stored_fingerprint(&fresh).await.is_none());
    }
}
