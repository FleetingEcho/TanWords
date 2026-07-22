use rodio::{Decoder, Source};
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::State;

type FileDecoder = Decoder<BufReader<File>>;

pub struct DecodedTrack {
    decoder: FileDecoder,
}

impl DecodedTrack {
    pub fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        Ok(Self {
            decoder: Decoder::try_from(file).map_err(|e| e.to_string())?,
        })
    }
    pub fn read_samples(&mut self, count: usize) -> Vec<f32> {
        self.decoder.by_ref().take(count).collect()
    }
    pub fn seek(&mut self, position: Duration) -> Result<(), String> {
        self.decoder.try_seek(position).map_err(|e| e.to_string())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioSnapshot {
    status: &'static str,
    position_sec: f64,
    duration_sec: f64,
    speed: f32,
    error: Option<String>,
    generation: u64,
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

enum Command {
    Play,
    Pause,
    Seek(f64),
    Speed(f32),
    Stop,
}
struct Session {
    commands: mpsc::Sender<Command>,
}

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

#[cfg(target_os = "linux")]
mod pulse {
    use libloading::Library;
    use std::ffi::{c_char, c_int, c_void, CString};

    #[repr(C)]
    struct SampleSpec {
        format: i32,
        rate: u32,
        channels: u8,
    }
    type NewFn = unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        i32,
        *const c_char,
        *const c_char,
        *const SampleSpec,
        *const c_void,
        *const c_void,
        *mut c_int,
    ) -> *mut c_void;
    type WriteFn = unsafe extern "C" fn(*mut c_void, *const c_void, usize, *mut c_int) -> c_int;
    type OpFn = unsafe extern "C" fn(*mut c_void, *mut c_int) -> c_int;
    type LatencyFn = unsafe extern "C" fn(*mut c_void, *mut c_int) -> u64;
    type FreeFn = unsafe extern "C" fn(*mut c_void);

    pub struct Output {
        _library: Library,
        handle: *mut c_void,
        write: WriteFn,
        flush: OpFn,
        drain: OpFn,
        latency: LatencyFn,
        free: FreeFn,
    }
    unsafe impl Send for Output {}

    impl Output {
        pub fn open(rate: u32, channels: u16) -> Result<Self, String> {
            let library =
                unsafe { Library::new("libpulse-simple.so.0") }.map_err(|e| e.to_string())?;
            let new: NewFn =
                unsafe { *library.get(b"pa_simple_new\0").map_err(|e| e.to_string())? };
            let write = unsafe {
                *library
                    .get(b"pa_simple_write\0")
                    .map_err(|e| e.to_string())?
            };
            let flush = unsafe {
                *library
                    .get(b"pa_simple_flush\0")
                    .map_err(|e| e.to_string())?
            };
            let drain = unsafe {
                *library
                    .get(b"pa_simple_drain\0")
                    .map_err(|e| e.to_string())?
            };
            let latency = unsafe {
                *library
                    .get(b"pa_simple_get_latency\0")
                    .map_err(|e| e.to_string())?
            };
            let free = unsafe {
                *library
                    .get(b"pa_simple_free\0")
                    .map_err(|e| e.to_string())?
            };
            let name = CString::new("TanWords").unwrap();
            let stream = CString::new("Local music").unwrap();
            let spec = SampleSpec {
                format: 5,
                rate,
                channels: channels as u8,
            }; // PA_SAMPLE_FLOAT32LE
            let mut error = 0;
            let handle = unsafe {
                new(
                    std::ptr::null(),
                    name.as_ptr(),
                    1,
                    std::ptr::null(),
                    stream.as_ptr(),
                    &spec,
                    std::ptr::null(),
                    std::ptr::null(),
                    &mut error,
                )
            };
            if handle.is_null() {
                return Err(format!("PulseAudio open failed ({error})"));
            }
            Ok(Self {
                _library: library,
                handle,
                write,
                flush,
                drain,
                latency,
                free,
            })
        }
        pub fn write(&mut self, samples: &[f32]) -> Result<(), String> {
            let mut error = 0;
            let result = unsafe {
                (self.write)(
                    self.handle,
                    samples.as_ptr().cast(),
                    std::mem::size_of_val(samples),
                    &mut error,
                )
            };
            if result < 0 {
                Err(format!("PulseAudio write failed ({error})"))
            } else {
                Ok(())
            }
        }
        pub fn flush(&mut self) {
            let mut e = 0;
            unsafe {
                (self.flush)(self.handle, &mut e);
            }
        }
        pub fn drain(&mut self) {
            let mut e = 0;
            unsafe {
                (self.drain)(self.handle, &mut e);
            }
        }
        pub fn latency_sec(&mut self) -> f64 {
            let mut error = 0;
            unsafe { (self.latency)(self.handle, &mut error) as f64 / 1_000_000.0 }
        }
    }
    impl Drop for Output {
        fn drop(&mut self) {
            unsafe {
                (self.free)(self.handle);
            }
        }
    }
}

fn open_decoder(path: &Path) -> Result<FileDecoder, String> {
    Decoder::try_from(File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
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

#[cfg(target_os = "linux")]
fn playback_worker(
    mut decoder: FileDecoder,
    rate: u32,
    channels: u16,
    mut playing: bool,
    generation: u64,
    snapshot: Arc<Mutex<NativeAudioSnapshot>>,
    commands: mpsc::Receiver<Command>,
) {
    let mut output = match pulse::Output::open(rate, channels) {
        Ok(v) => v,
        Err(e) => {
            set_error(&snapshot, e);
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
                    let audible = (frames as f64 / rate as f64 - output.latency_sec()).max(0.0);
                    output.flush();
                    if let Err(e) = decoder.try_seek(Duration::from_secs_f64(audible)) {
                        set_error(&snapshot, e.to_string());
                        return;
                    }
                    frames = (audible * rate as f64) as u64;
                    playing = false;
                }
                Command::Seek(seconds) => {
                    let target = seconds.max(0.0);
                    output.flush();
                    if let Err(e) = decoder.try_seek(Duration::from_secs_f64(target)) {
                        set_error(&snapshot, e.to_string());
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
            s.position_sec = (frames as f64 / rate as f64 - output.latency_sec()).max(0.0);
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
                s.status = "ended";
                s.position_sec = s.duration_sec;
            }
            return;
        }
        let input_frames = input.len() / channels as usize;
        let rendered = resample_speed(&input, channels as usize, speed);
        if let Err(e) = output.write(&rendered) {
            set_error(&snapshot, e);
            return;
        }
        frames += input_frames as u64;
    }
}

fn resample_speed(input: &[f32], channels: usize, speed: f32) -> Vec<f32> {
    if (speed - 1.0).abs() < f32::EPSILON {
        return input.to_vec();
    }
    let frames = input.len() / channels;
    let out_frames = (frames as f32 / speed) as usize;
    let mut output = Vec::with_capacity(out_frames * channels);
    for frame in 0..out_frames {
        let source = ((frame as f32 * speed) as usize).min(frames - 1);
        output.extend_from_slice(&input[source * channels..(source + 1) * channels]);
    }
    output
}

fn set_error(snapshot: &Arc<Mutex<NativeAudioSnapshot>>, error: String) {
    if let Ok(mut s) = snapshot.lock() {
        s.status = "error";
        s.error = Some(error);
    }
}

#[cfg(not(target_os = "linux"))]
fn playback_worker(
    _: FileDecoder,
    _: u32,
    _: u16,
    _: bool,
    _: u64,
    snapshot: Arc<Mutex<NativeAudioSnapshot>>,
    _: mpsc::Receiver<Command>,
) {
    set_error(
        &snapshot,
        "native local playback is only enabled on Linux".into(),
    );
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seek_to_zero_replays_the_same_initial_pcm() {
        let path = Path::new("/home/zteng/work/Tools/Music_JayZhou/busy/周杰伦 - 青花瓷.mp3");
        if !path.exists() {
            return;
        }
        let mut track = DecodedTrack::open(path).unwrap();
        let initial = track.read_samples(4096);
        track.seek(Duration::ZERO).unwrap();
        assert_eq!(track.read_samples(4096), initial);
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires a running PulseAudio/PipeWire session"]
    fn native_output_accepts_pcm() {
        let mut output = pulse::Output::open(44_100, 2).unwrap();
        output.write(&vec![0.0; 4_410 * 2]).unwrap();
        output.flush();
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "plays a real local fixture through PipeWire"]
    fn live_seek_to_zero_resets_the_authoritative_clock() {
        let path = Path::new("/home/zteng/work/Tools/Music_JayZhou/busy/周杰伦 - 青花瓷.mp3");
        if !path.exists() {
            return;
        }
        let decoder = open_decoder(path).unwrap();
        let rate = decoder.sample_rate().get();
        let channels = decoder.channels().get();
        let snapshot = Arc::new(Mutex::new(NativeAudioSnapshot {
            status: "playing",
            generation: 1,
            ..NativeAudioSnapshot::default()
        }));
        let (tx, rx) = mpsc::channel();
        let shared = snapshot.clone();
        let worker = std::thread::spawn(move || {
            playback_worker(decoder, rate, channels, true, 1, shared, rx)
        });
        std::thread::sleep(Duration::from_millis(350));
        tx.send(Command::Seek(0.0)).unwrap();
        std::thread::sleep(Duration::from_millis(250));

        assert!(snapshot.lock().unwrap().position_sec < 1.0);
        tx.send(Command::Stop).unwrap();
        worker.join().unwrap();
    }
}
