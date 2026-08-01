use std::path::{Path, PathBuf};

use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKittenModelConfig,
    OfflineTtsKokoroModelConfig, OfflineTtsModelConfig, OfflineTtsPocketModelConfig,
    OfflineTtsVitsModelConfig, Wave,
};

use super::models::{detect_model_dir, pocket_voice_files, TtsModelInfo};

/// A reference voice for the Pocket engine, kept decoded in memory.
///
/// Pocket has no speaker-id table: a voice *is* a few seconds of reference
/// audio that the encoder turns into an embedding. Re-reading the wav on
/// every sentence would be pure waste, so each one is decoded once at load
/// time; sherpa's own `voice_embedding_cache_capacity` then keeps the
/// derived embedding hot across calls.
struct ReferenceVoice {
    samples: Vec<f32>,
    sample_rate: i32,
}

pub struct LoadedEngine {
    pub model_path: String,
    pub kind: String,
    pub sample_rate: u32,
    tts: OfflineTts,
    /// Non-empty only for `kind == "pocket"`, indexed by speaker id.
    voices: Vec<ReferenceVoice>,
}

impl LoadedEngine {
    fn synthesize(&self, text: &str, sid: i32, speed: f32) -> Result<(Vec<f32>, u32), String> {
        let mut config = GenerationConfig { speed, sid, ..Default::default() };

        // Pocket ignores `sid` entirely — the voice has to arrive as audio.
        // Clamp rather than error: a stale ttsVoiceId from a previously
        // selected model shouldn't leave the user with no speech at all.
        if !self.voices.is_empty() {
            let voice = &self.voices[(sid.max(0) as usize).min(self.voices.len() - 1)];
            config.reference_audio = Some(voice.samples.clone());
            config.reference_sample_rate = voice.sample_rate;
            config.sid = 0;
        }

        let audio = self
            .tts
            .generate_with_config(text, &config, None::<fn(&[f32], f32) -> bool>)
            .ok_or_else(|| "synthesis failed".to_string())?;
        Ok((audio.samples().to_vec(), audio.sample_rate() as u32))
    }
}

fn file_if_exists(dir: &Path, name: &str) -> Option<String> {
    let p = dir.join(name);
    p.is_file().then(|| p.to_string_lossy().to_string())
}

fn dir_if_exists(dir: &Path, name: &str) -> Option<String> {
    let p = dir.join(name);
    p.is_dir().then(|| p.to_string_lossy().to_string())
}

/// Picks the single `.onnx` whose stem starts with `prefix` — Pocket ships
/// its graphs under both plain and `.int8` names (`lm_main.int8.onnx`), so
/// matching on a prefix keeps the quantized and full bundles interchangeable.
fn onnx_with_prefix(dir: &Path, prefix: &str) -> Option<String> {
    let mut matches: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e == "onnx").unwrap_or(false))
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with(prefix))
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    matches.sort();
    matches.into_iter().next().map(|p| p.to_string_lossy().to_string())
}

fn first_onnx(dir: &Path) -> Option<String> {
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
    onnx.into_iter().next().map(|p| p.to_string_lossy().to_string())
}

/// Kokoro's multi-lang packages ship one or more `lexicon-*.txt` files that
/// must all be passed in, comma-separated.
fn lexicon_files(dir: &Path) -> Option<String> {
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
    (!files.is_empty()).then(|| files.join(","))
}

