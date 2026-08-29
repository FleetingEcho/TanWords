//! End-to-end parity check: run a words + patterns + daily_streaks + tag
//! (json_each) write/read cycle through the real `db::Conn` API against both
//! a local SQLite file and a Postgres connection (when `TANWORDS_PG_TEST_URL`
//! is set), and assert the two backends behave identically. Run with:
//!   cargo test --test seaorm_backend_parity -- --ignored
//!   TANWORDS_PG_TEST_URL=postgres://testuser:testpass@localhost:5433/tanwords \
//!     cargo test --test seaorm_backend_parity -- --ignored

use tanwords_lib::db;
use tanwords_lib::db::Value;

async fn fresh_sqlite() -> db::Conn {
    let conn = db::connection::open_blank_memory().await.unwrap();
    db::init_db(&conn).await.unwrap();
    conn
}

async fn fresh_postgres(url: &str) -> db::Conn {
    let conn = db::connection::open_blank_postgres(url).await.unwrap();
    // Drop & recreate the schema so each run starts clean.
    let tables: Vec<String> = db::fetch_all(
        &conn,
        "SELECT tablename FROM pg_tables WHERE schemaname='public'",
        (),
        |r| r.get::<String>(0),
    )
    .await
    .unwrap();
    for t in &tables {
        let _ = conn
            .execute_batch(&format!("DROP TABLE IF EXISTS \"{t}\" CASCADE"))
            .await;
    }
    db::init_db(&conn).await.unwrap();
    conn
}

async fn word_count(conn: &db::Conn) -> i64 {
    db::scalar_i64(conn, "SELECT COUNT(*) FROM words", ()).await.unwrap()
}

/// `fresh_postgres` drops and recreates the whole schema in the one shared
/// test database, so the Postgres tests must not reset it concurrently (the
/// harness runs `#[tokio::test]`s in parallel threads).
static PG_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

async fn sentence_count(conn: &db::Conn) -> i64 {
    db::scalar_i64(conn, "SELECT COUNT(*) FROM sentences", ()).await.unwrap()
}

