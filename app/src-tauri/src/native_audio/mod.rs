mod decoder;
#[cfg(target_os = "macos")]
mod coreaudio;
#[cfg(target_os = "linux")]
mod gstreamer;
#[cfg(target_os = "linux")]
mod pulse;
mod playback;
#[cfg(test)]
mod tests;

use rodio::Source;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use tauri::State;

pub use decoder::DecodedTrack;
pub use playback::NativeAudioSnapshot;

use decoder::open_decoder;
use playback::{playback_worker, Command, Session};

pub struct NativeAudioState {
    session: Mutex<Option<Session>>,
    snapshot: Arc<Mutex<NativeAudioSnapshot>>,
}

impl Default for NativeAudioState {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
            snapshot: Arc::new(Mutex::new(NativeAudioSnapshot::default())),
        }
    }
}

impl NativeAudioState {
    fn send(&self, command: Command) -> Result<(), String> {
        self.session
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .ok_or_else(|| "no local track loaded".to_string())?
            .commands
            .send(command)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn native_audio_load(
    path: String,
    autoplay: bool,
    state: State<'_, NativeAudioState>,
) -> Result<NativeAudioSnapshot, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.is_file() {
        return Err("invalid local audio path".into());
    }
    let decoder = open_decoder(&path)?;
    let duration = decoder
        .total_duration()
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    let rate = decoder.sample_rate().get();
    let channels = decoder.channels().get();
    let generation = state.snapshot.lock().map_err(|e| e.to_string())?.generation + 1;
    if let Some(old) = state.session.lock().map_err(|e| e.to_string())?.take() {
        let _ = old.commands.send(Command::Stop);
    }
    let value = NativeAudioSnapshot {
        status: if autoplay { "playing" } else { "paused" },
        position_sec: 0.0,
        duration_sec: duration,
        speed: 1.0,
        error: None,
        generation,
    };
    *state.snapshot.lock().map_err(|e| e.to_string())? = value.clone();
    let shared = state.snapshot.clone();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        playback_worker(decoder, rate, channels, autoplay, generation, shared, rx)
    });
    *state.session.lock().map_err(|e| e.to_string())? = Some(Session { commands: tx });
    Ok(value)
}

#[tauri::command]
pub fn native_audio_play(state: State<'_, NativeAudioState>) -> Result<(), String> {
    state.send(Command::Play)
}
#[tauri::command]
pub fn native_audio_pause(state: State<'_, NativeAudioState>) -> Result<(), String> {
    state.send(Command::Pause)
}
#[tauri::command]
pub fn native_audio_seek(seconds: f64, state: State<'_, NativeAudioState>) -> Result<(), String> {
    state.send(Command::Seek(seconds))
}
#[tauri::command]
pub fn native_audio_set_speed(
    speed: f32,
    state: State<'_, NativeAudioState>,
) -> Result<(), String> {
    state.send(Command::Speed(speed))
}
#[tauri::command]
pub fn native_audio_stop(state: State<'_, NativeAudioState>) -> Result<(), String> {
    if let Some(session) = state.session.lock().map_err(|e| e.to_string())?.take() {
        let _ = session.commands.send(Command::Stop);
    }
    *state.snapshot.lock().map_err(|e| e.to_string())? = NativeAudioSnapshot::default();
    Ok(())
}
#[tauri::command]
pub fn native_audio_snapshot(
    state: State<'_, NativeAudioState>,
) -> Result<NativeAudioSnapshot, String> {
    state
        .snapshot
        .lock()
        .map(|s| s.clone())
        .map_err(|e| e.to_string())
}
