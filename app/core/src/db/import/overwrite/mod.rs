//! Replacing the active database's contents wholesale with another TanWords
//! database file's contents — every table, not just the natural-keyed subset
//! [`super::apply`] merges. Unlike a merge, this is destructive: every row
//! currently in the target is deleted first, then the source's rows are
//! copied in verbatim (original ids and all, since nothing can collide once
//! the target is empty). The source is always a plain local SQLite file
//! (`open_source` guarantees it); the target can be either backend — a local
//! SQLite database or a connected Postgres one. Postgres-specific handling
//! (typed NULLs, `OVERRIDING SYSTEM VALUE` + identity-sequence resync for
//! preserved ids, information_schema introspection instead of
//! `sqlite_master`) lives in `db::pg_copy`, shared with
//! `settings::export_postgres_snapshot`.

use crate::db::Conn;
use std::collections::HashSet;

use super::source::open_source;
use crate::db;
use crate::shim::{AppHandle, State};
use crate::AppState;
mod copy;
use copy::{copy_table, fk_order, list_fts5_tables, list_real_tables};

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverwriteResult {
    pub tables: Vec<String>,
    pub rows_copied: i64,
    /// Rows too large for a single write-delegation message to carry (see
    /// `MAX_SINGLE_ROW_BYTES`) — left out of the copy rather than failing the
    /// whole operation. Always empty now: both live backends (local SQLite,
    /// Postgres) write directly, with no write-delegation message-size limit.
    /// Kept on the response shape rather than removed outright in case a
    /// future backend reintroduces the constraint.
    pub skipped: Vec<String>,
}

/// Emitted on `"overwrite-progress"` as `db_import_overwrite` runs.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OverwriteProgress<'a> {
    phase: &'a str, // "clearing" | "copying" | "indexing"
    table: &'a str,
    table_index: usize,
    table_total: usize,
}

/// A remote (Postgres) target can drop the connection mid-copy on a large
/// import. The whole operation always starts by wiping the target, so it's
/// naturally idempotent: retrying from scratch on a transient failure is
/// safe, unlike retrying a merge import would be.
const MAX_ATTEMPTS: u32 = 3;

#[crate::shim::command]
pub async fn db_import_overwrite(
    app: AppHandle,
    source_path: String,
    password: Option<String>,
    conn: State<'_, AppState>,
) -> Result<OverwriteResult, String> {
    let descriptor = conn.descriptor()?;
    if !descriptor.caps.writable {
        return Err("The current database is read-only and cannot import".into());
    }
    // The 4MiB-ish message-size ceiling (see `MAX_SINGLE_ROW_BYTES`) was a
    // property of write-delegation to a Turso/sqld primary, which is gone.
    // Neither live backend (local SQLite, direct Postgres) has that limit.
    let is_remote = false;
    let temp = super::extract_encrypted_backup_to_temp(
        std::path::Path::new(&source_path),
        password.as_deref(),
    )?;
    let source_path_for_open = temp
        .as_ref()
        .map(|t| t.path().to_string_lossy().into_owned())
        .unwrap_or_else(|| source_path.clone());
    let source = open_source(&source_path_for_open).await?;

    // The source is guaranteed to be a plain local SQLite file (open_source
    // always opens one), so its schema introspection (PRAGMA foreign_key_list,
    // FTS5 detection) is trustworthy regardless of what kind of connection the
    // target turns out to be. The target only ever receives DELETE/INSERT.
    let real_tables = list_real_tables(&source).await?;
    let fts_tables = list_fts5_tables(&source).await?;
    let is_fts_shadow = |name: &str| {
        fts_tables.iter().any(|f| {
            ["_data", "_idx", "_docsize", "_config", "_content"]
                .iter()
                .any(|suffix| name == format!("{f}{suffix}").as_str())
        })
    };
    let copyable: Vec<String> = real_tables
        .into_iter()
        .filter(|t| t != "schema_migrations" && !fts_tables.contains(t) && !is_fts_shadow(t))
        .collect();

    let delete_order = fk_order(&source, &copyable, true).await?;
    let insert_order = fk_order(&source, &copyable, false).await?;

    let mut last_error = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        // A fresh transaction (and, for a remote target, a fresh connection —
        // see `db::txn_conn`) each attempt, since a broken one can't be reused.
        let target = db::txn_conn(&conn).await?;
        let target_tables: HashSet<String> = list_real_tables(&target).await?.into_iter().collect();
        let delete_order: Vec<String> =
            delete_order.iter().filter(|t| target_tables.contains(*t)).cloned().collect();
        let insert_order: Vec<String> =
            insert_order.iter().filter(|t| target_tables.contains(*t)).cloned().collect();

        match run_overwrite(&app, &source, &target, &delete_order, &insert_order, &fts_tables, &target_tables, is_remote).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = e;
                if attempt < MAX_ATTEMPTS {
                    eprintln!(
                        "[import] overwrite attempt {attempt}/{MAX_ATTEMPTS} failed, retrying from scratch: {last_error}"
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
                }
            }
        }
    }
    Err(format!("{last_error} (failed after {MAX_ATTEMPTS} attempts)"))
}

