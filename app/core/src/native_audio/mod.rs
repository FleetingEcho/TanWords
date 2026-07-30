mod decoder;
#[cfg(target_os = "macos")]
mod coreaudio;
#[cfg(target_os = "linux")]
mod gstreamer;
mod mp3_duration;
mod mp4_duration;
#[cfg(target_os = "linux")]
mod pulse;
mod playback;
mod robust;
#[cfg(test)]
mod tests;

use rodio::Source;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use crate::shim::State;

pub use decoder::DecodedTrack;
pub use playback::NativeAudioSnapshot;

use decoder::open_decoder;
use playback::{playback_worker, Command, Session};

/// Exact duration of an MP3, measured from its frame headers; `None` for every
/// other format (where the container already declares an exact length) and for
/// files that do not parse as MPEG audio.
///
/// Gated on the extension on purpose: an MPEG frame header is only 11 sync bits
/// plus a handful of field constraints, so scanning a FLAC or MP4 payload for
/// one would occasionally "succeed" on compressed noise.
pub fn measured_mp3_duration_secs(path: &std::path::Path) -> Option<f64> {
    let is_mp3 = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"));
    if !is_mp3 {
        return None;
    }
    mp3_duration::mp3_duration_secs(path).filter(|secs| *secs > 0.0)
}

/// Exact duration measured from a format-specific source rather than metadata
/// heuristics or a decoder's derived frame count.
pub fn measured_container_duration_secs(path: &std::path::Path) -> Option<f64> {
    measured_mp3_duration_secs(path).or_else(|| mp4_duration::audio_duration_secs(path))
}

/// The single source of truth for how long a local file is.
///
/// Ranked by how the number is arrived at, not by which library produced it:
///
/// 1. **MP3: measured from the bitstream** (`mp3_duration`). Every other MP3
///    source is an extrapolation from the leading frames — `lofty` logs
///    "Using bitrate to estimate duration" and symphonia averages its first 16
///    frames — which is exact for CBR and badly wrong for VBR files with no
///    Xing header. That estimate is what reported a 4:00 song as 3:12.
/// 2. **Container-declared length** from the decoder. For MP4/M4A/FLAC/Ogg the
///    length is written in the header as an exact frame count, so it is not an
///    estimate at all.
/// 3. **`lofty` tag metadata**, for anything the first two cannot parse.
///
/// The result is also pushed back into the decoder
/// (`FileDecoder::set_total_duration`) so seek clamping uses the same number
/// the UI displays — a mismatch there is how "seek to the end does nothing"
/// bugs appear.
fn accurate_duration(path: &PathBuf, decoder: &decoder::FileDecoder) -> f64 {
    if let Some(secs) = measured_mp3_duration_secs(path) {
        return secs;
    }
    if let Some(secs) = mp4_duration::audio_duration_secs(path) {
        return secs;
    }

    if let Some(secs) = decoder.total_duration().map(|d| d.as_secs_f64()) {
        if secs > 0.0 {
            return secs;
        }
    }

    use lofty::prelude::*;
    if let Ok(tagged) = lofty::read_from_path(path) {
        let secs = tagged.properties().duration().as_secs_f64();
        if secs > 0.0 {
            return secs;
        }
    }
    0.0
}

pub struct NativeAudioState {
    session: Mutex<Option<Session>>,
    snapshot: Arc<Mutex<NativeAudioSnapshot>>,
    /// Serializes every `native_audio_*` command against every other one.
    ///
    /// Under Tauri this was free: all commands but `probe_duration` ran on the
    /// single main thread, so `native_audio_load`'s take-old/install-new
    /// sequence could never be interleaved with a `native_audio_stop`. Under
    /// axum each request lands on an arbitrary tokio worker, so that ordering
    /// guarantee has to be rebuilt explicitly. Holding this lock for the full
    /// body of each command (not just around the individual `session`/
    /// `snapshot` field locks) recreates "one thread, one command at a time"
    /// exactly: a `native_audio_stop` that arrives while a `native_audio_load`
    /// is between taking the old session and installing the new one now
    /// blocks until `load` finishes, instead of observing `session == None`
    /// and being silently dropped.
    ///
    /// A dedicated actor task (channel + one thread owning the state) would
    /// give the same serialization, but it means every command becomes a
    /// round trip through a channel and the actor has to fabricate the
    /// `Result`/error plumbing the direct calls already have for free. A
    /// single `Mutex` held across the whole handler body is the smaller diff
    /// for the same guarantee, and every command here is either a fast
    /// in-memory update or (for `load`) file I/O already documented as "fast
    /// enough" to run inline — so lock hold time stays short.
    op_lock: Mutex<()>,
}

