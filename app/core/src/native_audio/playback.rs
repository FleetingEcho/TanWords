#[cfg(target_os = "linux")]
use rodio::Source;
use serde::Serialize;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use super::decoder::FileDecoder;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioSnapshot {
    pub(super) status: &'static str,
    pub(super) position_sec: f64,
    pub(super) duration_sec: f64,
    pub(super) speed: f32,
    pub(super) error: Option<String>,
    pub(super) generation: u64,
}

impl Default for NativeAudioSnapshot {
    fn default() -> Self {
        Self {
            status: "idle",
            position_sec: 0.0,
            duration_sec: 0.0,
            speed: 1.0,
            error: None,
            generation: 0,
        }
    }
}

pub(super) enum Command {
    Play,
    Pause,
    Seek(f64),
    Speed(f32),
    Stop,
}

pub(super) struct Session {
    pub(super) commands: mpsc::Sender<Command>,
}

#[cfg(target_os = "linux")]
pub(super) fn playback_worker(
    mut decoder: FileDecoder,
    rate: u32,
    channels: u16,
    mut playing: bool,
    generation: u64,
    snapshot: Arc<Mutex<NativeAudioSnapshot>>,
    commands: mpsc::Receiver<Command>,
) {
    if rate == 0 || channels == 0 {
        set_error(&snapshot, "unsupported audio format".to_string(), generation);
        return;
    }
    let mut output = match super::pulse::Output::open(rate, channels) {
        Ok(v) => v,
        Err(e) => {
            set_error(&snapshot, e, generation);
            return;
        }
    };
    let mut frames = 0u64;
    let mut speed = 1.0f32;
    loop {
        while let Ok(command) = commands.try_recv() {
            match command {
                Command::Play => playing = true,
                Command::Pause => {
                    // latency_sec() is WALL-clock time of buffered output, but
                    // frames/rate is SOURCE time — at speed s the buffered wall
                    // time corresponds to latency*s of source. Without the
                    // factor, pausing at 2x re-seeks ~latency seconds PAST what
                    // was heard (skipped audio on resume); at 0.5x it repeats.
                    let audible = (frames as f64 / rate as f64 - output.latency_sec() * speed as f64).max(0.0);
                    output.flush();
                    if let Err(e) = decoder.try_seek(Duration::from_secs_f64(audible)) {
                        set_error(&snapshot, e.to_string(), generation);
                        return;
                    }
                    frames = (audible * rate as f64) as u64;
                    playing = false;
                }
                Command::Seek(seconds) => {
                    let target = seconds.max(0.0);
                    output.flush();
                    if let Err(e) = decoder.try_seek(Duration::from_secs_f64(target)) {
                        set_error(&snapshot, e.to_string(), generation);
                        return;
                    }
                    frames = (target * rate as f64) as u64;
                }
                Command::Speed(value) => speed = value.clamp(0.5, 2.0),
                Command::Stop => {
                    output.flush();
                    return;
                }
            }
        }
        if let Ok(mut s) = snapshot.lock() {
            if s.generation != generation {
                return;
            }
            s.status = if playing { "playing" } else { "paused" };
            s.position_sec = (frames as f64 / rate as f64 - output.latency_sec() * speed as f64).max(0.0);
            s.speed = speed;
        }
        if !playing {
            std::thread::sleep(Duration::from_millis(20));
            continue;
        }
        let input: Vec<f32> = decoder.by_ref().take(4096 * channels as usize).collect();
        if input.is_empty() {
            output.drain();
            if let Ok(mut s) = snapshot.lock() {
                // A superseded worker must not stamp "ended" onto the NEW
                // track's snapshot — the rodio worker guards every write with
                // the generation check; this path raced it on track switch.
                if s.generation == generation {
                    s.status = "ended";
                    s.position_sec = s.duration_sec;
                }
            }
            return;
        }
        let input_frames = input.len() / channels as usize;
        let rendered = resample_speed(&input, channels as usize, speed);
        if let Err(e) = output.write(&rendered) {
            set_error(&snapshot, e, generation);
            return;
        }
        frames += input_frames as u64;
    }
}

#[cfg(target_os = "linux")]
fn resample_speed(input: &[f32], channels: usize, speed: f32) -> Vec<f32> {
    if channels == 0 {
        return Vec::new();
    }
    if (speed - 1.0).abs() < f32::EPSILON {
        return input.to_vec();
    }
    let frames = input.len() / channels;
    if frames == 0 {
        return Vec::new();
    }
    let out_frames = (frames as f32 / speed) as usize;
    let mut output = Vec::with_capacity(out_frames * channels);
    for frame in 0..out_frames {
        let source = ((frame as f32 * speed) as usize).min(frames - 1);
        output.extend_from_slice(&input[source * channels..(source + 1) * channels]);
    }
    output
}

pub(super) fn set_error(snapshot: &Arc<Mutex<NativeAudioSnapshot>>, error: String, generation: u64) {
    if let Ok(mut s) = snapshot.lock() {
        // A superseded worker (old track) may fail asynchronously; its error
        // must not brand the new track's running snapshot.
        if s.generation != generation {
            return;
        }
        s.status = "error";
        s.error = Some(error);
    }
}

#[cfg(not(target_os = "linux"))]
pub(super) fn playback_worker(
    decoder: FileDecoder,
    _: u32,
    _: u16,
    autoplay: bool,
    generation: u64,
    snapshot: Arc<Mutex<NativeAudioSnapshot>>,
    commands: mpsc::Receiver<Command>,
) {
    let output = match rodio::DeviceSinkBuilder::open_default_sink() {
        Ok(value) => value,
        Err(error) => {
            set_error(&snapshot, error.to_string(), generation);
            return;
        }
    };
    let player = rodio::Player::connect_new(output.mixer());
    player.append(decoder);
    if !autoplay {
        player.pause();
    }

    loop {
        match commands.recv_timeout(Duration::from_millis(20)) {
            Ok(Command::Play) => player.play(),
            Ok(Command::Pause) => player.pause(),
            Ok(Command::Seek(seconds)) => {
                if let Err(error) = player.try_seek(Duration::from_secs_f64(seconds.max(0.0))) {
                    set_error(&snapshot, error.to_string(), generation);
                    return;
                }
            }
            Ok(Command::Speed(value)) => player.set_speed(value.clamp(0.5, 2.0)),
            Ok(Command::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                player.stop();
                return;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        if let Ok(mut current) = snapshot.lock() {
            if current.generation != generation {
                return;
            }
            current.status = if player.empty() {
                "ended"
            } else if player.is_paused() {
                "paused"
            } else {
                "playing"
            };
            current.position_sec = player.get_pos().as_secs_f64();
            current.speed = player.speed();
        }
        if player.empty() {
            return;
        }
    }
}
