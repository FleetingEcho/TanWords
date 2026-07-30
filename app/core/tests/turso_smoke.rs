//! End-to-end check against a real Turso database, including the part no local
//! test can cover: a second, independent replica seeing the first one's writes.
//!
//! Skipped unless both variables are set (they live in app/.env, gitignored):
//!   TURSO_DB_URL=libsql://… TURSO_DB_TOKEN=… cargo test --test turso_smoke -- --nocapture
//!
//! Writes to the database it is pointed at: it creates the app schema (the same
//! thing connecting from Settings does) and one vocabulary row that it deletes
//! again before finishing.

use tanwords_lib::db::{connection, DbKind, DbProfile};

fn credentials() -> Option<(String, String)> {
    let url = std::env::var("TURSO_DB_URL").ok()?;
    let token = std::env::var("TURSO_DB_TOKEN").ok()?;
    if url.trim().is_empty() || token.trim().is_empty() {
        return None;
    }
    Some((url, token))
}

fn replica_path(tag: &str) -> String {
    std::env::temp_dir()
        .join(format!("tanwords-turso-test-{tag}-{}.db", std::process::id()))
        .to_string_lossy()
        .into_owned()
}

fn cleanup(path: &str) {
    for suffix in ["", "-wal", "-shm", "-client_wal_index", "-info"] {
        let _ = std::fs::remove_file(format!("{path}{suffix}"));
    }
}

// Multi-threaded on purpose: libsql's replica path uses `block_in_place`
// internally, which panics on a current-thread runtime. Tauri's async runtime
// is multi-threaded, so this matches production.
#[tokio::test(flavor = "multi_thread")]
async fn turso_replica_round_trips_through_the_primary() {
    let Some((url, token)) = credentials() else {
        eprintln!("TURSO_DB_URL / TURSO_DB_TOKEN not set — skipping");
        return;
    };

    let path_a = replica_path("a");
    let path_b = replica_path("b");
    cleanup(&path_a);
    cleanup(&path_b);

    // ── First device: connect, which also applies the schema to the primary.
    let device_a = connection::open(
        &DbProfile::Turso { path: path_a.clone(), url: url.clone() },
        Some(&token),
    )
    .await
    .expect("connecting to Turso should succeed");

    let descriptor = device_a.descriptor();
    assert_eq!(descriptor.kind, DbKind::Turso);
    assert_eq!(descriptor.remote_url.as_deref(), Some(url.as_str()));
    assert!(!descriptor.caps.export, "a replica must not offer backup export");
    assert!(!descriptor.caps.switch_path);
    assert!(descriptor.caps.sync);
    println!("PASS  connect + schema applied to the primary");

    let conn_a = device_a.conn();
    let marker = format!("turso-smoke-{}", std::process::id());

    // Clean any leftover from an interrupted earlier run.
    conn_a
        .execute("DELETE FROM words WHERE word = ?1", [marker.clone()])
        .await
        .expect("delete");

    // ── A write goes to the primary, not just the local file.
    conn_a
        .execute(
            "INSERT INTO words (word, word_type, level, word_freq, source) VALUES (?1, 'n', 'C1', 1, 'test')",
            [marker.clone()],
        )
        .await
        .expect("insert through the replica");
    let seen_locally = tanwords_lib::db::scalar_i64(
        &conn_a,
        "SELECT COUNT(*) FROM words WHERE word = ?1",
        [marker.clone()],
    )
    .await
    .expect("read back");
    assert_eq!(seen_locally, 1);
    println!("PASS  write visible on the writing replica");

    // ── FTS5 through a replica: the index the reading library depends on.
    let fts_ok = conn_a
        .query(
            "SELECT COUNT(*) FROM reading_articles_fts WHERE reading_articles_fts MATCH ?1",
            ["\"the\"*"],
        )
        .await;
    assert!(fts_ok.is_ok(), "FTS5 MATCH must work on a replica: {fts_ok:?}");
    println!("PASS  FTS5 MATCH on a replica");

    // ── Transactions through a replica.
    let tx = conn_a.transaction().await.expect("begin");
    tx.execute("UPDATE words SET word_freq = 2 WHERE word = ?1", [marker.clone()])
        .await
        .expect("update in tx");
    tx.commit().await.expect("commit");
    println!("PASS  transaction commit on a replica");

    // ── Second device: a *separate* replica file, same primary. This is the
    //    multi-device claim — it must see device A's row after syncing.
    //
    //    Device A is dropped first: two devices means two processes on two
    //    machines, never two live replicas of one primary inside one process.
    //    (Keeping both alive here reliably corrupts A's local file — see the
    //    ignored test below.)
    drop(conn_a);
    drop(device_a);
    let device_b = connection::open(
        &DbProfile::Turso { path: path_b.clone(), url: url.clone() },
        Some(&token),
    )
    .await
    .expect("second replica should connect");
    if let Some(handle) = device_b.sync_handle() {
        handle.sync().await.expect("explicit sync");
    }
    let conn_b = device_b.conn();
    let seen_remotely = tanwords_lib::db::scalar_i64(
        &conn_b,
        "SELECT COUNT(*) FROM words WHERE word = ?1",
        [marker.clone()],
    )
    .await
    .expect("read from the second replica");
    assert_eq!(
        seen_remotely, 1,
        "a second replica must see the first one's write after syncing"
    );
    println!("PASS  second replica sees the write (multi-device sync)");

    // ── Delete on B, then reconnect as A and confirm it propagated back.
    conn_b
        .execute("DELETE FROM words WHERE word = ?1", [marker.clone()])
        .await
        .expect("cleanup delete");
    drop(conn_b);
    drop(device_b);

    let device_a2 = connection::open(
        &DbProfile::Turso { path: path_a.clone(), url },
        Some(&token),
    )
    .await
    .expect("device A should reconnect");
    if let Some(handle) = device_a2.sync_handle() {
        handle.sync().await.expect("sync back");
    }
    let after_delete = tanwords_lib::db::scalar_i64(
        &device_a2.conn(),
        "SELECT COUNT(*) FROM words WHERE word = ?1",
        [marker],
    )
    .await
    .expect("read after delete");
    assert_eq!(after_delete, 0, "the delete should propagate back to device A");
    println!("PASS  delete propagates back to the first replica");

    drop(device_a2);
    cleanup(&path_a);
    cleanup(&path_b);
}