/// Every engine family shares one `OfflineTtsModelConfig`; only the sub-struct
/// matching `kind` is filled in and sherpa dispatches on whichever one has
/// paths set.
fn build_config(dir: &Path, kind: &str) -> Result<OfflineTtsConfig, String> {
    let mut model = OfflineTtsModelConfig {
        // Pocket is autoregressive, so it actually scales with threads in a
        // way the one-shot VITS/Kokoro graphs don't. Four is where the gain
        // flattens out on the laptops we target.
        num_threads: 4,
        ..Default::default()
    };

    match kind {
        "kokoro" => {
            model.kokoro = OfflineTtsKokoroModelConfig {
                model: first_onnx(dir),
                voices: file_if_exists(dir, "voices.bin"),
                tokens: file_if_exists(dir, "tokens.txt"),
                data_dir: dir_if_exists(dir, "espeak-ng-data"),
                dict_dir: dir_if_exists(dir, "dict"),
                lexicon: lexicon_files(dir),
                length_scale: 1.0,
                ..Default::default()
            };
        }
        "piper" => {
            model.vits = OfflineTtsVitsModelConfig {
                model: first_onnx(dir),
                tokens: file_if_exists(dir, "tokens.txt"),
                data_dir: dir_if_exists(dir, "espeak-ng-data"),
                lexicon: lexicon_files(dir),
                length_scale: 1.0,
                ..Default::default()
            };
        }
        "kitten" => {
            model.kitten = OfflineTtsKittenModelConfig {
                model: first_onnx(dir),
                voices: file_if_exists(dir, "voices.bin"),
                tokens: file_if_exists(dir, "tokens.txt"),
                data_dir: dir_if_exists(dir, "espeak-ng-data"),
                length_scale: 1.0,
            };
        }
        "pocket" => {
            model.pocket = OfflineTtsPocketModelConfig {
                lm_flow: onnx_with_prefix(dir, "lm_flow"),
                lm_main: onnx_with_prefix(dir, "lm_main"),
                encoder: onnx_with_prefix(dir, "encoder"),
                decoder: onnx_with_prefix(dir, "decoder"),
                text_conditioner: onnx_with_prefix(dir, "text_conditioner"),
                vocab_json: file_if_exists(dir, "vocab.json"),
                token_scores_json: file_if_exists(dir, "token_scores.json"),
                // Sentences are synthesized one at a time against a handful of
                // reference voices, so the embedding for the active voice stays
                // cached across an entire reading session.
                voice_embedding_cache_capacity: 50,
            };
        }
        other => return Err(format!("unsupported model kind: {other}")),
    }

    Ok(OfflineTtsConfig { model, ..Default::default() })
}

fn load_reference_voices(dir: &Path, kind: &str) -> Vec<ReferenceVoice> {
    if kind != "pocket" {
        return Vec::new();
    }
    pocket_voice_files(dir)
        .into_iter()
        .filter_map(|path| {
            let wave = Wave::read(&path.to_string_lossy())?;
            Some(ReferenceVoice {
                samples: wave.samples().to_vec(),
                sample_rate: wave.sample_rate(),
            })
        })
        .collect()
}

