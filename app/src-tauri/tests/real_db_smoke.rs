//! Opens a *copy* of a real user database through the normal startup path and
//! runs the queries that touch the trickiest SQL — multi-join list reads, both
//! FTS5 indexes, and the SRS due-card query. Fresh-file tests can't catch a
//! migration that only misbehaves against existing data.
//!
//! Skipped unless `TANWORDS_TEST_DB` points at a database copy:
//!   cp ~/Library/Application\ Support/tanwords/tanwords.db{,-wal} /tmp/
//!   TANWORDS_TEST_DB=/tmp/tanwords.db cargo test --test real_db_smoke

use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

#[tokio::test]
async fn real_database_opens_and_serves_every_read_path() {
    let Ok(path) = std::env::var("TANWORDS_TEST_DB") else {
        eprintln!("TANWORDS_TEST_DB not set — skipping");
        return;
    };

    // The full startup path: PRAGMAs, init_db, and every pending migration.
    let database = tanwords_lib::db::connection::open(
        &tanwords_lib::db::DbProfile::Local { path },
        None,
    )
    .await
    .expect("opening a real database should succeed");

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("build failed");
    app.manage(tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
    });
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    let words = tanwords_lib::db::db_get_words(None, None, None, None, None, None, state.clone())
        .await
        .expect("db_get_words");
    assert!(!words.is_empty(), "the test database should have vocabulary");

    // Detail read for a real row, including its definitions join.
    tanwords_lib::db::db_get_word_detail(words[0].id, state.clone())
        .await
        .expect("db_get_word_detail");

    // FTS5: reading_articles_fts, with MATCH + bm25 + snippet.
    tanwords_lib::db::db_list_reading_articles(
        Some("the".into()), None, None, None, None, None, None, None, state.clone(),
    )
    .await
    .expect("db_list_reading_articles with search");

    // FTS5: documents_fts, reached through the document list's own filter.
    tanwords_lib::db::db_get_documents(Some("a".into()), None, None, None, None, None, state.clone())
        .await
        .expect("db_get_documents with search");

    // The SRS queries, including the due-card context expression.
    tanwords_lib::db::db_get_due_cards(None, state.clone())
        .await
        .expect("db_get_due_cards");
    tanwords_lib::db::db_get_review_count(state.clone())
        .await
        .expect("db_get_review_count");

    // Dashboard aggregates every table at once.
    tanwords_lib::db::db_dashboard_stats(state.clone())
        .await
        .expect("db_dashboard_stats");

    // Patterns and chat sessions round out the list-shaped reads.
    tanwords_lib::db::db_list_patterns(state.clone())
        .await
        .expect("db_list_patterns");
    tanwords_lib::db::db_list_chat_sessions(None, None, None, None, None, state)
        .await
        .expect("db_list_chat_sessions");
}
