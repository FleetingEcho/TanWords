// Manual verification against a real model (Kokoro or Piper). Not run in CI
// (no bundled model file); run explicitly with:
//   TTS_TEST_MODEL_DIR=/path/to/model-dir cargo test --test tts_real_model -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn loads_and_synthesizes_real_model() {
    let dir = std::env::var("TTS_TEST_MODEL_DIR").expect("set TTS_TEST_MODEL_DIR");

    let database = tanwords_lib::db::connection::open_memory()
        .await
        .expect("open_memory failed");
    let app_state = tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
        document_privacy: Default::default(),
    };
    let state = tanwords_lib::shim::State::from_ref(&app_state);

    let info = tanwords_lib::tts::engine::tts_load_model(state.clone(), dir)
        .await
        .expect("tts_load_model should succeed");
    println!("loaded: {} ({})", info.name, info.kind);
    assert!(info.kind == "kokoro" || info.kind == "piper", "unexpected kind: {}", info.kind);
    let loaded_kind = info.kind.clone();

    let wav_b64 = tanwords_lib::tts::engine::tts_synthesize(
        state.clone(),
        "This is a real synthesis smoke test.".to_string(),
        0,
        1.0,
    )
    .await
    .expect("tts_synthesize should succeed");

    use base64::Engine;
    let wav_bytes = base64::engine::general_purpose::STANDARD
        .decode(&wav_b64)
        .expect("valid base64");
    assert!(wav_bytes.len() > 44, "wav should have more than just a header");
    assert_eq!(&wav_bytes[0..4], b"RIFF");

    let out_path = std::env::temp_dir().join("tanwords_tts_real_test.wav");
    std::fs::write(&out_path, &wav_bytes).unwrap();
    println!("wrote {} bytes to {}", wav_bytes.len(), out_path.display());

    let status = tanwords_lib::tts::engine::tts_engine_status(state.clone())
        .expect("status call should succeed")
        .expect("engine should be loaded");
    assert_eq!(status.kind, loaded_kind);
}
