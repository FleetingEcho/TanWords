// Manual verification of the real download+extract+verify flow against the
// actual GitHub release. Not run in CI (network + ~100MB download).
//   cargo test --test tts_download_smoke -- --ignored --nocapture

fn mock_handle() -> tanwords_lib::shim::AppHandle {
    let (tx, _rx) = tokio::sync::broadcast::channel(16);
    tanwords_lib::shim::AppHandle::new(std::sync::Arc::new(tanwords_lib::shim::Registry::default()), tx)
}

#[tokio::test]
#[ignore]
async fn downloads_and_recognizes_recommended_model() {
    let handle = mock_handle();

    let info = tanwords_lib::tts::download::tts_download_model(
        handle,
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2".to_string(),
        "kokoro-int8-en-v0_19".to_string(),
    )
    .await
    .expect("download should succeed");

    println!("downloaded + recognized: {} ({}) at {}", info.name, info.kind, info.path);
    assert_eq!(info.kind, "kokoro");
    assert!(std::path::Path::new(&info.path).is_dir());
}

#[tokio::test]
#[ignore]
async fn downloads_and_recognizes_piper_model() {
    let handle = mock_handle();

    let info = tanwords_lib::tts::download::tts_download_model(
        handle,
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium-int8.tar.bz2".to_string(),
        "vits-piper-en_US-lessac-medium-int8".to_string(),
    )
    .await
    .expect("download should succeed");

    println!("downloaded + recognized: {} ({}) at {}", info.name, info.kind, info.path);
    assert_eq!(info.kind, "piper");
    assert!(std::path::Path::new(&info.path).is_dir());
}

#[tokio::test]
#[ignore]
async fn downloads_and_recognizes_kokoro_multilang_model() {
    let handle = mock_handle();

    let info = tanwords_lib::tts::download::tts_download_model(
        handle,
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2".to_string(),
        "kokoro-multi-lang-v1_1".to_string(),
    )
    .await
    .expect("download should succeed");

    println!("downloaded + recognized: {} ({}) at {}", info.name, info.kind, info.path);
    assert_eq!(info.kind, "kokoro");
    assert!(std::path::Path::new(&info.path).is_dir());
}

#[tokio::test]
#[ignore]
async fn downloads_and_recognizes_kokoro_int8_multilang_model() {
    let handle = mock_handle();

    let info = tanwords_lib::tts::download::tts_download_model(
        handle,
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2".to_string(),
        "kokoro-int8-multi-lang-v1_1".to_string(),
    )
    .await
    .expect("download should succeed");

    println!("downloaded + recognized: {} ({}) at {}", info.name, info.kind, info.path);
    assert_eq!(info.kind, "kokoro");
    assert!(std::path::Path::new(&info.path).is_dir());
}