/// The shared cycle both backends run. Exercises:
/// - `INSERT … ON CONFLICT … DO NOTHING RETURNING id` (the last_insert_rowid
///   replacement).
/// - `CURRENT_TIMESTAMP` default (translator -> `to_char(now() AT TIME …)`).
/// - `daily_streaks` upsert on the reserved-word column `"date"` with
///   `date('now')` (translator -> `to_char(now() AT TIME …)`).
/// - `json_each` tag membership (translator -> `jsonb_array_elements_text`).
async fn shared_cycle(conn: &db::Conn) {
    assert_eq!(word_count(&conn).await, 0);

    // add a word via the portable INSERT … ON CONFLICT … RETURNING shape
    let id = db::fetch_one(
        &conn,
        "INSERT INTO words (word, word_type, level, word_freq, source) \
         VALUES (?1, ?2, ?3, 1, 'manual') ON CONFLICT(word) DO NOTHING RETURNING id",
        vec!["hello".to_string(), "interj".to_string(), "A1".to_string()],
        |r| r.get::<i64>(0),
    )
    .await
    .unwrap();
    assert!(id > 0);
    assert_eq!(word_count(&conn).await, 1);

    // duplicate word: ON CONFLICT DO NOTHING returns no row
    let dup = db::fetch_optional(
        &conn,
        "INSERT INTO words (word, word_type, level, word_freq, source) \
         VALUES (?1, ?2, ?3, 1, 'manual') ON CONFLICT(word) DO NOTHING RETURNING id",
        vec!["hello".to_string(), "interj".to_string(), "A1".to_string()],
        |r| r.get::<i64>(0),
    )
    .await
    .unwrap();
    assert!(dup.is_none());
    assert_eq!(word_count(&conn).await, 1);

    // sentence with RETURNING id (replaces last_insert_rowid). The `patterns`
    // system this used to exercise was replaced by first-class sentences.
    let pid = db::fetch_one(
        &conn,
        "INSERT INTO sentences (sentence, zh, level, note) \
         VALUES(?1,?2,?3,?4) RETURNING id",
        vec!["I love Rust".to_string(), "我爱 Rust".to_string(), "A2".to_string(), "".to_string()],
        |r| r.get::<i64>(0),
    )
    .await
    .unwrap();
    assert!(pid > 0);
    assert_eq!(sentence_count(&conn).await, 1);

    // read it back
    let (pat, zh): (String, String) = db::fetch_one(
        &conn,
        "SELECT sentence, zh FROM sentences WHERE id = ?1",
        vec![pid],
        |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
    )
    .await
    .unwrap();
    assert_eq!(pat, "I love Rust");
    assert_eq!(zh, "我爱 Rust");

    // daily_streaks upsert: reserved-word column "date", date('now') default.
    // Runs twice to exercise the ON CONFLICT DO UPDATE branch.
    conn.execute(
        "INSERT INTO daily_streaks (\"date\", words_added) VALUES (date('now'), 1) \
         ON CONFLICT(\"date\") DO UPDATE SET words_added = daily_streaks.words_added + 1",
        (),
    )
    .await
    .unwrap();
    conn.execute(
        "INSERT INTO daily_streaks (\"date\", words_added) VALUES (date('now'), 1) \
         ON CONFLICT(\"date\") DO UPDATE SET words_added = daily_streaks.words_added + 1",
        (),
    )
    .await
    .unwrap();
    let streak_words = db::scalar_i64(
        conn,
        "SELECT words_added FROM daily_streaks WHERE \"date\" = date('now')",
        (),
    )
    .await
    .unwrap();
    assert_eq!(streak_words, 2);

    // json_each tag membership: insert a document with a JSON tags array,
    // then filter by tag via the table-valued function (translator rewrites
    // to jsonb_array_elements_text on Postgres).
    let doc_id = db::fetch_one(
        conn,
        "INSERT INTO documents (title, content, content_text, tags) \
         VALUES ('Note', '{}', '', ?1) RETURNING id",
        vec![r#"["reading","grammar"]"#.to_string()],
        |r| r.get::<i64>(0),
    )
    .await
    .unwrap();
    let has_tag = db::scalar_i64(
        conn,
        "SELECT COUNT(*) FROM documents d \
         WHERE d.id = ?1 AND EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value = ?2)",
        vec![Value::BigInt(Some(doc_id)), Value::String(Some("grammar".to_string()))],
    )
    .await
    .unwrap();
    assert_eq!(has_tag, 1);
    let no_tag = db::scalar_i64(
        conn,
        "SELECT COUNT(*) FROM documents d \
         WHERE d.id = ?1 AND EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value = ?2)",
        vec![Value::BigInt(Some(doc_id)), Value::String(Some("absent".to_string()))],
    )
    .await
    .unwrap();
    assert_eq!(no_tag, 0);

    // Transaction commit: insert a word inside a tx, commit, read it back.
    let tx = conn.transaction().await.unwrap();
    let tx_id = db::fetch_one(
        &tx,
        "INSERT INTO words (word, word_type, level, word_freq, source) \
         VALUES (?1, ?2, ?3, 1, 'manual') ON CONFLICT(word) DO NOTHING RETURNING id",
        vec!["world".to_string(), "n".to_string(), "A1".to_string()],
        |r| r.get::<i64>(0),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let committed = db::scalar_i64(
        conn,
        "SELECT COUNT(*) FROM words WHERE word = ?1",
        vec!["world".to_string()],
    )
    .await
    .unwrap();
    assert_eq!(committed, 1);
    let _ = tx_id;

    // Transaction rollback: insert a word, roll back, confirm it's absent.
    let tx2 = conn.transaction().await.unwrap();
    tx2.execute(
        "INSERT INTO words (word, word_type, level, word_freq, source) \
         VALUES (?1, ?2, ?3, 1, 'manual')",
        vec!["rolledback".to_string(), "n".to_string(), "A1".to_string()],
    )
    .await
    .unwrap();
    tx2.rollback().await.unwrap();
    let rolled = db::scalar_i64(
        conn,
        "SELECT COUNT(*) FROM words WHERE word = ?1",
        vec!["rolledback".to_string()],
    )
    .await
    .unwrap();
    assert_eq!(rolled, 0);

    // SRS multi-arg datetime: the translator rewrites
    // `datetime('now', '+' || ?N || ' days')` to a Postgres interval cast.
    // Insert an srs_record pointing at a word, set next_review_at to
    // datetime('now', '+' || 5 || ' days'), and read it back — the value
    // should be a TEXT timestamp ~5 days from now on both backends.
    let srs_word_id = db::fetch_one(
        conn,
        "INSERT INTO words (word, word_type, level, word_freq, source) \
         VALUES (?1, ?2, ?3, 1, 'manual') ON CONFLICT(word) DO NOTHING RETURNING id",
        vec!["srsword".to_string(), "n".to_string(), "B1".to_string()],
        |r| r.get::<i64>(0),
    )
    .await
    .unwrap();
    conn.execute(
        "INSERT INTO srs_records (entity_id, entity_type, srs_level, srs_ease, review_count, last_reviewed_at, next_review_at) \
         VALUES (?1, 'word', 1, 2.5, 0, datetime('now'), datetime('now', '+' || ?2 || ' days'))",
        vec![Value::BigInt(Some(srs_word_id)), Value::BigInt(Some(5))],
    )
    .await
    .unwrap();
    let next_review: String = db::fetch_one(
        conn,
        "SELECT next_review_at FROM srs_records WHERE entity_id = ?1 AND entity_type = 'word'",
        vec![Value::BigInt(Some(srs_word_id))],
        |r| r.get::<String>(0),
    )
    .await
    .unwrap();
    // Both backends produce a 19-char 'YYYY-MM-DD HH:MM:SS' string.
    assert_eq!(next_review.len(), 19, "next_review_at = {next_review:?}");
}

#[tokio::test]
#[ignore]
async fn sqlite_words_and_sentences_round_trip() {
    let conn = fresh_sqlite().await;
    shared_cycle(&conn).await;
}

#[tokio::test]
#[ignore]
async fn postgres_words_and_sentences_round_trip() {
    let url = std::env::var("TANWORDS_PG_TEST_URL")
        .expect("set TANWORDS_PG_TEST_URL to run the Postgres parity test");
    // All Postgres tests share one database whose `fresh_postgres` drops and
    // recreates the schema; the default test harness runs them in parallel,
    // and two concurrent drop/create cycles race in the pg_type catalog.
    // Held for the whole test: releasing after the reset would let the next
    // test drop these tables mid-test.
    let _lock = PG_TEST_LOCK.lock().unwrap();
    let conn = fresh_postgres(&url).await;
    shared_cycle(&conn).await;
}

/// The web server's *disable remote access* flow calls
/// `downgrade_vault_rows_to_device_key` on a vault-bearing Postgres conn and
/// then snapshots the tables into a local file. This is the same shape in
/// miniature: seal rows with a vault key, downgrade, then verify the rows are
/// decryptable with the device key alone (what a local conn carries) on both
/// backends.
async fn shared_vault_downgrade_cycle(conn: &db::Conn) {
    use tanwords_lib::document_privacy::{decrypt_text, encrypt_text};

    // A stand-in vault key — the real one is random 32 bytes; contents are
    // irrelevant to the downgrade logic.
    let vault = [7u8; 32];
    let conn = conn.clone_handle().with_vault_key(Some(std::sync::Arc::new(vault)));
    let device = tanwords_lib::secrets::device_key()
        .expect("test host must have a device key (secret file fallback)");

    // One R2 row and one provider row, sealed under the vault key.
    conn.execute(
        "INSERT INTO r2_config (id, config_enc) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET config_enc = excluded.config_enc",
        vec![encrypt_text(&vault, "{\"bucket\":\"b\"}").unwrap()],
    )
    .await
    .unwrap();
    conn.execute(
        "INSERT INTO ai_providers (device_id, id, name, kind, api_base, model_id, api_key_enc)
         VALUES ('dev1', 'openai', 'OpenAI', 'openai', 'https://x', 'gpt', ?1)
         ON CONFLICT(device_id, id) DO UPDATE SET api_key_enc = excluded.api_key_enc",
        vec![encrypt_text(&vault, "sk-test-secret").unwrap()],
    )
    .await
    .unwrap();

    let resealed = tanwords_lib::secrets::downgrade_vault_rows_to_device_key(&conn)
        .await
        .unwrap();
    assert_eq!(resealed, 2, "one r2_config row + one ai_providers row");

    // After the downgrade the rows must decrypt with the device key alone.
    let r2: String = db::fetch_one(
        &conn,
        "SELECT config_enc FROM r2_config WHERE id = 1",
        (),
        |r| r.get::<String>(0),
    )
    .await
    .unwrap();
    assert_eq!(decrypt_text(&device, &r2).unwrap(), "{\"bucket\":\"b\"}");

    let key: String = db::fetch_one(
        &conn,
        "SELECT api_key_enc FROM ai_providers WHERE device_id = 'dev1' AND id = 'openai'",
        (),
        |r| r.get::<String>(0),
    )
    .await
    .unwrap();
    assert_eq!(decrypt_text(&device, &key).unwrap(), "sk-test-secret");

    // Idempotent: nothing is left that decrypts under the vault key, so a
    // second pass re-seals nothing.
    let again = tanwords_lib::secrets::downgrade_vault_rows_to_device_key(&conn)
        .await
        .unwrap();
    assert_eq!(again, 0);
}

#[tokio::test]
#[ignore]
async fn sqlite_vault_downgrade_round_trip() {
    let conn = fresh_sqlite().await;
    shared_vault_downgrade_cycle(&conn).await;
}

#[tokio::test]
#[ignore]
async fn postgres_vault_downgrade_round_trip() {
    let url = std::env::var("TANWORDS_PG_TEST_URL")
        .expect("set TANWORDS_PG_TEST_URL to run the Postgres parity test");
    let _lock = PG_TEST_LOCK.lock().unwrap();
    let conn = fresh_postgres(&url).await;
    shared_vault_downgrade_cycle(&conn).await;
}
