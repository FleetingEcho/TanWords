use rusqlite::Connection;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

#[test]
fn writing_submission_saves_vocab_and_survives_source_deletion() {
    let conn = Connection::open_in_memory().unwrap();
    tanwords_lib::db::init_db(&conn).expect("init_db failed");
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

    let id = tanwords_lib::db::db_save_writing_submission(
        tanwords_lib::db::WritingSubmissionInput {
            original_text: "I very like this design.".into(),
            input_type: "sentence".into(),
            detected_genre: "daily".into(),
            overall_feedback: "".into(),
            refined_full_text: "".into(),
            structure_feedback: "".into(),
            coherence_feedback: "".into(),
            tone_feedback: "".into(),
            sentences: vec![tanwords_lib::db::WritingSentenceInput {
                original: "I very like this design.".into(),
                corrected: "I like this design very much.".into(),
                natural: "I really like this design.".into(),
                explanation: "副词位置需要调整。".into(),
                vocabulary: vec![tanwords_lib::db::WritingVocabularyInput {
                    original_expression: "really like".into(),
                    word: "appealing".into(),
                    meaning: "有吸引力的".into(),
                    reason: "更具体".into(),
                    example_sentence: "I find this design appealing.".into(),
                    selected: true,
                }],
            }],
            model_essays: vec![],
        },
        state.clone(),
    )
    .unwrap();

    let rows = tanwords_lib::db::db_list_writing_submissions(None, state.clone()).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].sentences[0].vocabulary[0].suggested_word,
        "appealing"
    );
    assert!(rows[0].sentences[0].vocabulary[0].vocabulary_id.is_some());

    tanwords_lib::db::db_delete_writing_submissions(vec![id], state.clone()).unwrap();
    assert!(
        tanwords_lib::db::db_list_writing_submissions(None, state.clone())
            .unwrap()
            .is_empty()
    );
    let words = tanwords_lib::db::db_get_words(None, None, None, None, None, None, state).unwrap();
    assert!(words.iter().any(|w| w.word == "appealing"));
}

#[test]
fn summary_document_is_created_with_content_atomically() {
    let conn = Connection::open_in_memory().unwrap();
    tanwords_lib::db::init_db(&conn).expect("init_db failed");
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
    let id = tanwords_lib::db::db_create_document_with_content(
        "Writing Summary".into(),
        "[]".into(),
        "Useful feedback".into(),
        "[\"writing-summary\"]".into(),
        2,
        state.clone(),
    )
    .unwrap();
    let doc = tanwords_lib::db::db_get_document(id, state).unwrap();
    assert_eq!(doc.title, "Writing Summary");
    assert_eq!(doc.content_text, "Useful feedback");
}
