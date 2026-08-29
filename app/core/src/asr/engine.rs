use std::path::{Path, PathBuf};

use sherpa_onnx::{
    OfflineMoonshineModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
    OfflineSenseVoiceModelConfig, OfflineTransducerModelConfig, OfflineWhisperModelConfig,
};

use super::models::{detect_model_dir, onnx_containing, onnx_files, onnx_prefix, tokens_file, AsrModelInfo};

pub struct LoadedAsrEngine {
    pub model_path: String,
    pub kind: String,
    /// The info `detect_model_dir` produced at load time, served verbatim by
    /// `asr_engine_status` so a status probe never touches the disk.
    pub info: AsrModelInfo,
    recognizer: OfflineRecognizer,
}

impl LoadedAsrEngine {
    fn transcribe(&self, samples: &[f32], sample_rate: i32) -> Result<String, String> {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(sample_rate, samples);
        self.recognizer.decode(&stream);
        let result = stream.get_result().ok_or_else(|| "transcription failed".to_string())?;
        Ok(result.text)
    }
}

fn file_str(path: Option<PathBuf>) -> Option<String> {
    path.map(|p| p.to_string_lossy().to_string())
}

/// Every model family shares one `OfflineModelConfig`; only the sub-struct
/// matching `kind` is filled in and sherpa dispatches on whichever one has
/// paths set — same idea as `tts::engine::build_config`.
fn build_config(dir: &Path, kind: &str) -> Result<OfflineRecognizerConfig, String> {
    let onnx = onnx_files(dir);
    let tokens = file_str(tokens_file(dir)).ok_or_else(|| "missing tokens file".to_string())?;

    let mut config = OfflineRecognizerConfig { max_active_paths: 4, ..OfflineRecognizerConfig::default() };
    config.model_config.tokens = Some(tokens);
    config.model_config.num_threads = 4;

    match kind {
        "whisper" => {
            config.model_config.whisper = OfflineWhisperModelConfig {
                encoder: file_str(onnx_containing(&onnx, "encoder")),
                decoder: file_str(onnx_containing(&onnx, "decoder")),
                task: Some("transcribe".to_string()),
                ..Default::default()
            };
        }
        "transducer" => {
            config.model_config.transducer = OfflineTransducerModelConfig {
                encoder: file_str(onnx_containing(&onnx, "encoder")),
                decoder: file_str(onnx_containing(&onnx, "decoder")),
                joiner: file_str(onnx_containing(&onnx, "joiner")),
            };
            // The only transducer packages this app installs are NeMo
            // Parakeet-TDT exports, which need this model_type to decode
            // correctly (see the crate's own doc example in offline_asr.rs).
            config.model_config.model_type = Some("nemo_transducer".to_string());
        }
        "moonshine" => {
            config.model_config.moonshine = OfflineMoonshineModelConfig {
                preprocessor: file_str(onnx_prefix(&onnx, "preprocess")),
                encoder: file_str(onnx_prefix(&onnx, "encode")),
                uncached_decoder: file_str(onnx_prefix(&onnx, "uncached_decode")),
                cached_decoder: file_str(onnx_prefix(&onnx, "cached_decode")),
                merged_decoder: file_str(onnx_prefix(&onnx, "merged_decoder")),
            };
        }
        "sensevoice" => {
            config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
                model: file_str(onnx_containing(&onnx, "model")),
                // "auto" lets the model detect Chinese/English/etc per-utterance
                // rather than committing to one — exactly the mixed-language
                // case this app cares about.
                language: Some("auto".to_string()),
                use_itn: true,
            };
        }
        other => return Err(format!("unsupported model kind: {other}")),
    }

    Ok(config)
}

