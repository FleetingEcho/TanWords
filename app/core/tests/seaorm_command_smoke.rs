//! End-to-end command smoke test: build a real `AppState` for each backend
//! and exercise the `#[crate::shim::command]` functions (the same path the
//! frontend/MCP uses), not just raw SQL. This catches issues a raw-SQL parity
//! test misses — `db::conn`/`db::txn_conn` plumbing, `await_write`,
//! `DbDescriptor`/`DbCaps` gating, the dispatch-shaped State extraction.
//!
//! SQLite runs by default; Postgres runs when `TANWORDS_PG_TEST_URL` is set.
//!   cargo test --test seaorm_command_smoke -- --ignored
//!   TANWORDS_PG_TEST_URL=postgres://testuser:testpass@localhost:5433/tanwords \
//!     cargo test --test seaorm_command_smoke -- --ignored postgres

use tanwords_lib::db;
use tanwords_lib::shim::State;
use tanwords_lib::AppState;

fn app_state_for(db: db::connection::Db) -> AppState {
    AppState {
        db: std::sync::Mutex::new(db),
        #[cfg(feature = "tts")]
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
        document_privacy: Default::default(),
    }
}

async fn sqlite_state() -> State<'static, AppState> {
    let db = db::connection::open_memory().await.unwrap();
    let state = app_state_for(db);
    // Leak to get a 'static reference the way tauri's State works in tests.
    let boxed = Box::new(state);
    let static_ref: &'static AppState = Box::leak(boxed);
    State::from_ref(static_ref)
}

async fn postgres_state(url: &str) -> State<'static, AppState> {
    let db = db::connection::open(&db::DbProfile::Postgres { url: url.to_string() }, None)
        .await
        .unwrap();
    let state = app_state_for(db);
    let boxed = Box::new(state);
    let static_ref: &'static AppState = Box::leak(boxed);
    State::from_ref(static_ref)
}

/// Drop all user tables so the Postgres run starts clean (open() runs init_db,
/// which is idempotent via fingerprint, but a prior run's data would interfere
/// with the count assertions).
async fn wipe_postgres(url: &str) {
    let conn = db::connection::open_blank_postgres(url).await.unwrap();
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
    // Also clear the schema_fingerprint row the prior open() stamped.
    let _ = conn
        .execute_batch("DROP TABLE IF EXISTS schema_fingerprint")
        .await;
}

async fn shared_command_cycle(state: State<'_, AppState>) {
    use tanwords_lib::db::{
        db_add_word, db_create_document, db_get_documents, db_save_sentence_pattern,
    };

    // add a word through the command surface
    let added = db_add_word(
        "hello".into(),
        Some("interj".into()),
        Some("A1".into()),
        "你好".into(),
        state.clone(),
    )
    .await
    .unwrap();
    assert!(added.is_new);

    // adding the same word again is not new
    let dup = db_add_word(
        "hello".into(),
        Some("interj".into()),
        Some("A1".into()),
        "你好".into(),
        state.clone(),
    )
    .await
    .unwrap();
    assert!(!dup.is_new);

    // save a pattern (exercises a transaction + RETURNING id). The result
    // struct's fields are Serialize-only (frontend-facing), so we only assert
    // the call succeeded — an Err would surface a backend-portability bug.
    let _pat = db_save_sentence_pattern(
        "I love Rust".into(),
        "我爱 Rust".into(),
        "I love Rust".into(),
        String::new(),
        "A2".into(),
        String::new(),
        state.clone(),
    )
    .await
    .unwrap();

    // create a document and list it
    let doc_id = db_create_document(state.clone()).await.unwrap();
    assert!(doc_id > 0);

    let docs = db_get_documents(
        None,            // search (LIKE-based, works on both backends)
        None,            // date_from
        None,            // date_to
        None,            // tag
        None,            // sort
        Some(0),         // page
        None,            // status
        state.clone(),
    )
    .await
    .unwrap();
    assert!(docs.items.iter().any(|d| d.id == doc_id));
}

#[tokio::test]
#[ignore]
async fn sqlite_command_smoke() {
    let state = sqlite_state().await;
    shared_command_cycle(state).await;
}

#[tokio::test]
#[ignore]
async fn postgres_command_smoke() {
    let url = std::env::var("TANWORDS_PG_TEST_URL")
        .expect("set TANWORDS_PG_TEST_URL to run the Postgres command smoke test");
    wipe_postgres(&url).await;
    let state = postgres_state(&url).await;
    shared_command_cycle(state).await;
}
