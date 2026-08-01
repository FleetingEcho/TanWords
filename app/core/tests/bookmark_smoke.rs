async fn mock_app() -> tanwords_lib::AppState {
    let database = tanwords_lib::db::connection::open_memory()
        .await
        .expect("open_memory failed");
    tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
        document_privacy: Default::default(),
    }
}

#[tokio::test]
async fn bookmark_toggle_list_and_remove_roundtrip() {
    let app_state = mock_app().await;
    let state = tanwords_lib::shim::State::from_ref(&app_state);

    let created = tanwords_lib::rss::db_toggle_feed_bookmark(
        "https://example.com/story".into(),
        "Example story".into(),
        "Hacker News".into(),
        "example.com".into(),
        "A summary".into(),
        None,
        None,
        None,
        Some(123),
        Some("2026-07-31T00:00:00Z".into()),
        state.clone(),
    )
    .await
    .expect("bookmark should be created");
    assert!(created);

    let bookmarks = tanwords_lib::rss::db_get_feed_bookmarks(None, None, state.clone())
        .await
        .expect("list bookmarks");
    assert_eq!(bookmarks.len(), 1);
    assert_eq!(bookmarks[0].title, "Example story");
    assert_eq!(bookmarks[0].hn_item_id, Some(123));

    let removed = tanwords_lib::rss::db_toggle_feed_bookmark(
        "https://example.com/story".into(),
        "Example story".into(),
        "Hacker News".into(),
        "example.com".into(),
        "A summary".into(),
        None,
        None,
        None,
        Some(123),
        Some("2026-07-31T00:00:00Z".into()),
        state.clone(),
    )
    .await
    .expect("toggle should remove the existing bookmark");
    assert!(!removed);

    let after_toggle = tanwords_lib::rss::db_get_feed_bookmarks(None, None, state.clone())
        .await
        .expect("list bookmarks after toggle");
    assert!(after_toggle.is_empty());

    tanwords_lib::rss::db_toggle_feed_bookmark(
        "https://example.com/second".into(),
        "Second story".into(),
        "Hacker News".into(),
        "example.com".into(),
        "".into(),
        None,
        None,
        None,
        None,
        None,
        state.clone(),
    )
    .await
    .expect("second bookmark should be created");
    tanwords_lib::rss::db_remove_feed_bookmark("https://example.com/second".into(), state.clone())
        .await
        .expect("explicit remove should succeed");
    let final_list = tanwords_lib::rss::db_get_feed_bookmarks(None, None, state)
        .await
        .expect("list bookmarks after explicit remove");
    assert!(final_list.is_empty());
}
