use std::path::{Path, PathBuf};

use sherpa_rs::tts::{KokoroTts, KokoroTtsConfig, VitsTts, VitsTtsConfig};

use super::models::{detect_model_dir, TtsModelInfo};

enum TtsHandle {
    Kokoro(KokoroTts),
    Vits(VitsTts),
}

impl TtsHandle {
    fn synthesize(&mut self, text: &str, sid: i32, speed: f32) -> Result<(Vec<f32>, u32), String> {
        let audio = match self {
            TtsHandle::Kokoro(t) => t.create(text, sid, speed),
            TtsHandle::Vits(t) => t.create(text, sid, speed),
        }
        .map_err(|e| e.to_string())?;
        Ok((audio.samples, audio.sample_rate))
    }
}

pub struct LoadedEngine {
    pub model_path: String,
    pub kind: String,
    pub sample_rate: u32,
    handle: TtsHandle,
}

fn file_if_exists(dir: &Path, name: &str) -> String {
    let p = dir.join(name);
    if p.is_file() {
        p.to_string_lossy().to_string()
    } else {
        String::new()
    }
}

fn dir_if_exists(dir: &Path, name: &str) -> String {
    let p = dir.join(name);
    if p.is_dir() {
        p.to_string_lossy().to_string()
    } else {
        String::new()
    }
}

fn first_onnx(dir: &Path) -> String {
    let mut onnx: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e == "onnx").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    onnx.sort();
    onnx.into_iter()
        .next()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Kokoro's multi-lang packages ship one or more `lexicon-*.txt` files that
/// must all be passed in, comma-separated (per sherpa-rs's KokoroTtsConfig).
fn lexicon_files(dir: &Path) -> String {
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("lexicon") && n.ends_with(".txt"))
                        .unwrap_or(false)
                })
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files.join(",")
}

fn build_handle(dir: &Path, kind: &str) -> Result<TtsHandle, String> {
    match kind {
        "kokoro" => {
            let config = KokoroTtsConfig {
                model: first_onnx(dir),
                voices: file_if_exists(dir, "voices.bin"),
                tokens: file_if_exists(dir, "tokens.txt"),
                data_dir: dir_if_exists(dir, "espeak-ng-data"),
                dict_dir: dir_if_exists(dir, "dict"),
                lexicon: lexicon_files(dir),
                length_scale: 1.0,
                ..Default::default()
            };
            Ok(TtsHandle::Kokoro(KokoroTts::new(config)))
        }
        "piper" => {
            let config = VitsTtsConfig {
                model: first_onnx(dir),
                tokens: file_if_exists(dir, "tokens.txt"),
                data_dir: dir_if_exists(dir, "espeak-ng-data"),
                lexicon: lexicon_files(dir),
                length_scale: 1.0,
                ..Default::default()
            };
            Ok(TtsHandle::Vits(VitsTts::new(config)))
        }
        other => Err(format!("unsupported model kind: {other}")),
    }
}

#[tauri::command]
pub async fn tts_load_model(
    state: tauri::State<'_, crate::AppState>,
    path: String,
) -> Result<TtsModelInfo, String> {
    // Session construction and the warm-up synthesis both perform synchronous
    // ONNX work. Keep them off Tauri's command/runtime threads so app startup
    // and unrelated IPC remain responsive while a saved model is preloaded.
    let tts = state.tts.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = PathBuf::from(&path);
        let info = detect_model_dir(&dir).ok_or_else(|| "model not recognized".to_string())?;
        if info.kind == "unknown" {
            return Err("model not recognized".to_string());
        }

        let mut handle = build_handle(&dir, &info.kind)?;
        let (_, sample_rate) = handle.synthesize(".", 0, 1.0)?;
        let mut guard = tts.lock().map_err(|e| e.to_string())?;
        *guard = Some(LoadedEngine {
            model_path: path,
            kind: info.kind.clone(),
            sample_rate,
            handle,
        });
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes a model directory from disk — unloading it first if it's the one
/// currently active, so we don't leave a dangling in-memory reference to a
/// path that no longer exists.
#[tauri::command]
pub fn tts_delete_model(
    state: tauri::State<'_, crate::AppState>,
    path: String,
) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if detect_model_dir(&dir).is_none() {
        return Err("not a model directory".to_string());
    }

    {
        let mut guard = state.tts.lock().map_err(|e| e.to_string())?;
        if guard.as_ref().map(|e| e.model_path == path).unwrap_or(false) {
            *guard = None;
        }
    }

    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tts_synthesize(
    state: tauri::State<'_, crate::AppState>,
    text: String,
    speaker_id: u32,
    speed: f32,
) -> Result<String, String> {
    // Kokoro/VITS inference is synchronous, CPU-bound ONNX work. Running it
    // inline inside the tokio-spawned command task (as `(async)` on a plain
    // fn would) blocks a shared executor worker thread for its full duration;
    // with several sentences in flight (current + prefetch) this starves
    // other IPC commands. `spawn_blocking` moves it to the dedicated blocking
    // pool instead.
    let tts = state.tts.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = tts.lock().map_err(|e| e.to_string())?;
        let engine = guard.as_mut().ok_or_else(|| "model-not-loaded".to_string())?;
        let (samples, sample_rate) = engine.handle.synthesize(&text, speaker_id as i32, speed)?;
        let pcm = f32_samples_to_i16(&samples);
        let wav = pcm_to_wav(&pcm, sample_rate);
        Ok(base64_encode(&wav))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn tts_engine_status(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<TtsModelInfo>, String> {
    let guard = state.tts.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(|engine| TtsModelInfo {
        id: engine.model_path.clone(),
        name: Path::new(&engine.model_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        kind: engine.kind.clone(),
        path: engine.model_path.clone(),
        num_speakers: 0,
        voice_names: vec![],
    }))
}

fn f32_samples_to_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|&s| (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16)
        .collect()
}

/// Convert raw PCM samples to WAV format
pub(crate) fn pcm_to_wav(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * channels as u32 * (bits_per_sample / 8) as u32;
    let block_align = channels * (bits_per_sample / 8);
    let data_size = samples.len() as u32 * (bits_per_sample / 8) as u32;
    let file_size = 36 + data_size;

    let mut wav = Vec::with_capacity(file_size as usize);

    // RIFF header
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&file_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // fmt chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // chunk size
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_ne_bytes());
    }

    wav
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}