#[crate::shim::command]
pub async fn tts_load_model(
    state: crate::shim::State<'_, crate::AppState>,
    path: String,
) -> Result<TtsModelInfo, String> {
    // Session construction and the warm-up synthesis both perform synchronous
    // ONNX work. Keep them off Tauri's command/runtime threads so app startup
    // and unrelated IPC remain responsive while a saved model is preloaded.
    let tts = state.tts.clone();
    tokio::task::spawn_blocking(move || {
        let dir = PathBuf::from(&path);
        let info = detect_model_dir(&dir).ok_or_else(|| "model not recognized".to_string())?;
        if info.kind == "unknown" {
            return Err("model not recognized".to_string());
        }

        let config = build_config(&dir, &info.kind)?;
        let engine = OfflineTts::create(&config).ok_or_else(|| "failed to load model".to_string())?;
        let voices = load_reference_voices(&dir, &info.kind);
        if info.kind == "pocket" && voices.is_empty() {
            return Err("model has no reference voices".to_string());
        }

        let loaded = LoadedEngine {
            model_path: path,
            kind: info.kind.clone(),
            sample_rate: engine.sample_rate() as u32,
            tts: engine,
            voices,
        };
        // Warm up so the first real sentence isn't paying for lazy graph
        // initialization. Pocket's autoregressive loop makes that first call
        // materially slower than the steady state.
        loaded.synthesize(".", 0, 1.0)?;

        let mut guard = tts.lock().map_err(|e| e.to_string())?;
        *guard = Some(loaded);
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes a model directory from disk — unloading it first if it's the one
/// currently active, so we don't leave a dangling in-memory reference to a
/// path that no longer exists.
#[crate::shim::command]
pub fn tts_delete_model(
    state: crate::shim::State<'_, crate::AppState>,
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

/// Releases the active TTS engine without touching any model files on disk.
/// Called from the renderer after an idle period; the next speak request
/// self-heals by loading the persisted model again.
#[crate::shim::command]
pub fn tts_unload_model(
    state: crate::shim::State<'_, crate::AppState>,
) -> Result<(), String> {
    let mut guard = state.tts.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[crate::shim::command]
pub async fn tts_synthesize(
    state: crate::shim::State<'_, crate::AppState>,
    text: String,
    speaker_id: u32,
    speed: f32,
) -> Result<String, String> {
    // TTS inference is synchronous, CPU-bound ONNX work. Running it
    // inline inside the tokio-spawned command task (as `(async)` on a plain
    // fn would) blocks a shared executor worker thread for its full duration;
    // with several sentences in flight (current + prefetch) this starves
    // other IPC commands. `spawn_blocking` moves it to the dedicated blocking
    // pool instead.
    let tts = state.tts.clone();
    tokio::task::spawn_blocking(move || {
        let guard = tts.lock().map_err(|e| e.to_string())?;
        let engine = guard.as_ref().ok_or_else(|| "model-not-loaded".to_string())?;
        let (samples, sample_rate) = engine.synthesize(&text, speaker_id as i32, speed)?;
        let pcm = f32_samples_to_i16(&samples);
        let wav = pcm_to_wav(&pcm, sample_rate);
        Ok(base64_encode(&wav))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[crate::shim::command]
pub fn tts_engine_status(
    state: crate::shim::State<'_, crate::AppState>,
) -> Result<Option<TtsModelInfo>, String> {
    let guard = state.tts.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(|engine| {
        // Re-detecting rather than caching the load-time info keeps the voice
        // list in one place (`detect_model_dir`) instead of two that can drift.
        let dir = PathBuf::from(&engine.model_path);
        detect_model_dir(&dir).unwrap_or_else(|| TtsModelInfo {
            id: engine.model_path.clone(),
            name: Path::new(&engine.model_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            kind: engine.kind.clone(),
            path: engine.model_path.clone(),
            num_speakers: 0,
            voice_names: vec![],
        })
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

/// Exercises the real engines against whatever the user has actually
/// downloaded. Each case is skipped when its model directory is absent, so the
/// suite still passes on a clean checkout or in CI — but on a developer machine
/// with models installed it catches config-construction mistakes that the
/// path-shape tests in `models.rs` cannot, because those never load a graph.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts::models::default_models_dir;

    fn synthesize_from(dir_name: &str, expected_kind: &str) {
        let dir = default_models_dir().join(dir_name);
        if !dir.is_dir() {
            eprintln!("skipping {dir_name}: not installed");
            return;
        }

        let info = detect_model_dir(&dir).expect("model not detected");
        assert_eq!(info.kind, expected_kind, "wrong kind for {dir_name}");

        let config = build_config(&dir, &info.kind).expect("config");
        let tts = OfflineTts::create(&config).expect("engine failed to load");
        let engine = LoadedEngine {
            model_path: dir.to_string_lossy().to_string(),
            kind: info.kind.clone(),
            sample_rate: tts.sample_rate() as u32,
            tts,
            voices: load_reference_voices(&dir, &info.kind),
        };

        let (samples, rate) = engine.synthesize("The quick brown fox.", 0, 1.0).expect("synthesis");
        assert!(rate >= 16000, "{dir_name}: implausible sample rate {rate}");
        assert!(!samples.is_empty(), "{dir_name}: produced no audio");
        // A graph wired up with the wrong config tends to emit digital silence
        // rather than to fail loudly, so assert there is actually signal.
        let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!(peak > 0.01, "{dir_name}: output is silent (peak {peak})");
    }

    #[test]
    fn pocket_synthesizes() {
        synthesize_from("sherpa-onnx-pocket-tts-int8-2026-01-26", "pocket");
    }

    /// The full-precision bundle names its graphs `lm_main.onnx` where the
    /// quantized one uses `lm_main.int8.onnx`, so this is the case that would
    /// break if `onnx_with_prefix` ever stopped matching on a prefix.
    #[test]
    fn pocket_hq_synthesizes() {
        synthesize_from("sherpa-onnx-pocket-tts-2026-01-26", "pocket");
    }

    #[test]
    fn kokoro_still_synthesizes_after_migration() {
        synthesize_from("kokoro-multi-lang-v1_1", "kokoro");
    }

    #[test]
    fn piper_still_synthesizes_after_migration() {
        synthesize_from("vits-piper-en_US-lessac-medium-int8", "piper");
    }
}