/// Documents a libsql limitation rather than app behaviour: two live embedded
/// replicas of the *same* primary inside one process reliably leave the first
/// one's local file reporting `database disk image is malformed` after it syncs
/// past the second one's writes. A reconnect clears it — the remote data is
/// never affected.
///
/// The app can't hit this (one process holds exactly one `Db` at a time, and
/// `db_connect_turso` replaces it rather than adding a second), so this is
/// ignored by default. Un-ignore it to re-check after a libsql upgrade:
///   cargo test --test turso_smoke -- --ignored --nocapture
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn two_live_replicas_in_one_process_corrupt_the_local_file() {
    let Some((url, token)) = credentials() else {
        eprintln!("TURSO_DB_URL / TURSO_DB_TOKEN not set — skipping");
        return;
    };
    let path_a = replica_path("dup-a");
    let path_b = replica_path("dup-b");
    cleanup(&path_a);
    cleanup(&path_b);

    let a = connection::open(&DbProfile::Turso { path: path_a.clone(), url: url.clone() }, Some(&token))
        .await
        .expect("open A");
    let b = connection::open(&DbProfile::Turso { path: path_b.clone(), url: url.clone() }, Some(&token))
        .await
        .expect("open B");
    let (ca, cb) = (a.conn(), b.conn());
    let marker = format!("turso-dup-{}", std::process::id());

    ca.execute(
        "INSERT INTO words (word, word_freq, source) VALUES (?1, 1, 'test')",
        [marker.clone()],
    )
    .await
    .expect("A insert");
    if let Some(h) = b.sync_handle() {
        h.sync().await.expect("B sync");
    }
    cb.execute("DELETE FROM words WHERE word = ?1", [marker.clone()])
        .await
        .expect("B delete");
    if let Some(h) = a.sync_handle() {
        h.sync().await.expect("A sync");
    }

    let read = tanwords_lib::db::scalar_i64(&ca, "SELECT COUNT(*) FROM words WHERE word = ?1", [marker]).await;
    println!("read on A after cross-replica sync: {read:?}");

    drop(ca);
    drop(cb);
    drop(a);
    drop(b);
    cleanup(&path_a);
    cleanup(&path_b);
}

