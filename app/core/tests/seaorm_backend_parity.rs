//! End-to-end parity check: run a words + patterns write/read cycle through the
//! real `db::Conn` API against both a local SQLite file and a Postgres
//! connection (when `TANWORDS_PG_TEST_URL` is set), and assert the two
//! backends behave identically. Run with:
//!   cargo test --test seaorm_backend_parity -- --ignored
//!   TANWORDS_PG_TEST_URL=postgres://testuser:testpass@localhost:5433/tanwords \
//!     cargo test --test seaorm_backend_parity -- --ignored

use tanwords_lib::db;

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

async fn pattern_count(conn: &db::Conn) -> i64 {
    db::scalar_i64(conn, "SELECT COUNT(*) FROM patterns", ()).await.unwrap()
}

#[tokio::test]
#[ignore]
async fn sqlite_words_and_patterns_round_trip() {
    let conn = fresh_sqlite().await;
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

    // pattern with RETURNING id (replaces last_insert_rowid)
    let pid = db::fetch_one(
        &conn,
        "INSERT INTO patterns(pattern,zh,function_tag,level,note,updated_at) \
         VALUES(?1,?2,'other',?3,?4,CURRENT_TIMESTAMP) RETURNING id",
        vec!["S + V + O".to_string(), "主谓宾".to_string(), "A2".to_string(), "".to_string()],
        |r| r.get::<i64>(0),
    )
    .await
    .unwrap();
    assert!(pid > 0);
    assert_eq!(pattern_count(&conn).await, 1);

    // read it back
    let (pat, zh): (String, String) = db::fetch_one(
        &conn,
        "SELECT pattern, zh FROM patterns WHERE id = ?1",
        vec![pid],
        |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
    )
    .await
    .unwrap();
    assert_eq!(pat, "S + V + O");
    assert_eq!(zh, "主谓宾");
}

#[tokio::test]
#[ignore]
async fn postgres_words_and_patterns_round_trip() {
    let url = std::env::var("TANWORDS_PG_TEST_URL")
        .expect("set TANWORDS_PG_TEST_URL to run the Postgres parity test");
    let conn = fresh_postgres(&url).await;
    assert_eq!(word_count(&conn).await, 0);

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

    let pid = db::fetch_one(
        &conn,
        "INSERT INTO patterns(pattern,zh,function_tag,level,note,updated_at) \
         VALUES(?1,?2,'other',?3,?4,CURRENT_TIMESTAMP) RETURNING id",
        vec!["S + V + O".to_string(), "主谓宾".to_string(), "A2".to_string(), "".to_string()],
        |r| r.get::<i64>(0),
    )
    .await
    .unwrap();
    assert!(pid > 0);
    assert_eq!(pattern_count(&conn).await, 1);

    let (pat, zh): (String, String) = db::fetch_one(
        &conn,
        "SELECT pattern, zh FROM patterns WHERE id = ?1",
        vec![pid],
        |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
    )
    .await
    .unwrap();
    assert_eq!(pat, "S + V + O");
    assert_eq!(zh, "主谓宾");
}
