use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct TtsModelInfo {
    pub id: String,
    pub name: String,
    pub kind: String, // "kokoro" | "piper" | "unknown"
    pub path: String,
    pub num_speakers: u32,
    pub voice_names: Vec<String>,
}

pub fn default_models_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tanwords")
        .join("tts_models")
}

#[tauri::command]
pub fn tts_scan_models(extra_dirs: Vec<String>) -> Result<Vec<TtsModelInfo>, String> {
    let mut roots: Vec<PathBuf> = vec![default_models_dir()];
    roots.extend(extra_dirs.into_iter().map(PathBuf::from));
    Ok(scan_models(&roots))
}

/// Where downloaded models land — surfaced to the settings UI so the user
/// knows where to go delete one manually.
#[tauri::command]
pub fn tts_default_models_dir() -> String {
    default_models_dir().to_string_lossy().to_string()
}

fn scan_models(roots: &[PathBuf]) -> Vec<TtsModelInfo> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in roots {
        candidates.push(root.clone());
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    candidates.push(entry.path());
                }
            }
        }
    }
    candidates.into_iter().filter_map(|dir| detect_model_dir(&dir)).collect()
}

/// Applies the recognition rules to a single directory. Returns `None` for
/// directories with no `.onnx` files at all (rule 4: skip silently).
pub(crate) fn detect_model_dir(dir: &Path) -> Option<TtsModelInfo> {
    if !dir.is_dir() {
        return None;
    }

    let onnx_files: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "onnx").unwrap_or(false))
        .collect();

    if onnx_files.is_empty() {
        return None;
    }

    let dir_name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let path_str = dir.to_string_lossy().to_string();

    // Rule 1: Kokoro
    if dir.join("voices.bin").is_file() && dir.join("tokens.txt").is_file() {
        return Some(TtsModelInfo {
            id: path_str.clone(),
            name: dir_name,
            kind: "kokoro".to_string(),
            path: path_str,
            num_speakers: 0,
            voice_names: vec![],
        });
    }

    // Rule 2: Piper/VITS — sherpa-onnx's own converted release format:
    // an .onnx model plus a shared tokens.txt (not the raw Piper onnx.json,
    // which sherpa-rs's VitsTts cannot load without an offline conversion step).
    if dir.join("tokens.txt").is_file() {
        if let Some(first) = onnx_files.iter().min_by_key(|p| p.to_string_lossy().to_string()) {
            let name = first
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| dir_name.clone());
            return Some(TtsModelInfo {
                id: path_str.clone(),
                name: name.clone(),
                kind: "piper".to_string(),
                path: path_str,
                num_speakers: 1,
                voice_names: vec![name],
            });
        }
    }

    // Rule 3: has onnx but doesn't match either shape
    Some(TtsModelInfo {
        id: path_str.clone(),
        name: dir_name,
        kind: "unknown".to_string(),
        path: path_str,
        num_speakers: 0,
        voice_names: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_scan_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("tanwords_tts_scan_test_{n}_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_kokoro() {
        let root = temp_scan_root();
        let model_dir = root.join("kokoro-en-v0_19");
        fs::create_dir_all(&model_dir).unwrap();
        fs::write(model_dir.join("model.onnx"), b"").unwrap();
        fs::write(model_dir.join("voices.bin"), b"").unwrap();
        fs::write(model_dir.join("tokens.txt"), b"").unwrap();

        let results = scan_models(&[root.clone()]);
        let found = results.iter().find(|m| m.path == model_dir.to_string_lossy());
        assert!(found.is_some());
        assert_eq!(found.unwrap().kind, "kokoro");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn detects_piper() {
        let root = temp_scan_root();
        let model_dir = root.join("en_US-lessac-high");
        fs::create_dir_all(&model_dir).unwrap();
        fs::write(model_dir.join("en_US-lessac-high.onnx"), b"").unwrap();
        fs::write(model_dir.join("tokens.txt"), b"").unwrap();

        let results = scan_models(&[root.clone()]);
        let found = results.iter().find(|m| m.path == model_dir.to_string_lossy());
        assert!(found.is_some());
        let info = found.unwrap();
        assert_eq!(info.kind, "piper");
        assert_eq!(info.name, "en_US-lessac-high");
        assert_eq!(info.num_speakers, 1);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn marks_unrecognized_onnx_dir_as_unknown() {
        let root = temp_scan_root();
        let model_dir = root.join("mystery");
        fs::create_dir_all(&model_dir).unwrap();
        fs::write(model_dir.join("weights.onnx"), b"").unwrap();

        let results = scan_models(&[root.clone()]);
        let found = results.iter().find(|m| m.path == model_dir.to_string_lossy());
        assert!(found.is_some());
        assert_eq!(found.unwrap().kind, "unknown");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn skips_dirs_without_onnx_files() {
        let root = temp_scan_root();
        let model_dir = root.join("not-a-model");
        fs::create_dir_all(&model_dir).unwrap();
        fs::write(model_dir.join("readme.txt"), b"").unwrap();

        let results = scan_models(&[root.clone()]);
        let found = results.iter().find(|m| m.path == model_dir.to_string_lossy());
        assert!(found.is_none());

        fs::remove_dir_all(&root).ok();
    }
}
