/// Builds a throwaway in-memory database wrapped in `AppState`, returning it
/// (the caller owns it and builds a `State` from a reference) and a
/// connection for seeding rows directly.
async fn mock_app() -> (tanwords_lib::AppState, libsql::Connection) {
    let database = tanwords_lib::db::connection::open_memory()
        .await
        .expect("open_memory failed");
    let conn = database.conn();
    let app_state = tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
        document_privacy: Default::default(),
    };
    (app_state, conn)
}

#[tokio::test]
async fn srs_review_roundtrip() {
    let (app_state, conn) = mock_app().await;

    // Seed one word with a definition
    conn.execute(
        "INSERT INTO words (word, word_type, level, word_freq, source) VALUES ('resilient', 'adj', 'C1', 1, 'manual')",
        (),
    ).await.unwrap();
    let word_id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO word_definitions (word_id, pos, zh, example_en, sort_order) VALUES (?1, 'adj', '有韧性的', 'The system is resilient.', 0)",
        [word_id],
    ).await.unwrap();

    let state = tanwords_lib::shim::State::from_ref(&app_state);

    // First call: word has no srs_records row yet -> should appear as "new"
    let due = tanwords_lib::db::db_get_due_cards(None, state.clone())
        .await
        .expect("get_due_cards failed");
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].word, "resilient");
    assert_eq!(due[0].state, "new");
    assert_eq!(due[0].zh, "有韧性的");
    assert_eq!(due[0].context_sentence, "The system is resilient.");

    let count_before = tanwords_lib::db::db_get_review_count(state.clone())
        .await
        .expect("review_count failed");
    assert_eq!(count_before, 1, "one never-reviewed word should count as due");

    // Review it as "good"
    let result = tanwords_lib::db::db_review_card(word_id, "good".to_string(), state.clone())
        .await
        .expect("review_card failed");
    assert_eq!(result.state, "learning");
    assert!(result.scheduled_days >= 0);

    // Immediately after a "good" review, the card should NOT be due again right now
    let due_after = tanwords_lib::db::db_get_due_cards(None, state.clone())
        .await
        .expect("get_due_cards failed");
    assert_eq!(due_after.len(), 0, "freshly reviewed card should not be immediately due");

    let count_after = tanwords_lib::db::db_get_review_count(state.clone())
        .await
        .expect("review_count failed");
    assert_eq!(count_after, 0);

    // Review again as "again" -> should lapse back, still not far in the future necessarily,
    // but must not error and must update lapses/state.
    let result2 = tanwords_lib::db::db_review_card(word_id, "again".to_string(), state.clone())
        .await
        .expect("second review_card failed");
    assert!(["learning", "relearning", "review"].contains(&result2.state.as_str()));
}

#[tokio::test]
async fn search_history_roundtrip() {
    let (app_state, conn) = mock_app().await;

    conn.execute(
        "INSERT INTO words (word, word_type, level, word_freq, source) VALUES ('serendipity', 'n', 'C2', 1, 'manual')",
        (),
    ).await.unwrap();

    let state = tanwords_lib::shim::State::from_ref(&app_state);

    tanwords_lib::db::db_add_search_history("Serendipity".to_string(), state.clone())
        .await
        .unwrap();
    tanwords_lib::db::db_add_search_history("ephemeral".to_string(), state.clone())
        .await
        .unwrap();

    let history = tanwords_lib::db::db_get_search_history(state.clone())
        .await
        .expect("get_search_history failed");
    assert_eq!(history.len(), 2);
    // Most recently searched first
    assert_eq!(history[0].word, "ephemeral");
    assert!(!history[0].in_vocab);
    assert_eq!(history[1].word, "serendipity");
    assert!(history[1].in_vocab, "word saved lowercase should match the vocab entry");

    // Re-searching bumps it to the top instead of duplicating
    tanwords_lib::db::db_add_search_history("serendipity".to_string(), state.clone())
        .await
        .unwrap();
    let history2 = tanwords_lib::db::db_get_search_history(state.clone())
        .await
        .expect("get_search_history failed");
    assert_eq!(history2.len(), 2, "re-searching should not create a duplicate row");
    assert_eq!(history2[0].word, "serendipity");

    tanwords_lib::db::db_clear_search_history(state.clone())
        .await
        .expect("clear failed");
    let history3 = tanwords_lib::db::db_get_search_history(state)
        .await
        .expect("get_search_history failed");
    assert_eq!(history3.len(), 0);
}