/// A replica that already holds the data must keep serving it when the primary
/// is unreachable — the alternative is dropping the user onto the (different,
/// probably empty) default local database, which reads as data loss.
#[tokio::test(flavor = "multi_thread")]
async fn unreachable_primary_keeps_serving_an_existing_replica() {
    let Some((url, token)) = credentials() else {
        eprintln!("TURSO_DB_URL / TURSO_DB_TOKEN not set — skipping");
        return;
    };
    let path = replica_path("offline");
    cleanup(&path);

    // Populate a replica while the primary is reachable.
    let online = connection::open(
        &DbProfile::Turso { path: path.clone(), url, },
        Some(&token),
    )
    .await
    .expect("initial online connect");
    let baseline = tanwords_lib::db::scalar_i64(&online.conn(), "SELECT COUNT(*) FROM words", ())
        .await
        .expect("baseline read");
    drop(online);

    // Same replica file, but the primary can't be reached.
    let offline = connection::open(
        &DbProfile::Turso {
            path: path.clone(),
            url: "libsql://tanwords-unreachable.invalid".into(),
        },
        Some(&token),
    )
    .await
    .expect("an existing replica must still open when the primary is unreachable");
    let offline_count =
        tanwords_lib::db::scalar_i64(&offline.conn(), "SELECT COUNT(*) FROM words", ())
            .await
            .expect("reads must still work offline");
    assert_eq!(offline_count, baseline, "offline reads should serve the local replica");
    println!("PASS  offline start serves the existing replica ({offline_count} words)");

    drop(offline);
    cleanup(&path);
}

/// The opposite case: with no local copy yet, a failed first sync must be a
/// hard error rather than an empty database masquerading as the user's data.
#[tokio::test(flavor = "multi_thread")]
async fn unreachable_primary_with_no_replica_is_an_error() {
    let Some((_url, token)) = credentials() else {
        eprintln!("TURSO_DB_URL / TURSO_DB_TOKEN not set — skipping");
        return;
    };
    let path = replica_path("offline-fresh");
    cleanup(&path);

    let result = connection::open(
        &DbProfile::Turso {
            path: path.clone(),
            url: "libsql://tanwords-unreachable.invalid".into(),
        },
        Some(&token),
    )
    .await;
    assert!(result.is_err(), "a first connect with no local copy must fail loudly");
    println!("PASS  first connect to an unreachable primary fails loudly");

    cleanup(&path);
}

/// Disconnecting must carry the data over. The mechanism is a `VACUUM INTO`
/// snapshot of the replica; this checks that the snapshot is a real, writable,
/// standalone database rather than something still tied to the sync layer.
/// (`db_disconnect_remote` itself isn't called here — it writes to the real
/// user's app-data directory.)
#[tokio::test(flavor = "multi_thread")]
async fn a_replica_can_be_snapshotted_into_a_standalone_local_database() {
    let Some((url, token)) = credentials() else {
        eprintln!("TURSO_DB_URL / TURSO_DB_TOKEN not set — skipping");
        return;
    };
    let path = replica_path("snapshot-src");
    let dest = replica_path("snapshot-dest");
    cleanup(&path);
    cleanup(&dest);

    let remote = connection::open(&DbProfile::Turso { path: path.clone(), url }, Some(&token))
        .await
        .expect("connect");
    let conn = remote.conn();
    let marker = format!("turso-snapshot-{}", std::process::id());
    conn.execute(
        "INSERT INTO words (word, word_freq, source) VALUES (?1, 1, 'test')",
        [marker.clone()],
    )
    .await
    .expect("seed a row to carry over");
    let expected = tanwords_lib::db::scalar_i64(&conn, "SELECT COUNT(*) FROM words", ())
        .await
        .expect("count before");

    conn.execute("VACUUM INTO ?1", libsql::params![dest.clone()])
        .await
        .expect("snapshot the replica");

    // Clean up the remote row before asserting, so a later failure can't leave it behind.
    conn.execute("DELETE FROM words WHERE word = ?1", [marker.clone()])
        .await
        .expect("cleanup remote row");
    drop(conn);
    drop(remote);

    let local = connection::open(&DbProfile::Local { path: dest.clone() }, None)
        .await
        .expect("the snapshot must open as an ordinary local database");
    let carried = tanwords_lib::db::scalar_i64(&local.conn(), "SELECT COUNT(*) FROM words", ())
        .await
        .expect("count after");
    assert_eq!(carried, expected, "every row should carry over");

    let descriptor = local.descriptor();
    assert_eq!(descriptor.kind, tanwords_lib::db::DbKind::Local);
    assert!(descriptor.caps.writable, "the snapshot must be writable");
    assert!(descriptor.caps.export, "and it is a normal local db again");
    assert!(!descriptor.offline);

    local
        .conn()
        .execute("INSERT INTO words (word, word_freq, source) VALUES ('snapshot-writable', 1, 'test')", ())
        .await
        .expect("writes must work on the snapshot");
    println!("PASS  disconnect snapshot carries {carried} words into a writable local db");

    drop(local);
    cleanup(&path);
    cleanup(&dest);
}

