use crate::shim::AppHandle;

use super::models::{default_models_dir, detect_model_dir, AsrModelInfo};

/// Only sherpa-onnx's own GitHub release assets are downloadable through this
/// command — mirrors `tts::download`'s allowlist, pointed at the ASR release
/// tag instead of the TTS one.
const ALLOWED_URL_PREFIX: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";

/// Downloads a model archive (`url`) to the default models directory,
/// extracts it under `dirname`, and verifies it. Same staging-dir → atomic
/// rename pattern as `tts_download_model`: a failed run removes only what it
/// created, never a previously-good install.
#[crate::shim::command]
pub async fn asr_download_model(
    app: AppHandle,
    url: String,
    dirname: String,
) -> Result<AsrModelInfo, String> {
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
        "asr-download-progress",
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