async fn run_overwrite(
    app: &AppHandle,
    source: &Conn,
    target: &Conn,
    delete_order: &[String],
    insert_order: &[String],
    fts_tables: &[String],
    target_tables: &HashSet<String>,
    is_remote: bool,
) -> Result<OverwriteResult, String> {
    let tx = target.transaction().await.map_err(|e| e.to_string())?;

    for (i, table) in delete_order.iter().enumerate() {
        let _ = app.emit(
            "overwrite-progress",
            OverwriteProgress { phase: "clearing", table, table_index: i + 1, table_total: delete_order.len() },
        );
        tx.execute(&format!("DELETE FROM \"{table}\""), ())
            .await
            .map_err(|e| format!("Failed to clear {table}: {e}"))?;
    }
    // Best-effort: restarts autoincrement counters so the freshly copied
    // rows' original ids don't collide with a stale high-water mark. Not
    // every schema has used AUTOINCREMENT anywhere, so a missing
    // sqlite_sequence table is not an error — but only on SQLite: unlike
    // SQLite, a failed statement on Postgres poisons the rest of the
    // transaction (every statement after it errors with "current
    // transaction is aborted" until rollback), so running this
    // unconditionally would silently break every Postgres overwrite. There's
    // no Postgres equivalent needed here — `copy_postgres_table` resyncs
    // each table's identity sequence itself after copying it.
    if target.backend() != sea_orm::DbBackend::Postgres {
        tx.execute("DELETE FROM sqlite_sequence", ()).await.ok();
    }

    let mut rows_copied = 0i64;
    let mut skipped = Vec::new();
    for (i, table) in insert_order.iter().enumerate() {
        let _ = app.emit(
            "overwrite-progress",
            OverwriteProgress { phase: "copying", table, table_index: i + 1, table_total: insert_order.len() },
        );
        rows_copied += copy_table(source, &tx, table, is_remote, &mut skipped).await?;
    }

    for (i, fts) in fts_tables.iter().enumerate() {
        if !target_tables.contains(fts) {
            continue;
        }
        let _ = app.emit(
            "overwrite-progress",
            OverwriteProgress { phase: "indexing", table: fts, table_index: i + 1, table_total: fts_tables.len() },
        );
        tx.execute(&format!("INSERT INTO \"{fts}\"(\"{fts}\") VALUES('rebuild')"), ())
            .await
            .map_err(|e| format!("Failed to rebuild search index {fts}: {e}"))?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(OverwriteResult { tables: insert_order.to_vec(), rows_copied, skipped })
}

#[cfg(test)]
mod postgres_target_tests {
    use crate::db::connection::DbProfile;

    /// Full-overwrite wipes the *entire* target database — this must never
    /// run against the same Postgres a person is actually using, even under
    /// a shared "test" env var other (non-destructive) tests point at real
    /// data. `TANWORDS_PG_OVERWRITE_TEST_URL` is a separate, dedicated
    /// variable specifically so a `TANWORDS_PG_TEST_URL` env value can never
    /// be misread as opting into this. Point it at a disposable database
    /// only (e.g. `createdb tanwords_overwrite_test` in the same instance) —
    /// skipped when unset, same convention as the other Postgres tests.
    #[tokio::test]
    async fn overwrite_import_replaces_a_postgres_target_end_to_end() {
        let Ok(url) = std::env::var("TANWORDS_PG_OVERWRITE_TEST_URL") else {
            eprintln!("skipping: TANWORDS_PG_OVERWRITE_TEST_URL not set");
            return;
        };

        // Source: a small local SQLite file with a word (+ definition + srs
        // record via the normal insert path), a document, and a document
        // asset with real binary data — covers the identity-sequence,
        // typed-NULL, and BLOB edge cases all at once.
        let source_path = std::env::temp_dir()
            .join(format!("tanwords-overwrite-src-{}.db", uuid::Uuid::new_v4()));
        {
            let seed = crate::db::connection::open(
                &DbProfile::Local { path: source_path.to_string_lossy().into_owned() },
                None,
            )
            .await
            .unwrap()
            .conn();
            seed.execute(
                "INSERT INTO words (word, level, word_freq) VALUES ('overwritetestword', 'B1', 1)",
                (),
            )
            .await
            .unwrap();
            let doc_id: i64 = crate::db::fetch_one(
                &seed,
                "INSERT INTO documents (title, protection_salt) VALUES ('overwrite-doc', ?1) RETURNING id",
                crate::db::params![vec![1u8, 2, 3]],
                |r| r.get(0),
            )
            .await
            .unwrap();
            seed.execute(
                "INSERT INTO document_assets (id, document_id, mime_type, data, size) VALUES ('ow-asset', ?1, 'image/png', ?2, 4)",
                crate::db::params![doc_id, vec![0xCAu8, 0xFEu8, 0xBAu8, 0xBEu8]],
            )
            .await
            .unwrap();
        }

        // Target: the dedicated throwaway Postgres, seeded with unrelated
        // data first so the test actually proves "wipe, then replace" —
        // not just "insert into an empty database".
        let database = crate::db::connection::open(&DbProfile::Postgres { url }, None).await.unwrap();
        let pre_existing = database.conn();
        let _ = pre_existing.execute("DELETE FROM words WHERE word = 'pre-existing-should-be-wiped'", ()).await;
        pre_existing
            .execute("INSERT INTO words (word, level, word_freq) VALUES ('pre-existing-should-be-wiped', 'A1', 1)", ())
            .await
            .unwrap();

        let (registry, app) = crate::build_state_for(database, None).await;
        let ctx = crate::rpc::Ctx::new(registry, app);

        let result = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_import_overwrite",
            crate::rpc::Args::new(serde_json::json!({
                "sourcePath": source_path.to_string_lossy(),
                "password": null,
            })),
        )
        .await
        .expect("overwrite-import should succeed against a Postgres target");
        assert!(
            result["rowsCopied"].as_i64().unwrap_or(0) > 0,
            "expected rows to be copied, got {result}"
        );

        let target = pre_existing;
        let wiped = crate::db::scalar_i64(&target, "SELECT COUNT(*) FROM words WHERE word = 'pre-existing-should-be-wiped'", ())
            .await
            .unwrap();
        assert_eq!(wiped, 0, "pre-existing target data must be wiped, not merged");

        let word: String = crate::db::fetch_one(&target, "SELECT word FROM words WHERE word = 'overwritetestword'", (), |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(word, "overwritetestword");

        let salt: Vec<u8> = crate::db::fetch_one(&target, "SELECT protection_salt FROM documents WHERE title = 'overwrite-doc'", (), |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(salt, vec![1, 2, 3]);

        let asset_data: Vec<u8> = crate::db::fetch_one(&target, "SELECT data FROM document_assets WHERE id = 'ow-asset'", (), |r| r.get(0))
            .await
            .unwrap();
        assert_eq!(asset_data, vec![0xCA, 0xFE, 0xBA, 0xBE]);

        // The identity sequence must have advanced past the copied rows —
        // this is exactly the bug that broke the very next ordinary insert
        // before `resync_postgres_identity_sequence` was wired in here.
        target
            .execute("INSERT INTO words (word, level, word_freq) VALUES ('overwrite-sequence-check', 'A1', 1)", ())
            .await
            .expect("an ordinary insert after overwrite-import must not collide with a copied id");

        let _ = std::fs::remove_file(&source_path);
    }
}
