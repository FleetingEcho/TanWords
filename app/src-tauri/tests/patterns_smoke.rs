use rusqlite::Connection;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

fn make_state(conn: Connection) -> tauri::App<tauri::test::MockRuntime> {
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("failed to build mock app");
    app.manage(tanwords_lib::AppState {
        db: std::sync::Mutex::new(conn),
        db_path: std::sync::Mutex::new(":memory:".to_string()),
        tts: std::sync::Mutex::new(None),
    });
    app
}

#[test]
fn pattern_add_dedup_and_examples_roundtrip() {
    let conn = Connection::open_in_memory().unwrap();
    tanwords_lib::db::init_db(&conn).expect("init_db failed");
    let app = make_state(conn);
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    // First accept: creates the pattern + its first example.
    let id1 = tanwords_lib::db::db_add_pattern(
        "not so much X as Y".to_string(),
        "与其说是X,不如说是Y".to_string(),
        String::new(),
        Some("C1".to_string()),
        "contrast".to_string(),
        Some(r#"{"sentence":"It was not so much a plan as a hope.","source":"Article A","articleId":1}"#.to_string()),
        state.clone(),
    )
    .expect("db_add_pattern failed");

    // Same skeleton (different case/whitespace) from a second article: should
    // fold into the same pattern and append a second example, not duplicate.
    let id2 = tanwords_lib::db::db_add_pattern(
        "  Not So Much X As Y  ".to_string(),
        "".to_string(),
        String::new(),
        None,
        "other".to_string(),
        Some(r#"{"sentence":"She was not so much angry as disappointed.","source":"Article B","articleId":2}"#.to_string()),
        state.clone(),
    )
    .expect("db_add_pattern (dedup) failed");
    assert_eq!(id1, id2, "same skeleton should fold into one pattern id");

    // Re-adding the exact same sentence again should not create a duplicate example.
    tanwords_lib::db::db_add_pattern(
        "not so much X as Y".to_string(),
        "".to_string(),
        String::new(),
        None,
        "other".to_string(),
        Some(r#"{"sentence":"It was not so much a plan as a hope.","source":"Article A","articleId":1}"#.to_string()),
        state.clone(),
    )
    .expect("db_add_pattern (dup example) failed");

    let list = tanwords_lib::db::db_get_patterns(None, state.clone()).expect("get_patterns failed");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].example_count, 2, "duplicate sentence must not be re-inserted");
    assert!(!list[0].has_analysis);
    // zh backfilled on first insert, not clobbered by the second (empty) call.
    assert_eq!(list[0].zh, "与其说是X,不如说是Y");
    assert_eq!(list[0].level.as_deref(), Some("C1"));

    let detail = tanwords_lib::db::db_get_pattern_detail(id1, state.clone()).expect("get_pattern_detail failed");
    assert_eq!(detail.examples.len(), 2);
    assert_eq!(detail.examples[0].source, "Article A");
    assert_eq!(detail.examples[1].source, "Article B");

    // Filtering by function_tag: the first call set it to "contrast" and the
    // second (dedup) call's "other" must not overwrite the tag.
    let filtered = tanwords_lib::db::db_get_patterns(Some("contrast".to_string()), state.clone())
        .expect("get_patterns filtered failed");
    assert_eq!(filtered.len(), 1);
    let none_other = tanwords_lib::db::db_get_patterns(Some("other".to_string()), state.clone())
        .expect("get_patterns filtered failed");
    assert_eq!(none_other.len(), 0);
}

#[test]
fn pattern_analysis_and_delete() {
    let conn = Connection::open_in_memory().unwrap();
    tanwords_lib::db::init_db(&conn).expect("init_db failed");
    let app = make_state(conn);
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    let id = tanwords_lib::db::db_add_pattern(
        "the more X, the more Y".to_string(),
        "越X越Y".to_string(),
        String::new(),
        None,
        "other".to_string(),
        None,
        state.clone(),
    )
    .expect("db_add_pattern failed");

    tanwords_lib::db::db_update_pattern_analysis(
        id,
        "## Structure\n...".to_string(),
        Some("comparison".to_string()),
        state.clone(),
    )
    .expect("db_update_pattern_analysis failed");

    let detail = tanwords_lib::db::db_get_pattern_detail(id, state.clone()).expect("get_pattern_detail failed");
    assert_eq!(detail.analysis.as_deref(), Some("## Structure\n..."));
    assert_eq!(detail.function_tag, "comparison");

    let list = tanwords_lib::db::db_get_patterns(None, state.clone()).expect("get_patterns failed");
    assert!(list[0].has_analysis);

    tanwords_lib::db::db_delete_pattern(id, state.clone()).expect("db_delete_pattern failed");
    let list_after = tanwords_lib::db::db_get_patterns(None, state.clone()).expect("get_patterns failed");
    assert_eq!(list_after.len(), 0);

    let detail_err = tanwords_lib::db::db_get_pattern_detail(id, state.clone());
    assert!(detail_err.is_err(), "deleted pattern should no longer be fetchable");
}

#[test]
fn deleting_article_nulls_pattern_example_link_but_keeps_example() {
    let conn = Connection::open_in_memory().unwrap();
    tanwords_lib::db::init_db(&conn).expect("init_db failed");
    let app = make_state(conn);
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    let article_id = tanwords_lib::db::db_save_article_analysis(
        "Test Article".to_string(),
        "".to_string(),
        "pasted".to_string(),
        "Some content.".to_string(),
        "[]".to_string(),
        state.clone(),
    )
    .expect("db_save_article_analysis failed");

    let pattern_id = tanwords_lib::db::db_add_pattern(
        "far from X".to_string(),
        "远非X".to_string(),
        String::new(),
        None,
        "other".to_string(),
        Some(format!(
            r#"{{"sentence":"This is far from perfect.","source":"Test Article","articleId":{article_id}}}"#
        )),
        state.clone(),
    )
    .expect("db_add_pattern failed");

    tanwords_lib::db::db_delete_article(article_id, state.clone()).expect("db_delete_article failed");

    let detail = tanwords_lib::db::db_get_pattern_detail(pattern_id, state.clone())
        .expect("get_pattern_detail failed");
    assert_eq!(detail.examples.len(), 1, "example must survive article deletion");
    assert_eq!(detail.examples[0].article_id, None, "dangling article link must be cleared");
    assert_eq!(detail.examples[0].source, "Test Article", "source label is preserved");
}
