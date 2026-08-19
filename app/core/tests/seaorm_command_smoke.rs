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

    // reading article (save + list-without-search + comment)
    use tanwords_lib::db::{db_add_reading_comment, db_list_reading_articles, db_save_reading_article};
    let article_id = db_save_reading_article(
        "A short essay".into(),
        "This is the body of the essay.".into(),
        "pasted".into(),
        None,
        None,
        state.clone(),
    )
    .await
    .unwrap();
    assert!(article_id > 0);
    let articles = db_list_reading_articles(
        None,            // search (None = no FTS, works on both backends)
        None,
        None,
        None,
        None,
        None,
        Some(0),
        Some(50),
        state.clone(),
    )
    .await
    .unwrap();
    assert!(articles.items.iter().any(|a| a.id == article_id));

    let comment_id = db_add_reading_comment(
        article_id,
        "reader".into(),
        "good point".into(),
        None,
        state.clone(),
    )
    .await
    .unwrap();
    assert!(comment_id > 0);

    // chat session upsert + list
    use tanwords_lib::db::{db_list_chat_sessions, db_upsert_chat_session};
    db_upsert_chat_session(
        "chat-1".into(),
        "First chat".into(),
        "[]".into(),
        String::new(),
        "english-tutor".into(),
        String::new(),
        0,
        state.clone(),
    )
    .await
    .unwrap();
    let sessions = db_list_chat_sessions(
        Some(0), Some(50), None, None, None, state.clone(),
    )
    .await
    .unwrap();
    assert!(sessions.iter().any(|s| s.id == "chat-1"));

    // quiz result → SRS multi-arg datetime (datetime('now', '+' || ?N || ' days')
    // the translator rewrites to a Postgres interval cast). The added word's id
    // is the quiz target; the first quiz save hits the INSERT branch (new
    // srs_record), the second hits the UPDATE branch.
    use tanwords_lib::db::{db_get_quiz_words, db_save_quiz_result};
    let quiz_words = db_get_quiz_words(Some(5), state.clone()).await.unwrap();
    let quiz_word_id = quiz_words.first().map(|w| w.id).expect("quiz words present");
    db_save_quiz_result(quiz_word_id, true, state.clone())
        .await
        .unwrap();
    db_save_quiz_result(quiz_word_id, false, state.clone())
        .await
        .unwrap();

    // document folders: create a nested folder chain, list, move a document
    // into it (exercises document_folders + documents.folder update + the
    // LIKE/transaction logic in folders.rs).
    use tanwords_lib::db::{
        db_create_document_folder, db_list_document_folders, db_set_documents_folder,
        db_update_document,
    };
    db_create_document_folder("Study/Rust".into(), state.clone())
        .await
        .unwrap();
    let folders = db_list_document_folders(state.clone()).await.unwrap();
    assert!(folders.iter().any(|f| f.path == "Study" || f.path == "Study/Rust"));

    db_update_document(
        doc_id,
        format!("Note {doc_id}"),
        "{}".into(),
        String::new(),
        "[]".into(),
        false,
        0,
        String::new(),
        state.clone(),
    )
    .await
    .unwrap();
    db_set_documents_folder(vec![doc_id], "Study/Rust".into(), state.clone())
        .await
        .unwrap();

    // calendar event (reserved-word columns "start"/"end" — quoted in the
    // call-site SQL so both backends accept them). Create + list + delete.
    use tanwords_lib::db::{
        db_create_calendar_event, db_delete_calendar_event, db_list_calendar_events,
    };
    let event_id = db_create_calendar_event(
        "Study session".into(),
        "2025-01-15 09:00".into(),
        "2025-01-15 10:00".into(),
        state.clone(),
        Some(false),
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .unwrap();
    assert!(!event_id.is_empty());
    let events = db_list_calendar_events(state.clone()).await.unwrap();
    assert!(events.iter().any(|e| e.id == event_id));
    db_delete_calendar_event(event_id, state.clone()).await.unwrap();

    // translation (exercises the translations streak upsert — the
    // daily_streaks.translations column + the
    // ON CONFLICT DO UPDATE SET translations = daily_streaks.translations + 1
    // fix). Save + list.
    use tanwords_lib::db::{db_get_translations, db_save_translation};
    let tx_id = db_save_translation(
        "hello".into(),
        "你好".into(),
        Some("en".into()),
        "zh".into(),
        "manual".into(),
        "text".into(),
        state.clone(),
    )
    .await
    .unwrap();
    assert!(tx_id > 0);
    let txs = db_get_translations(None, None, state.clone()).await.unwrap();
    assert!(txs.iter().any(|t| t.id == tx_id));

    // search history (txn_conn + transaction + CURRENT_TIMESTAMP — the
    // translator rewrites CURRENT_TIMESTAMP to to_char(now() AT TIME ZONE
    // 'UTC', ...) on Postgres). Add two (second dedups the first), list,
    // clear.
    use tanwords_lib::db::{
        db_add_search_history, db_clear_search_history, db_get_search_history,
    };
    db_add_search_history("serendipity".into(), state.clone())
        .await
        .unwrap();
    db_add_search_history("ephemeral".into(), state.clone())
        .await
        .unwrap();
    // re-adding "serendipity" dedups (DELETEs the old row, inserts fresh) —
    // exercises the transaction's DELETE+INSERT+commit path.
    db_add_search_history("serendipity".into(), state.clone())
        .await
        .unwrap();
    let history = db_get_search_history(state.clone()).await.unwrap();
    assert!(history.iter().any(|h| h.word == "serendipity"));
    assert!(history.iter().any(|h| h.word == "ephemeral"));
    // the re-added "serendipity" should appear once (deduped).
    let ser_count = history.iter().filter(|h| h.word == "serendipity").count();
    assert_eq!(ser_count, 1);
    db_clear_search_history(state.clone()).await.unwrap();
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
