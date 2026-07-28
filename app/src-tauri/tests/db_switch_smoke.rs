use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

#[tokio::test]
async fn switch_path_mounts_new_db_and_swaps_live_connection() {
    // Real files rather than :memory: — switching away and back has to prove
    // the *original* database still holds its rows, which an in-memory one
    // (destroyed the moment its last handle drops) could not show.
    let tmp_dir = std::env::temp_dir().join(format!("tanwords_switch_test_{}", std::process::id()));
    std::fs::create_dir_all(&tmp_dir).unwrap();
    let original_path = tmp_dir.join("original.db").to_string_lossy().to_string();

    let database = tanwords_lib::db::connection::open(
        &tanwords_lib::db::DbProfile::Local { path: original_path.clone() },
        None,
    )
    .await
    .expect("open failed");
    database
        .conn()
        .execute(
            "INSERT INTO words (word, word_type, level, word_freq, source) VALUES ('original', 'n', 'B2', 1, 'manual')",
            (),
        )
        .await
        .unwrap();

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("build failed");
    app.manage(tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
    });
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    // Confirm the original word is visible before switching.
    let before = tanwords_lib::db::db_get_word_count(state.clone()).await.unwrap();
    assert_eq!(before, 1);

    let new_path = tmp_dir.join("other.db").to_string_lossy().to_string();

    let returned_path =
        tanwords_lib::db::db_switch_path_without_persist(new_path.clone(), state.clone())
            .await
            .expect("db_switch_path failed");
    assert_eq!(returned_path, new_path);

    // The new DB is empty (fresh file) — word count must reflect the NEW db, not the old one.
    let after = tanwords_lib::db::db_get_word_count(state.clone()).await.unwrap();
    assert_eq!(
        after, 0,
        "should be querying the newly mounted (empty) db, not the original"
    );

    // db_get_db_path must report the new path.
    let reported_path = tanwords_lib::db::db_get_db_path(state.clone()).unwrap();
    assert_eq!(reported_path, new_path);

    // Writing through the swapped connection should persist to the new file.
    tanwords_lib::db::db_add_word(
        "newword".to_string(),
        None,
        None,
        "新词".to_string(),
        state.clone(),
    )
    .await
    .expect("add_word on new db failed");
    let after_write = tanwords_lib::db::db_get_word_count(state.clone()).await.unwrap();
    assert_eq!(after_write, 1);

    // Switching back finds the original file untouched.
    tanwords_lib::db::db_switch_path_without_persist(original_path, state.clone())
        .await
        .expect("switch back failed");
    let back = tanwords_lib::db::db_get_word_count(state).await.unwrap();
    assert_eq!(back, 1, "the original database should still hold its row");

    std::fs::remove_dir_all(&tmp_dir).ok();
}

/// The connection descriptor drives which actions the Settings UI offers, so
/// the local profile must advertise export/switch support.
#[tokio::test]
async fn local_profile_reports_its_capabilities() {
    let database = tanwords_lib::db::connection::open_memory()
        .await
        .expect("open_memory failed");
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("build failed");
    app.manage(tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
    });
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    let descriptor = tanwords_lib::db::db_get_connection(state).unwrap();
    assert_eq!(descriptor.kind, tanwords_lib::db::DbKind::Local);
    assert!(descriptor.caps.export);
    assert!(descriptor.caps.switch_path);
    assert!(!descriptor.caps.sync);
    assert!(descriptor.remote_url.is_none());
}
