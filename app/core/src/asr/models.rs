use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct AsrModelInfo {
    pub id: String,
    pub name: String,
    pub kind: String, // "whisper" | "transducer" | "moonshine" | "sensevoice" | "unknown"
    pub path: String,
}

pub fn default_models_dir() -> PathBuf {
    crate::shared_models_root().join("tanwords").join("asr_models")
}

#[crate::shim::command]
pub fn asr_scan_models(extra_dirs: Vec<String>) -> Result<Vec<AsrModelInfo>, String> {
    let mut roots: Vec<PathBuf> = vec![default_models_dir()];
    roots.extend(extra_dirs.into_iter().map(PathBuf::from));
    Ok(scan_models(&roots))
}

#[crate::shim::command]
pub fn asr_default_models_dir() -> String {
    default_models_dir().to_string_lossy().to_string()
}

fn scan_models(roots: &[PathBuf]) -> Vec<AsrModelInfo> {
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

pub(crate) fn onnx_files(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e == "onnx").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn onnx_containing(onnx: &[PathBuf], needle: &str) -> Option<PathBuf> {
    let mut matches: Vec<PathBuf> = onnx
        .iter()
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.contains(needle))
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    matches.sort();
    matches.into_iter().next()
}

/// Prefix (not substring) match — needed for Moonshine's `cached_decode.onnx`,
/// which would otherwise also match a `contains("cached_decode")` filter on
/// `uncached_decode.onnx`.
pub(crate) fn onnx_prefix(onnx: &[PathBuf], prefix: &str) -> Option<PathBuf> {
    let mut matches: Vec<PathBuf> = onnx
        .iter()
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(prefix))
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    matches.sort();
    matches.into_iter().next()
}

pub(crate) fn tokens_file(dir: &Path) -> Option<PathBuf> {
    let mut matches: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.ends_with("tokens.txt"))
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    matches.sort();
    matches.into_iter().next()
}

/// Applies the recognition rules to a single directory. Returns `None` for
/// directories with no `.onnx` files at all (skipped silently).
///
/// Order matters: a joiner file is unique to transducer (Parakeet-TDT-style)
/// packages, and a `preprocess`/`merged_decoder` file is unique to Moonshine —
/// both are checked before falling back to the plain encoder+decoder shape
/// that Whisper uses, so a transducer or Moonshine bundle never gets
/// misdetected as Whisper. SenseVoice ships as a single `model[.int8].onnx` +
/// `tokens.txt` — checked last (after the multi-file families are ruled out)
/// so it only catches genuinely single-onnx bundles, not stray "unknown"
/// directories that happen to contain one differently-named onnx file.
pub(crate) fn detect_model_dir(dir: &Path) -> Option<AsrModelInfo> {
    if !dir.is_dir() {
        return None;
    }

    let onnx = onnx_files(dir);
    if onnx.is_empty() {
        return None;
    }

    let dir_name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let path_str = dir.to_string_lossy().to_string();

    let kind = if onnx_containing(&onnx, "joiner").is_some() {
        "transducer"
    } else if onnx_containing(&onnx, "preprocess").is_some()
        || onnx_containing(&onnx, "merged_decoder").is_some()
        || onnx_containing(&onnx, "uncached_decode").is_some()
    {
        "moonshine"
    } else if onnx_containing(&onnx, "encoder").is_some() && onnx_containing(&onnx, "decoder").is_some() {
        "whisper"
    } else if onnx.len() == 1 && onnx_containing(&onnx, "model").is_some() {
        "sensevoice"
    } else {
        "unknown"
    };

    Some(AsrModelInfo { id: path_str.clone(), name: dir_name, kind: kind.to_string(), path: path_str })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_scan_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("tanwords_asr_scan_test_{n}_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_whisper() {
        let root = temp_scan_root();
        let model_dir = root.join("sherpa-onnx-whisper-tiny.en");
        fs::create_dir_all(&model_dir).unwrap();
        for f in ["tiny.en-encoder.onnx", "tiny.en-decoder.onnx"] {
            fs::write(model_dir.join(f), b"").unwrap();
        }
        fs::write(model_dir.join("tiny.en-tokens.txt"), b"").unwrap();

        let results = scan_models(&[root.clone()]);
        let found = results.iter().find(|m| m.path == model_dir.to_string_lossy());
        assert_eq!(found.unwrap().kind, "whisper");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn detects_transducer() {
        let root = temp_scan_root();
        let model_dir = root.join("sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8");
        fs::create_dir_all(&model_dir).unwrap();
        for f in ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"] {
            fs::write(model_dir.join(f), b"").unwrap();
        }
        fs::write(model_dir.join("tokens.txt"), b"").unwrap();

        let results = scan_models(&[root.clone()]);
        let found = results.iter().find(|m| m.path == model_dir.to_string_lossy());
        assert_eq!(found.unwrap().kind, "transducer");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn detects_moonshine() {
        let root = temp_scan_root();
        let model_dir = root.join("sherpa-onnx-moonshine-tiny-en-int8");
        fs::create_dir_all(&model_dir).unwrap();
        for f in ["preprocess.onnx", "encode.onnx", "uncached_decode.onnx", "cached_decode.onnx"] {
            fs::write(model_dir.join(f), b"").unwrap();
        }
        fs::write(model_dir.join("tokens.txt"), b"").unwrap();

        let results = scan_models(&[root.clone()]);
        let found = results.iter().find(|m| m.path == model_dir.to_string_lossy());
        assert_eq!(found.unwrap().kind, "moonshine");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn detects_sensevoice() {
        let root = temp_scan_root();
        let model_dir = root.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2025-09-09");
        fs::create_dir_all(&model_dir).unwrap();
        fs::write(model_dir.join("model.onnx"), b"").unwrap();
        fs::write(model_dir.join("tokens.txt"), b"").unwrap();

        let results = scan_models(&[root.clone()]);
        let found = results.iter().find(|m| m.path == model_dir.to_string_lossy());
        assert_eq!(found.unwrap().kind, "sensevoice");

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
        assert_eq!(found.unwrap().kind, "unknown");

        fs::remove_dir_all(&root).ok();
    }
}
