use sea_orm::DbErr;

use crate::shim::State;
use std::future::Future;
use std::time::Duration;

use crate::AppState;

// `Conn` is brought into scope by the `pub use rows::{Conn, …}` re-export below;
// a separate `use` here would collide with it (E0252).

// ── Helper ──────────────────────────────────────────────────────────────────

/// The active DB connection, cloned out from under the state mutex.
///
/// Returns an owned `Conn` rather than a guard on purpose: commands `.await`
/// on it, and holding a lock across a suspend point is both a deadlock risk
/// and (for `std::sync::MutexGuard`) not `Send`. The `Conn` wraps an
/// `Arc<Pool>`, so cloning is cheap and every clone talks to the same database.
pub fn conn(state: &State<'_, AppState>) -> Result<Conn, String> {
    Ok(state.db.lock().map_err(|e| e.to_string())?.conn())
}

/// A Postgres profile forwards writes over a connection that can go
/// half-open. Bound it so a
/// stuck write surfaces as an error instead of leaving editor autosave on
/// "Saving" forever. Local SQLite has no network hop and stays unbounded.
const REMOTE_WRITE_TIMEOUT: Duration = Duration::from_secs(10);

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
        .map_err(|_| format!("Remote database write timed out after {timeout:?}"))?
}

/// Await a write using the active profile's policy. Local SQLite remains
/// unbounded because it has no network hop; Postgres gets the deadline.
pub async fn await_write<T>(
    state: &State<'_, AppState>,
    future: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let kind = state.db.lock().map_err(|e| e.to_string())?.kind();
    await_write_for_kind(kind, REMOTE_WRITE_TIMEOUT, future).await
}

/// A connection for commands that open an interactive transaction.
///
/// Under SeaORM the pool already hands each `begin()` its own dedicated
/// connection, so a transaction no longer needs a separately-opened handle the
/// way the libsql embedded-replica Hrana stream did. This returns a plain clone
/// of the pool — `Conn::transaction()` then takes a connection from it for the
/// transaction. `:memory:` databases are opened with a single-connection pool
/// (see `connection::open`), so this clone is the same in-memory DB.
pub async fn txn_conn(state: &State<'_, AppState>) -> Result<Conn, String> {
    Ok(state.db.lock().map_err(|e| e.to_string())?.conn())
}

// ── Sub-modules ────────────────────────────────────────────────────────────

pub mod connection;
pub mod import;
pub(crate) mod pg_copy;
pub mod rows;
pub use connection::{DbCaps, DbDescriptor, DbKind, DbProfile};
pub use import::*;
// `params` is a crate-private `macro_rules!`, so it can only be re-exported
// `params!` is crate-internal in practice (the web server goes through
// `tanwords_lib`'s command functions); the backend-parity integration test
// builds `Vec<Value>` directly instead.
pub use rows::{Conn, DbResult, Row, Value, fetch_all, fetch_one, fetch_optional, scalar_i64};
pub(crate) use rows::params;

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
pub mod srs;
pub mod search_history;
pub mod scene_lab;
pub mod sentences;
pub mod ai_providers;
pub mod calendar;

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
pub use sentences::*;
pub use calendar::*;

#[cfg(test)]
mod write_timeout_tests {
    use super::{await_write_for_kind, connection::DbKind};
    use std::time::Duration;

    #[tokio::test]
    async fn stalled_remote_write_returns_an_error() {
        let error = await_write_for_kind(
            DbKind::Postgres,
            Duration::from_millis(20),
            std::future::pending::<Result<(), String>>(),
        )
        .await
        .expect_err("a stalled remote write must time out");

        assert_eq!(error, "Remote database write timed out after 20ms");
    }

    #[tokio::test]
    async fn completed_local_write_passes_through() {
        let value = await_write_for_kind(DbKind::Local, Duration::ZERO, async { Ok(42) })
            .await
            .expect("local writes should not use the remote deadline");

        assert_eq!(value, 42);
    }
}

// ── Database Initialization ─────────────────────────────────────────────────

/// Where `init_db` records the schema state it last brought this database to.
/// In `user_settings` rather than its own table so the check below costs one
/// query on a database that already has the schema, instead of a CREATE first.
const SCHEMA_FINGERPRINT_KEY: &str = "__schema_fingerprint";

/// Identifies "the schema `init_db` produces, as this build writes it". Hashed
/// from the schema source rather than a hand-maintained revision number, so the
/// fast path below can skip the idempotent pass entirely without risking a
/// statement added later silently never reaching databases that already exist.
/// The hash includes the backend's own schema file, so a Postgres DDL change
/// re-runs the Postgres pass exactly when it should.
fn schema_fingerprint(kind: connection::DbKind) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    match kind {
        connection::DbKind::Local => {
            hasher.update(include_str!("../../sql/schema.sql"));
        }
        connection::DbKind::Postgres => {
            hasher.update(include_str!("../../sql/schema_postgres.sql"));
        }
    }
    hasher.update(include_str!("mod.rs"));
    format!("{:x}", hasher.finalize())
}

/// The fingerprint this database was last initialised to, if any. A fresh
/// database has no `user_settings` table yet and the query fails — which is
/// the same answer as a stale one: run everything.
async fn stored_fingerprint(conn: &Conn) -> Option<String> {
    conn.query_one(
        "SELECT value FROM user_settings WHERE key = ?1",
        params![SCHEMA_FINGERPRINT_KEY],
    )
    .await
    .ok()
    .flatten()
    .and_then(|row| row.get::<String>(0).ok())
}

