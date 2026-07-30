use std::io::Write;
use std::path::Path;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::models::{default_models_dir, detect_model_dir, TtsModelInfo};

/// Only sherpa-onnx's own GitHub release assets are downloadable through this
/// command — the frontend's recommended-model list is hardcoded, but we still
/// don't want to turn this into an arbitrary-URL fetcher.
const ALLOWED_URL_PREFIX: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";

#[derive(Serialize, Clone)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum DownloadProgress {
    Downloading { received: u64, total: u64 },
    Extracting,
}

/// Downloads a model archive (`url`) to the default models directory,
/// extracts it under `dirname`, and verifies it. On any failure the partial
/// download and any half-extracted directory are removed.
#[tauri::command]
pub async fn tts_download_model<R: tauri::Runtime>(
    app: AppHandle<R>,
    url: String,
    dirname: String,
) -> Result<TtsModelInfo, String> {
    if !url.starts_with(ALLOWED_URL_PREFIX) {
        return Err("unsupported download source".to_string());
    }
    if dirname.is_empty() || dirname.contains('/') || dirname.contains("..") {
        return Err("invalid model directory name".to_string());
    }

    let root = default_models_dir();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let tmp_path = root.join(format!(".tmp-download-{dirname}.tar.bz2"));
    let target_dir = root.join(&dirname);

    let result = download_and_extract(&app, &url, &root, &tmp_path, &target_dir).await;

    std::fs::remove_file(&tmp_path).ok();

    if result.is_err() && target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).ok();
    }

    result
}

async fn download_and_extract<R: tauri::Runtime>(
    app: &AppHandle<R>,
    url: &str,
    root: &Path,
    tmp_path: &Path,
    target_dir: &Path,
) -> Result<TtsModelInfo, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let mut file = std::fs::File::create(tmp_path).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download failed: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        let _ = app.emit(
            "tts-download-progress",
            DownloadProgress::Downloading { received, total },
        );
    }
    drop(file);

    let _ = app.emit("tts-download-progress", DownloadProgress::Extracting);

    extract_tar_bz2(tmp_path, root)?;

    detect_model_dir(target_dir)
        .filter(|info| info.kind != "unknown")
        .ok_or_else(|| "downloaded model could not be recognized".to_string())
}

fn extract_tar_bz2(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let decompressed = bzip2::read::BzDecoder::new(file);
    let mut archive = tar::Archive::new(decompressed);
    archive.unpack(dest).map_err(|e| e.to_string())
}