/// The feature's motivating case, end to end: a local database file merged into
/// a live Turso connection. Uses a throwaway source rather than the user's real
/// file, but the target is the actual remote.
#[tokio::test(flavor = "multi_thread")]
async fn a_local_database_can_be_imported_into_turso() {
    let Some((url, token)) = credentials() else {
        eprintln!("TURSO_DB_URL / TURSO_DB_TOKEN not set — skipping");
        return;
    };
    let replica = replica_path("import");
    let source = replica_path("import-source");
    cleanup(&replica);
    cleanup(&source);
    let marker = format!("import-{}", std::process::id());

    // A small local database to import from.
    {
        let local = connection::open(&DbProfile::Local { path: source.clone() }, None)
            .await
            .expect("build source");
        let c = local.conn();
        c.execute(
            "INSERT INTO words (word, word_type, level, word_freq, source, enrichment_text)
             VALUES (?1, 'n', 'C1', 1, 'manual', 'imported explanation')",
            [marker.clone()],
        )
        .await
        .unwrap();
        let id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'n', '导入测试', 0)",
            [id],
        )
        .await
        .unwrap();
    }

    let remote = connection::open(&DbProfile::Turso { path: replica.clone(), url }, Some(&token))
        .await
        .expect("connect");
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build app");
    tauri::Manager::manage(
        &app,
        tanwords_lib::AppState {
            db: std::sync::Mutex::new(remote),
            tts: std::sync::Mutex::new(None).into(),
            db_fallback_warning: None,
            document_privacy: Default::default(),
        },
    );
    let state: tauri::State<tanwords_lib::AppState> = tauri::Manager::state(&app);

    let plan = tanwords_lib::db::db_import_analyze(source.clone(), state.clone())
        .await
        .expect("analyze against a remote target");
    let words = plan.groups.iter().find(|g| g.kind == "words").expect("words group");
    assert_eq!(words.new_count, 1, "the seeded word should be new to the remote");

    let result = tanwords_lib::db::db_import_apply(
        source.clone(),
        tanwords_lib::db::ImportDecisions::default(),
        state.clone(),
    )
    .await
    .expect("apply against a remote target");
    assert!(result.added >= 1);

    // It must be on the primary, not just in the local replica.
    let conn = tanwords_lib::db::conn(&state).unwrap();
    let landed = tanwords_lib::db::scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM words WHERE word = ?1",
        [marker.clone()],
    )
    .await
    .unwrap();
    assert_eq!(landed, 1);
    println!("PASS  local database imported into Turso ({} rows added)", result.added);

    // Re-running must be a no-op rather than duplicating.
    let again = tanwords_lib::db::db_import_apply(
        source.clone(),
        tanwords_lib::db::ImportDecisions::default(),
        state.clone(),
    )
    .await
    .expect("second apply");
    assert_eq!(again.added, 0, "re-importing must not duplicate");
    println!("PASS  re-import against Turso is a no-op");

    conn.execute("DELETE FROM words WHERE word = ?1", [marker])
        .await
        .expect("cleanup");
    drop(conn);
    cleanup(&replica);
    cleanup(&source);
}