impl Default for NativeAudioState {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
            snapshot: Arc::new(Mutex::new(NativeAudioSnapshot::default())),
            op_lock: Mutex::new(()),
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

/// Reads just the duration of a local file via the same decoder used for actual
/// playback (open_decoder — CoreAudio/ExtAudioFile for mp4/m4a/aac on macOS, etc.),
/// without touching playback state. The music library's list view previously probed
/// duration with a plain HTML5 `<audio>` element instead, which (like rodio's own
/// Symphonia demuxer) can misjudge duration for mp4-family containers — especially
/// "video" files that are really just audio (e.g. a song shipped as .mp4) — leaving
/// the list showing no duration for a track that plays back with a perfectly correct
/// one. Reusing the real decoder keeps the two guaranteed to agree.
/// `(async)` — not because the body is async, but because a plain
/// `#[crate::shim::command]` fn runs on the main thread, which on Linux is the GTK/
/// WebKit UI thread. Opening a decoder is file I/O plus (for MP3) a GStreamer
/// pipeline, so running it there froze the whole window while the music
/// library filled in missing durations. This variant runs on Tauri's blocking
/// threadpool instead, which also makes the library's concurrent probes
/// actually concurrent rather than serialized behind one thread.
#[crate::shim::command(async)]
pub fn native_audio_probe_duration(path: String) -> Result<f64, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.is_file() {
        return Err("invalid local audio path".into());
    }
    let decoder = open_decoder(&path)?;
    Ok(accurate_duration(&path, &decoder))
}

/// Not `#[crate::shim::command(async)]`: `open_decoder` is fast enough that
/// running it inline (rather than on the blocking pool) isn't worth the
/// complexity, and — unlike `probe_duration` — this command mutates shared
/// session state, so it must go through `op_lock` (see the field doc on
/// `NativeAudioState::op_lock` for why: under Tauri the main thread gave this
/// atomicity against `native_audio_stop` et al. for free, axum does not).
#[crate::shim::command]
pub fn native_audio_load(
    path: String,
    autoplay: bool,
    state: State<'_, NativeAudioState>,
) -> Result<NativeAudioSnapshot, String> {
    let _guard = state.op_lock.lock().map_err(|e| e.to_string())?;
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.is_file() {
        return Err("invalid local audio path".into());
    }
    let mut decoder = open_decoder(&path)?;
    let duration = accurate_duration(&path, &decoder);
    if duration > 0.0 {
        decoder.set_total_duration(std::time::Duration::from_secs_f64(duration));
    }
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

#[crate::shim::command]
pub fn native_audio_play(state: State<'_, NativeAudioState>) -> Result<(), String> {
    let _guard = state.op_lock.lock().map_err(|e| e.to_string())?;
    state.send(Command::Play)
}
#[crate::shim::command]
pub fn native_audio_pause(state: State<'_, NativeAudioState>) -> Result<(), String> {
    let _guard = state.op_lock.lock().map_err(|e| e.to_string())?;
    state.send(Command::Pause)
}
#[crate::shim::command]
pub fn native_audio_seek(seconds: f64, state: State<'_, NativeAudioState>) -> Result<(), String> {
    let _guard = state.op_lock.lock().map_err(|e| e.to_string())?;
    state.send(Command::Seek(seconds))
}
#[crate::shim::command]
pub fn native_audio_set_speed(
    speed: f32,
    state: State<'_, NativeAudioState>,
) -> Result<(), String> {
    let _guard = state.op_lock.lock().map_err(|e| e.to_string())?;
    state.send(Command::Speed(speed))
}
#[crate::shim::command]
pub fn native_audio_stop(state: State<'_, NativeAudioState>) -> Result<(), String> {
    let _guard = state.op_lock.lock().map_err(|e| e.to_string())?;
    if let Some(session) = state.session.lock().map_err(|e| e.to_string())?.take() {
        let _ = session.commands.send(Command::Stop);
    }
    *state.snapshot.lock().map_err(|e| e.to_string())? = NativeAudioSnapshot::default();
    Ok(())
}
#[crate::shim::command]
pub fn native_audio_snapshot(
    state: State<'_, NativeAudioState>,
) -> Result<NativeAudioSnapshot, String> {
    let _guard = state.op_lock.lock().map_err(|e| e.to_string())?;
    state
        .snapshot
        .lock()
        .map(|s| s.clone())
        .map_err(|e| e.to_string())
}
