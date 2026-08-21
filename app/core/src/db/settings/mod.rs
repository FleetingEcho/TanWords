use crate::db::params; use crate::db::Conn; use crate::db::DbResult;
use crate::shim::State;

use sea_orm::ConnectionTrait;

use crate::db;
use crate::db::connection::{DbDescriptor, DbKind};
use crate::AppState;

// External-database connection management and Postgres snapshot export —
// split out for size. A *private* submodule re-exported here so the public
// surface (`db::settings::…`) and the build-script dispatch path (which
// collapses this private `mod` back to `db::settings`) are unchanged.
mod connection;
pub use connection::*;

fn database_disk_size(path: &str) -> std::result::Result<u64, String> {
    [
        path.to_string(),
        format!("{path}-wal"),
        format!("{path}-shm"),
    ]
    .iter()
    .try_fold(0_u64, |total, candidate| {
        match std::fs::metadata(candidate) {
            Ok(metadata) => Ok(total + metadata.len()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(total),
            Err(error) => Err(error.to_string()),
        }
    })
}

async fn export_backup(conn: &Conn, dest: &str) -> std::result::Result<(), String> {
    conn.execute("VACUUM INTO ?1", params![dest])
        .await
        .map_err(|e| e.to_string())?;

    // `VACUUM INTO` always writes its target in rollback-journal mode, no
    // matter what journal mode the source connection is using — the WAL
    // setting is a page-cache/connection concept SQLite doesn't carry into a
    // freshly rebuilt file. `turso db import` rejects anything that isn't
    // WAL, so a backup handed to it as-is fails (surfaced there as a
    // confusing "group not found" rather than anything about journal mode).
    // Reopen the file we just wrote purely to flip that one pragma.
    let mut opts = sea_orm::ConnectOptions::new(format!("sqlite://{dest}?mode=rw"));
    opts.max_connections(1);
    let backup = sea_orm::Database::connect(opts)
        .await
        .map_err(|e| e.to_string())?;
    backup
        .execute_unprepared("PRAGMA journal_mode=WAL;")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn clear_translations(conn: &Conn) -> std::result::Result<(), String> {
    conn.execute("DELETE FROM translations", ())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn get_setting(conn: &Conn, key: &str) -> DbResult<Option<String>> {
    let mut rows = conn
        .query_all("SELECT value FROM user_settings WHERE key = ?1", params![key])
        .await?;
    match rows.pop() {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub async fn set_setting(conn: &Conn, key: &str, value: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO user_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        params![key, value],
    )
    .await?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_get_word_count(conn: State<'_, AppState>) -> std::result::Result<i64, String> {
    let db = db::conn(&conn)?;
    db::scalar_i64(&db, "SELECT COUNT(*) FROM words", ()).await
}

#[crate::shim::command]
pub async fn db_get_translation_count(
    conn: State<'_, AppState>,
) -> std::result::Result<i64, String> {
    let db = db::conn(&conn)?;
    db::scalar_i64(&db, "SELECT COUNT(*) FROM translations", ()).await
}

// db_get_review_count moved to srs.rs (needs FSRS-consistent date comparison).

#[crate::shim::command]
pub async fn db_get_setting(
    key: String,
    conn: State<'_, AppState>,
) -> std::result::Result<Option<String>, String> {
    let db = db::conn(&conn)?;
    get_setting(&db, &key).await.map_err(|e| e.to_string())
}

#[crate::shim::command]
pub async fn db_set_setting(
    key: String,
    value: String,
    conn: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db = db::conn(&conn)?;
    set_setting(&db, &key, &value).await.map_err(|e| e.to_string())
}

#[crate::shim::command]
pub fn db_get_db_path(state: State<'_, AppState>) -> std::result::Result<String, String> {
    state.db_path()
}

/// Where a local database would live — independent of whatever's actually
/// active right now. `db_get_db_path` reflects the live connection (empty
/// for Postgres, which has no local file); the Local tab in Settings wants
/// this one instead, so it can show a real path even while a remote profile
/// is connected, rather than either the remote's URL or nothing.
#[crate::shim::command]
pub fn db_get_default_local_path() -> String {
    crate::default_db_path()
}

/// Size of the active database:
///  * **Local** — bytes on disk (the SQLite file plus its `-wal`/`-shm`
///    sidecars, summed).
///  * **Postgres** — the server-reported `pg_database_size(current_database())`,
///    since a Postgres profile has no local file to stat. Requires CONNECT
///    on the current database, which the live connection already holds.
///
/// Errors propagate (rather than degrading to `0`) so the frontend can hide
/// the size badge instead of showing a misleading "0 B" when the measurement
/// isn't available.
#[crate::shim::command]
pub async fn db_get_db_size(state: State<'_, AppState>) -> std::result::Result<u64, String> {
    if state.descriptor()?.kind == DbKind::Postgres {
        let db = db::conn(&state)?;
        let size = db::scalar_i64(&db, "SELECT pg_database_size(current_database())", ())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(size.max(0) as u64);
    }
    database_disk_size(&state.db_path()?)
}

/// The active connection profile, including what it supports — the frontend
/// hides export/switch actions that can't work rather than failing on click.
#[crate::shim::command]
pub fn db_get_connection(state: State<'_, AppState>) -> std::result::Result<DbDescriptor, String> {
    state.descriptor()
}

/// Returns (and consumes-by-value, since it's a plain startup snapshot) the
/// profile that failed to open this launch, if that happened — `None`
/// otherwise. The frontend calls this once at startup to show a warning
/// instead of the app silently falling back to an empty default database
/// with no explanation.
#[crate::shim::command]
pub fn db_get_startup_warning(state: State<'_, AppState>) -> Option<String> {
    state.db_fallback_warning.clone()
}

/// Writes a consistent snapshot of the database to `dest` via VACUUM INTO,
/// safe to run even with WAL journal entries not yet checkpointed.
#[crate::shim::command]
pub async fn db_export_backup(
    dest: String,
    password: Option<String>,
    conn: State<'_, AppState>,
) -> std::result::Result<(), String> {
    if !conn.descriptor()?.caps.export {
        return Err("Online databases do not support exporting backups".into());
    }
    let db = db::conn(&conn)?;
    match password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(password) => {
            let temp_snapshot = std::env::temp_dir().join(format!(
                "tanwords-export-{}.db",
                uuid::Uuid::new_v4()
            ));
            let result = async {
                export_backup(&db, &temp_snapshot.to_string_lossy()).await?;
                crate::db::import::create_encrypted_backup(
                    std::path::Path::new(&temp_snapshot),
                    std::path::Path::new(&dest),
                    password,
                )
            }
            .await;
            let _ = std::fs::remove_file(&temp_snapshot);
            result
        }
        None => export_backup(&db, &dest).await,
    }
}

#[crate::shim::command]
pub async fn db_clear_translations(conn: State<'_, AppState>) -> std::result::Result<(), String> {
    let db = db::conn(&conn)?;
    clear_translations(&db).await
}

/// Reclaims space left by deleted/updated rows. SQLite never shrinks a file on
/// its own (no `auto_vacuum` is configured — `FULL` would add per-write
/// overhead this workload doesn't want), so without this the file only grows,
/// even when the amount of live data doesn't. Must run outside any
/// transaction, which the shared connection already is.
#[crate::shim::command]
pub async fn db_vacuum(conn: State<'_, AppState>) -> std::result::Result<(), String> {
    let descriptor = conn.descriptor()?;
    if !descriptor.caps.vacuum {
        // Not a temporary condition (unlike `!writable`, which can clear up on
        // reconnect) — Postgres has no VACUUM INTO / file-level compaction the
        // way SQLite does, so retrying is never going to help. See
        // `DbCaps::vacuum`'s doc comment.
        return Err("Compacting isn't supported for a remote database".into());
    }
    let db = db::conn(&conn)?;
    db.execute("VACUUM", ()).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::DbProfile;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("tanwords-{name}-{}.db", uuid::Uuid::new_v4()))
    }

    async fn open_local(path: &std::path::Path) -> Conn {
        let profile = DbProfile::Local { path: path.to_string_lossy().into_owned() };
        db::connection::open(&profile, None).await.unwrap().conn()
    }

    fn test_app_handle() -> crate::shim::AppHandle {
        let (events, _rx) = tokio::sync::broadcast::channel(16);
        crate::shim::AppHandle::new(std::sync::Arc::new(crate::shim::Registry::default()), events)
    }

    #[test]
    fn database_size_includes_db_wal_and_shm_files() {
        let path = temp_path("size");
        std::fs::write(&path, vec![0; 11]).unwrap();
        std::fs::write(format!("{}-wal", path.display()), vec![0; 7]).unwrap();
        std::fs::write(format!("{}-shm", path.display()), vec![0; 5]).unwrap();
        assert_eq!(database_disk_size(path.to_str().unwrap()).unwrap(), 23);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[tokio::test]
    async fn database_can_be_created_reopened_backed_up_and_cleared() {
        let source = temp_path("source");
        let backup = temp_path("backup");
        {
            let conn = open_local(&source).await;
            conn.execute(
                "INSERT INTO translations (source_text, result_text, source_lang, target_lang, provider, mode) VALUES ('hello', '你好', 'en', 'zh', 'test', 'translate')",
                (),
            ).await.unwrap();
            export_backup(&conn, backup.to_str().unwrap()).await.unwrap();
            clear_translations(&conn).await.unwrap();
            let count = db::scalar_i64(&conn, "SELECT COUNT(*) FROM translations", ())
                .await
                .unwrap();
            assert_eq!(count, 0);
        }
        let reopened = open_local(&source).await;
        let backup_conn = open_local(&backup).await;
        let source_count = db::scalar_i64(&reopened, "SELECT COUNT(*) FROM translations", ())
            .await
            .unwrap();
        let backup_count = db::scalar_i64(&backup_conn, "SELECT COUNT(*) FROM translations", ())
            .await
            .unwrap();
        assert_eq!(source_count, 0);
        assert_eq!(backup_count, 1);
        drop(reopened);
        drop(backup_conn);
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(backup);
    }

    /// Requires a live Postgres reachable at `TANWORDS_PG_TEST_URL` — skipped
    /// otherwise, same convention as `seaorm_backend_parity.rs`.
    ///
    /// Regression: a Postgres profile has no local file, so the old
    /// disk-measuring implementation summed three missing paths and reported
    /// 0 — Settings then showed a meaningless "0 B". The size must come from
    /// the server instead (any real Postgres database measures > 0).
    #[tokio::test]
    async fn postgres_db_size_comes_from_the_server() {
        let Ok(url) = std::env::var("TANWORDS_PG_TEST_URL") else {
            eprintln!("skipping: TANWORDS_PG_TEST_URL not set");
            return;
        };
        let db = db::connection::open(&DbProfile::Postgres { url }, None)
            .await
            .unwrap();
        let app_state = AppState {
            db: std::sync::Mutex::new(db),
            #[cfg(feature = "tts")]
            tts: std::sync::Mutex::new(None).into(),
            #[cfg(feature = "asr")]
            asr: std::sync::Mutex::new(None).into(),
            db_fallback_warning: None,
            document_privacy: Default::default(),
        };
        let state = crate::shim::State::from_ref(Box::leak(Box::new(app_state)));
        let size = db_get_db_size(state).await.unwrap();
        assert!(size > 0, "Postgres size must be measured server-side, got {size}");
    }

    /// Requires a live Postgres reachable at `TANWORDS_PG_TEST_URL` — skipped
    /// otherwise, same convention as `seaorm_backend_parity.rs`.
    #[tokio::test]
    async fn postgres_snapshot_round_trips_scalars_and_blobs() {
        let Ok(url) = std::env::var("TANWORDS_PG_TEST_URL") else {
            eprintln!("skipping: TANWORDS_PG_TEST_URL not set");
            return;
        };
        let source = db::connection::open(&DbProfile::Postgres { url }, None)
            .await
            .unwrap()
            .conn();

        let word_id = source
            .insert_returning_id(
                "INSERT INTO words (word, level) VALUES ('snapshot-test-word', 'B1') RETURNING id",
                (),
            )
            .await
            .unwrap();
        let doc_id = source
            .insert_returning_id(
                "INSERT INTO documents (title, protection_salt, wrapped_key) VALUES ('doc', ?1, ?2) RETURNING id",
                params![vec![1u8, 2, 3, 4], vec![9u8, 8, 7]],
            )
            .await
            .unwrap();
        source
            .execute(
                "INSERT INTO document_assets (id, document_id, mime_type, data, size) VALUES ('asset-1', ?1, 'image/png', ?2, 4)",
                params![doc_id, vec![0xDEu8, 0xAD, 0xBE, 0xEF]],
            )
            .await
            .unwrap();

        let backup = temp_path("pg-snapshot");
        export_postgres_snapshot(&test_app_handle(), &source, backup.to_str().unwrap())
            .await
            .unwrap();

        let dest = open_local(&backup).await;
        let word: String = db::fetch_one(&dest, "SELECT word FROM words WHERE id = ?1", params![word_id], |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(word, "snapshot-test-word");

        let salt: Vec<u8> = db::fetch_one(&dest, "SELECT protection_salt FROM documents WHERE id = ?1", params![doc_id], |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(salt, vec![1, 2, 3, 4]);

        let asset_data: Vec<u8> = db::fetch_one(&dest, "SELECT data FROM document_assets WHERE id = 'asset-1'", (), |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(asset_data, vec![0xDE, 0xAD, 0xBE, 0xEF]);

        // Cleanup: the default seed rows (default calendars, settings) must
        // survive the clear-then-copy untouched too, not just the rows we
        // inserted — the destination's own INSERT OR IGNORE ones may already
        // exist on the Postgres side if this test has run before.
        drop(dest);
        let _ = std::fs::remove_file(&backup);
        source
            .execute("DELETE FROM document_assets WHERE id = 'asset-1'", ())
            .await
            .unwrap();
        source.execute("DELETE FROM documents WHERE id = ?1", params![doc_id]).await.unwrap();
        source.execute("DELETE FROM words WHERE id = ?1", params![word_id]).await.unwrap();
    }
}
