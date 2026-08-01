use std::io::Write;
use std::path::Path;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use crate::shim::AppHandle;

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
/// extracts it under `dirname`, and verifies it. The archive is staged in a
/// temp dir and moved into place only after a successful extract — a failed
/// run removes ONLY what it created, never a previously-good install, and a
/// successful run can never merge stale files into an existing one (reinstall
/// requires deleting the old model first).
#[crate::shim::command]
pub async fn tts_download_model(
    app: AppHandle,
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
    let staging_dir = root.join(format!(".tmp-extract-{dirname}"));
    let target_dir = root.join(&dirname);

    if target_dir.exists() {
        return Err(format!(
            "'{dirname}' is already installed — delete it first to re-download"
        ));
    }

    let mut created_target = false;
    let result = download_and_extract(&app, &url, &tmp_path, &staging_dir).await
        .and_then(|()| {
            // Verified: the archive's top-level folder is the model dir.
            let unpacked = staging_dir.join(&dirname);
            if !unpacked.is_dir() {
                return Err("downloaded model could not be recognized".to_string());
            }
            std::fs::rename(&unpacked, &target_dir).map_err(|e| e.to_string())?;
            created_target = true;
            detect_model_dir(&target_dir)
                .filter(|info| info.kind != "unknown")
                .ok_or_else(|| "downloaded model could not be recognized".to_string())
        });

    std::fs::remove_file(&tmp_path).ok();
    std::fs::remove_dir_all(&staging_dir).ok();
    // Only delete the target on failure when THIS run created it (rename
    // succeeded but recognition failed) — never a previously-good install.
    if result.is_err() && created_target {
        std::fs::remove_dir_all(&target_dir).ok();
    }

    result
}

async fn download_and_extract(
    app: &AppHandle,
    url: &str,
    tmp_path: &Path,
    staging_dir: &Path,
) -> Result<(), String> {
    // Connect must fail fast. The transfer itself gets NO total timeout —
    // model archives run to hundreds of MB on slow links — but each chunk
    // does: a dead connection otherwise sits in `stream.next()` forever with
    // the UI showing a frozen progress bar.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
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
    loop {
        let chunk = match tokio::time::timeout(Duration::from_secs(60), stream.next()).await {
            Ok(Some(chunk)) => chunk.map_err(|e| format!("download failed: {e}"))?,
            Ok(None) => break,
            Err(_) => return Err("download stalled (no data for 60s)".to_string()),
        };
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        let _ = app.emit(
            "tts-download-progress",
            DownloadProgress::Downloading { received, total },
        );
    }
    drop(file);

    let _ = app.emit("tts-download-progress", DownloadProgress::Extracting);

    // bzip2+untar of a multi-hundred-MB archive is CPU-bound — keep it off
    // the async worker that services other IPC commands.
    let tmp = tmp_path.to_path_buf();
    let staging = staging_dir.to_path_buf();
    tokio::task::spawn_blocking(move || extract_tar_bz2(&tmp, &staging))
        .await
        .map_err(|e| format!("extract worker failed: {e}"))??;

    Ok(())
}

fn extract_tar_bz2(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let decompressed = bzip2::read::BzDecoder::new(file);
    let mut archive = tar::Archive::new(decompressed);
    archive.unpack(dest).map_err(|e| e.to_string())
}
