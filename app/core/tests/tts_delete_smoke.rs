// Manual verification of tts_delete_model against a real downloaded model.
//   cargo test --test tts_delete_smoke -- --ignored --nocapture
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

#[tokio::test]
#[ignore]
async fn deletes_and_unloads_active_model() {
    let dir = std::env::var("TTS_TEST_MODEL_DIR").expect("set TTS_TEST_MODEL_DIR");

    let database = tanwords_lib::db::connection::open_memory()
        .await
        .expect("open_memory failed");
    let app = mock_builder().build(mock_context(noop_assets())).expect("build failed");
    app.manage(tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
        document_privacy: Default::default(),
    });
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    tanwords_lib::tts::engine::tts_load_model(state.clone(), dir.clone())
        .await
        .expect("load should succeed");
    assert!(tanwords_lib::tts::engine::tts_engine_status(state.clone()).unwrap().is_some());

    tanwords_lib::tts::engine::tts_delete_model(state.clone(), dir.clone())
        .expect("delete should succeed");

    assert!(!std::path::Path::new(&dir).exists(), "directory should be gone");
    assert!(
        tanwords_lib::tts::engine::tts_engine_status(state.clone()).unwrap().is_none(),
        "engine should be unloaded after deleting the active model"
    );

    let err = tanwords_lib::tts::engine::tts_synthesize(state.clone(), "hi".to_string(), 0, 1.0)
        .await
        .unwrap_err();
    assert_eq!(err, "model-not-loaded");
}
