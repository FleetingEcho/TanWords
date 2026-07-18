use rusqlite::Connection;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

#[test]
fn switch_path_mounts_new_db_and_swaps_live_connection() {
    let conn = Connection::open_in_memory().unwrap();
    tanwords_lib::db::init_db(&conn).expect("init_db failed");
    conn.execute(
        "INSERT INTO words (word, word_type, level, word_freq, source) VALUES ('original', 'n', 'B2', 1, 'manual')",
        [],
    ).unwrap();

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("build failed");
    app.manage(tanwords_lib::AppState {
        db: std::sync::Mutex::new(conn),
        db_path: std::sync::Mutex::new(":memory:".to_string()),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
    });
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    // Confirm the original word is visible before switching.
    let before = tanwords_lib::db::db_get_word_count(state.clone()).unwrap();
    assert_eq!(before, 1);

    let tmp_dir = std::env::temp_dir().join(format!("tanwords_switch_test_{}", std::process::id()));
    std::fs::create_dir_all(&tmp_dir).unwrap();
    let new_path = tmp_dir.join("other.db").to_string_lossy().to_string();

    let returned_path =
        tanwords_lib::db::db_switch_path_without_persist(new_path.clone(), state.clone())
            .expect("db_switch_path failed");
    assert_eq!(returned_path, new_path);

    // The new DB is empty (fresh file) — word count must reflect the NEW db, not the old one.
    let after = tanwords_lib::db::db_get_word_count(state.clone()).unwrap();
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
    .expect("add_word on new db failed");
    let after_write = tanwords_lib::db::db_get_word_count(state.clone()).unwrap();
    assert_eq!(after_write, 1);

    std::fs::remove_dir_all(&tmp_dir).ok();
}