/// Brings the schema up to date for whichever backend `conn` points at. Both
/// paths are idempotent and fingerprint-gated so a repeat open skips the pass
/// entirely. The Postgres path runs one clean current-schema DDL — the
/// SQLite-era migration history is not replayed against a fresh Postgres
/// database.
pub async fn init_db(conn: &Conn) -> Result<(), DbErr> {
    match conn.kind() {
        connection::DbKind::Local => init_db_sqlite(conn).await,
        connection::DbKind::Postgres => init_db_postgres(conn).await,
    }
}

/// SQLite schema initialization — one clean current-schema DDL from schema.sql.
/// Idempotent and fingerprint-gated. No incremental migration history: old
/// databases are not supported (breaking change).
async fn init_db_sqlite(conn: &Conn) -> Result<(), DbErr> {
    let fingerprint = schema_fingerprint(connection::DbKind::Local);
    if stored_fingerprint(conn).await.as_deref() == Some(fingerprint.as_str()) {
        return Ok(());
    }

    conn.execute_batch(include_str!("../../sql/schema.sql")).await?;

    // Seed default calendars.
    let default_calendars = vec![
        ("default", "Personal", "blue", 0),
        ("work", "Work", "green", 1),
    ];
    for (id, name, color_name, sort_order) in default_calendars {
        conn.execute(
            "INSERT OR IGNORE INTO calendar_calendars (id, name, color_name, sort_order)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, name, color_name, sort_order],
        )
        .await?;
    }

    // Insert default settings.
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
            params![key, value],
        )
        .await?;
    }

    // One-time: adopt a desktop R2 configuration that predates the per-database
    // table, so upgrading does not look like the bucket disconnected itself.
    crate::r2::migrate_from_app_config(conn).await;

    // Stamp the fingerprint — only on the path where everything above ran.
    conn.execute(
        "INSERT INTO user_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SCHEMA_FINGERPRINT_KEY, fingerprint],
    )
    .await?;

    Ok(())
}

/// Postgres schema initialization. One clean current-schema DDL — the
/// SQLite-era migration history is not replayed against a fresh Postgres
/// database. Fingerprint-gated the same way as the SQLite path so a repeat
/// open skips the pass. See `sql/schema_postgres.sql` for the DDL and the
/// backend-specific full-text search (tsvector + GIN + triggers, mirroring the
/// FTS5 design the SQLite path uses).
async fn init_db_postgres(conn: &Conn) -> Result<(), DbErr> {
    let fingerprint = schema_fingerprint(connection::DbKind::Postgres);
    if stored_fingerprint(conn).await.as_deref() == Some(fingerprint.as_str()) {
        return Ok(());
    }

    conn.execute_batch(include_str!("../../sql/schema_postgres.sql"))
        .await?;

    // Seed the same default calendars / settings the SQLite path does, using
    // portable SQL (ON CONFLICT DO NOTHING; CURRENT_TIMESTAMP). These run on
    // every fresh Postgres database; the fingerprint skips them next time.
    let default_calendars = vec![
        ("default", "Personal", "blue", 0),
        ("work", "Work", "green", 1),
    ];
    for (id, name, color_name, sort_order) in default_calendars {
        conn.execute(
            "INSERT INTO calendar_calendars (id, name, color_name, sort_order)
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING",
            params![id, name, color_name, sort_order],
        )
        .await?;
    }

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
            "INSERT INTO user_settings (key, value) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
            params![key, value],
        )
        .await?;
    }

    conn.execute(
        "INSERT INTO user_settings (key, value) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
        params![SCHEMA_FINGERPRINT_KEY, fingerprint],
    )
    .await?;

    Ok(())
}

#[cfg(test)]
mod init_db_tests {
    use super::*;

    async fn memory_conn() -> Conn {
        // Blank in-memory DB, no `init_db` pass — the tests call `init_db`
        // themselves (some assert on the *absence* of a fingerprint before
        // init). Going through `open_memory()` would pre-stamp the schema.
        use sea_orm::ConnectionTrait;
        let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1).min_connections(1);
        let db = sea_orm::Database::connect(opts).await.unwrap();
        let _ = db.execute_unprepared("PRAGMA foreign_keys=ON;").await;
        Conn::new_db(db, connection::DbKind::Local, None)
    }

    async fn table_exists(conn: &Conn, name: &str) -> bool {
        conn.query_one(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
            params![name],
        )
        .await
        .unwrap()
        .is_some()
    }

    /// The whole point of the fingerprint: a second launch against a database
    /// this build already initialised must not re-issue the schema pass.
    #[tokio::test]
    async fn second_run_skips_the_schema_pass() {
        let conn = memory_conn().await;
        init_db(&conn).await.unwrap();

        conn.execute_batch("DROP TABLE word_chats;").await.unwrap();
        init_db(&conn).await.unwrap();

        assert!(!table_exists(&conn, "word_chats").await);
    }

    #[tokio::test]
    async fn a_different_fingerprint_runs_the_pass_again() {
        let conn = memory_conn().await;
        init_db(&conn).await.unwrap();
        conn.execute_batch("DROP TABLE word_chats;").await.unwrap();

        conn.execute(
            "UPDATE user_settings SET value = 'from-an-older-build' WHERE key = ?1",
            params![SCHEMA_FINGERPRINT_KEY],
        )
        .await
        .unwrap();
        init_db(&conn).await.unwrap();

        assert!(table_exists(&conn, "word_chats").await);
    }

    #[tokio::test]
    async fn stamps_only_after_a_complete_pass() {
        let conn = memory_conn().await;
        init_db(&conn).await.unwrap();
        assert_eq!(
            stored_fingerprint(&conn).await.as_deref(),
            Some(schema_fingerprint(connection::DbKind::Local).as_str())
        );

        let fresh = memory_conn().await;
        assert!(stored_fingerprint(&fresh).await.is_none());
    }
}