#[crate::shim::command]
pub async fn asr_load_model(
    state: crate::shim::State<'_, crate::AppState>,
    path: String,
) -> Result<AsrModelInfo, String> {
    let asr = state.asr.clone();
    tokio::task::spawn_blocking(move || {
        let dir = PathBuf::from(&path);
        let info = detect_model_dir(&dir).ok_or_else(|| "model not recognized".to_string())?;
        if info.kind == "unknown" {
            return Err("model not recognized".to_string());
        }

        let config = build_config(&dir, &info.kind)?;
        let recognizer =
            OfflineRecognizer::create(&config).ok_or_else(|| "failed to load model".to_string())?;

        let loaded = LoadedAsrEngine {
            model_path: path,
            kind: info.kind.clone(),
            info: info.clone(),
            recognizer,
        };

        let mut guard = asr.lock().map_err(|e| e.to_string())?;
        *guard = Some(loaded);
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes a model directory from disk — unloading it first if it's the one
/// currently active, mirroring `tts_delete_model`.
#[crate::shim::command]
pub fn asr_delete_model(
    state: crate::shim::State<'_, crate::AppState>,
    path: String,
) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if detect_model_dir(&dir).is_none() {
        return Err("not a model directory".to_string());
    }

    {
        let mut guard = state.asr.lock().map_err(|e| e.to_string())?;
        if guard.as_ref().map(|e| e.model_path == path).unwrap_or(false) {
            *guard = None;
        }
    }

    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

#[crate::shim::command]
pub fn asr_unload_model(state: crate::shim::State<'_, crate::AppState>) -> Result<(), String> {
    let mut guard = state.asr.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

/// Transcribes one recorded clip. `audio_b64` is a base64-encoded mono
/// 16-bit-PCM WAV file (produced by the renderer's push-to-talk recorder) —
/// batch, not streaming, matching the push-to-talk interaction model.
#[crate::shim::command]
pub async fn asr_transcribe(
    state: crate::shim::State<'_, crate::AppState>,
    audio_b64: String,
) -> Result<String, String> {
    let asr = state.asr.clone();
    tokio::task::spawn_blocking(move || {
        let bytes = base64_decode(&audio_b64)?;
        let (samples, sample_rate) = wav_to_pcm(&bytes)?;

        let guard = asr.lock().map_err(|e| e.to_string())?;
        let engine = guard.as_ref().ok_or_else(|| "model-not-loaded".to_string())?;
        engine.transcribe(&samples, sample_rate)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[crate::shim::command]
pub fn asr_engine_status(
    state: crate::shim::State<'_, crate::AppState>,
) -> Result<Option<AsrModelInfo>, String> {
    // The load-time `detect_model_dir` result is cached on the engine, so
    // this is a lock-and-clone — no disk walk, and no chance of blocking
    // behind a transcription that's holding the engine.
    let guard = state.asr.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(|engine| engine.info.clone()))
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())
}

/// Parses a mono 16-bit-PCM WAV file into normalized `f32` samples. Only the
/// specific format this app itself writes (see `tts::engine::pcm_to_wav`,
/// mirrored on the recording side by the renderer's PCM recorder) needs to be
/// supported — this is not a general-purpose WAV decoder.
fn wav_to_pcm(bytes: &[u8]) -> Result<(Vec<f32>, i32), String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a WAV file".to_string());
    }

    let mut pos = 12;
    let mut sample_rate: Option<u32> = None;
    let mut bits_per_sample: Option<u16> = None;
    let mut channels: Option<u16> = None;
    let mut data: Option<&[u8]> = None;

    while pos + 8 <= bytes.len() {
        let chunk_id = &bytes[pos..pos + 4];
        let chunk_size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body_start = pos + 8;
        let body_end = (body_start + chunk_size).min(bytes.len());
        let body = &bytes[body_start..body_end];

        match chunk_id {
            b"fmt " => {
                if body.len() < 16 {
                    return Err("malformed fmt chunk".to_string());
                }
                channels = Some(u16::from_le_bytes(body[2..4].try_into().unwrap()));
                sample_rate = Some(u32::from_le_bytes(body[4..8].try_into().unwrap()));
                bits_per_sample = Some(u16::from_le_bytes(body[14..16].try_into().unwrap()));
            }
            b"data" => {
                data = Some(body);
            }
            _ => {}
        }

        // Chunks are word-aligned: an odd-sized body is followed by a pad byte.
        pos = body_start + chunk_size + (chunk_size % 2);
    }

    let sample_rate = sample_rate.ok_or_else(|| "missing fmt chunk".to_string())?;
    let bits_per_sample = bits_per_sample.ok_or_else(|| "missing fmt chunk".to_string())?;
    let channels = channels.filter(|c| *c != 0).unwrap_or(1);
    let data = data.ok_or_else(|| "missing data chunk".to_string())?;

    if bits_per_sample != 16 {
        return Err(format!("unsupported bit depth: {bits_per_sample}"));
    }
    // Guard against the malformed-header division-by-zero/panic: a `fmt`
    // chunk claiming zero channels would make `chunks_exact(0)` panic.

    let frame_bytes = 2 * channels as usize;
    let samples: Vec<f32> = data
        .chunks_exact(frame_bytes)
        .map(|frame| {
            // Mono recordings are the only path in practice; a stray stereo
            // clip is downmixed by averaging channels rather than rejected.
            let sum: i32 = (0..channels as usize)
                .map(|c| i16::from_le_bytes(frame[c * 2..c * 2 + 2].try_into().unwrap()) as i32)
                .sum();
            (sum as f32 / channels as f32) / i16::MAX as f32
        })
        .collect();

    Ok((samples, sample_rate as i32))
}
