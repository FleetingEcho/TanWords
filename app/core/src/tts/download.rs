use crate::shim::AppHandle;

use super::models::{default_models_dir, detect_model_dir, TtsModelInfo};

/// Only sherpa-onnx's own GitHub release assets are downloadable through this
/// command — the frontend's recommended-model list is hardcoded, but we still
/// don't want to turn this into an arbitrary-URL fetcher.
const ALLOWED_URL_PREFIX: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";

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
    let result = crate::model_download::download_and_extract(
        &app,
        &url,
        "tts-download-progress",
        &tmp_path,
        &staging_dir,
    )
    .await
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
