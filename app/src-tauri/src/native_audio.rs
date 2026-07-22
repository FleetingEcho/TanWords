use rodio::{ChannelCount, Decoder, SampleRate, Source};
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::State;

type RodioDecoder = Decoder<BufReader<File>>;

enum FileDecoder {
    Rodio(RodioDecoder),
    #[cfg(target_os = "linux")]
    Gstreamer(gstreamer_decoder::GstreamerDecoder),
}

impl Iterator for FileDecoder {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::Rodio(decoder) => decoder.next(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.next(),
        }
    }
}

impl Source for FileDecoder {
    fn current_span_len(&self) -> Option<usize> {
        match self {
            Self::Rodio(decoder) => decoder.current_span_len(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.current_span_len(),
        }
    }

    fn channels(&self) -> ChannelCount {
        match self {
            Self::Rodio(decoder) => decoder.channels(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.channels(),
        }
    }

    fn sample_rate(&self) -> SampleRate {
        match self {
            Self::Rodio(decoder) => decoder.sample_rate(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.sample_rate(),
        }
    }

    fn total_duration(&self) -> Option<Duration> {
        match self {
            Self::Rodio(decoder) => decoder.total_duration(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.total_duration(),
        }
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        match self {
            Self::Rodio(decoder) => decoder.try_seek(position),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.try_seek(position),
        }
    }
}

pub struct DecodedTrack {
    decoder: FileDecoder,
}

impl DecodedTrack {
    pub fn open(path: &Path) -> Result<Self, String> {
        Ok(Self {
            decoder: open_decoder(path)?,
        })
    }
    pub fn read_samples(&mut self, count: usize) -> Vec<f32> {
        self.decoder.by_ref().take(count).collect()
    }
    pub fn seek(&mut self, position: Duration) -> Result<(), String> {
        self.decoder.try_seek(position).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "linux")]
mod gstreamer_decoder {
    use super::*;
    use libloading::Library;
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::sync::Once;

    type GstElement = c_void;
    type GstSample = c_void;
    type GstBuffer = c_void;

    #[repr(C)]
    struct GstMapInfo {
        memory: *mut c_void,
        flags: u32,
        data: *mut u8,
        size: usize,
        maxsize: usize,
        user_data: [*mut c_void; 4],
        reserved: [*mut c_void; 4],
    }

    type InitFn = unsafe extern "C" fn(*mut c_int, *mut *mut *mut c_char);
    type ParseLaunchFn = unsafe extern "C" fn(*const c_char, *mut *mut c_void) -> *mut GstElement;
    type BinGetByNameFn = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut GstElement;
    type SetStateFn = unsafe extern "C" fn(*mut GstElement, c_int) -> c_int;
    type GetStateFn = unsafe extern "C" fn(*mut GstElement, *mut c_int, *mut c_int, u64) -> c_int;
    type QueryDurationFn = unsafe extern "C" fn(*mut GstElement, c_int, *mut i64) -> c_int;
    type SeekSimpleFn = unsafe extern "C" fn(*mut GstElement, c_int, u32, i64) -> c_int;
    type PullSampleFn = unsafe extern "C" fn(*mut GstElement) -> *mut GstSample;
    type SampleGetBufferFn = unsafe extern "C" fn(*mut GstSample) -> *mut GstBuffer;
    type BufferMapFn = unsafe extern "C" fn(*mut GstBuffer, *mut GstMapInfo, u32) -> c_int;
    type BufferUnmapFn = unsafe extern "C" fn(*mut GstBuffer, *mut GstMapInfo);
    type UnrefFn = unsafe extern "C" fn(*mut c_void);

    struct Api {
        _gst: Library,
        _gst_app: Library,
        _gobject: Library,
        set_state: SetStateFn,
        seek_simple: SeekSimpleFn,
        pull_sample: PullSampleFn,
        sample_get_buffer: SampleGetBufferFn,
        buffer_map: BufferMapFn,
        buffer_unmap: BufferUnmapFn,
        sample_unref: UnrefFn,
        object_unref: UnrefFn,
    }

    pub struct GstreamerDecoder {
        api: Api,
        pipeline: *mut GstElement,
        sink: *mut GstElement,
        samples: Vec<f32>,
        offset: usize,
        duration: Duration,
    }

    unsafe impl Send for GstreamerDecoder {}

    impl GstreamerDecoder {
        pub fn open(path: &Path) -> Result<Self, String> {
            let gst = unsafe { Library::new("libgstreamer-1.0.so.0") }
                .map_err(|e| format!("GStreamer runtime unavailable: {e}"))?;
            let gst_app = unsafe { Library::new("libgstapp-1.0.so.0") }
                .map_err(|e| format!("GStreamer appsink unavailable: {e}"))?;
            let gobject = unsafe { Library::new("libgobject-2.0.so.0") }
                .map_err(|e| format!("GObject runtime unavailable: {e}"))?;
            let init: InitFn = unsafe { *gst.get(b"gst_init\0").map_err(|e| e.to_string())? };
            let parse_launch: ParseLaunchFn =
                unsafe { *gst.get(b"gst_parse_launch\0").map_err(|e| e.to_string())? };
            let bin_get_by_name: BinGetByNameFn = unsafe {
                *gst.get(b"gst_bin_get_by_name\0")
                    .map_err(|e| e.to_string())?
            };
            let set_state: SetStateFn = unsafe {
                *gst.get(b"gst_element_set_state\0")
                    .map_err(|e| e.to_string())?
            };
            let get_state: GetStateFn = unsafe {
                *gst.get(b"gst_element_get_state\0")
                    .map_err(|e| e.to_string())?
            };
            let query_duration: QueryDurationFn = unsafe {
                *gst.get(b"gst_element_query_duration\0")
                    .map_err(|e| e.to_string())?
            };
            let seek_simple: SeekSimpleFn = unsafe {
                *gst.get(b"gst_element_seek_simple\0")
                    .map_err(|e| e.to_string())?
            };
            let sample_get_buffer: SampleGetBufferFn = unsafe {
                *gst.get(b"gst_sample_get_buffer\0")
                    .map_err(|e| e.to_string())?
            };
            let buffer_map: BufferMapFn =
                unsafe { *gst.get(b"gst_buffer_map\0").map_err(|e| e.to_string())? };
            let buffer_unmap: BufferUnmapFn =
                unsafe { *gst.get(b"gst_buffer_unmap\0").map_err(|e| e.to_string())? };
            let pull_sample: PullSampleFn = unsafe {
                *gst_app
                    .get(b"gst_app_sink_pull_sample\0")
                    .map_err(|e| e.to_string())?
            };
            let sample_unref: UnrefFn = unsafe {
                *gst.get(b"gst_mini_object_unref\0")
                    .map_err(|e| e.to_string())?
            };
            let object_unref: UnrefFn = unsafe {
                *gobject
                    .get(b"g_object_unref\0")
                    .map_err(|e| e.to_string())?
            };
            static GST_INIT: Once = Once::new();
            GST_INIT.call_once(|| unsafe { init(std::ptr::null_mut(), std::ptr::null_mut()) });
            let location = path
                .to_string_lossy()
                .replace('\\', "\\\\")
                .replace('"', "\\\"");
            let description = CString::new(format!(
                "filesrc location=\"{location}\" ! decodebin ! audioconvert ! audioresample ! \
                 audio/x-raw,format=F32LE,layout=interleaved,channels=2,rate=44100 ! \
                 appsink name=tanwords_sink sync=false max-buffers=2"
            ))
            .map_err(|e| e.to_string())?;
            let pipeline = unsafe { parse_launch(description.as_ptr(), std::ptr::null_mut()) };
            if pipeline.is_null() {
                return Err("GStreamer could not create the MP3 pipeline".into());
            }
            let sink_name = CString::new("tanwords_sink").unwrap();
            let sink = unsafe { bin_get_by_name(pipeline, sink_name.as_ptr()) };
            if sink.is_null() {
                unsafe { object_unref(pipeline) };
                return Err("GStreamer appsink is missing".into());
            }
            const GST_STATE_PLAYING: c_int = 4;
            if unsafe { set_state(pipeline, GST_STATE_PLAYING) } == 0 {
                unsafe {
                    object_unref(sink);
                    object_unref(pipeline);
                }
                return Err("GStreamer failed to start MP3 decoding".into());
            }
            let mut state = 0;
            let mut pending = 0;
            unsafe { get_state(pipeline, &mut state, &mut pending, 5_000_000_000) };

            // Some MP3 demuxers only expose duration after the first decoded buffer.
            // Preserve that preroll buffer so querying metadata never skips audible PCM.
            let first_sample = unsafe { pull_sample(sink) };
            if first_sample.is_null() {
                unsafe {
                    set_state(pipeline, 1);
                    object_unref(sink);
                    object_unref(pipeline);
                }
                return Err("GStreamer produced no MP3 audio".into());
            }
            let first_buffer = unsafe { sample_get_buffer(first_sample) };
            let mut first_map: GstMapInfo = unsafe { std::mem::zeroed() };
            if first_buffer.is_null() || unsafe { buffer_map(first_buffer, &mut first_map, 1) } == 0
            {
                unsafe {
                    sample_unref(first_sample);
                    set_state(pipeline, 1);
                    object_unref(sink);
                    object_unref(pipeline);
                }
                return Err("GStreamer could not read decoded MP3 audio".into());
            }
            let first_bytes = unsafe { std::slice::from_raw_parts(first_map.data, first_map.size) };
            let first_samples = first_bytes
                .chunks_exact(4)
                .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
                .collect();
            unsafe {
                buffer_unmap(first_buffer, &mut first_map);
                sample_unref(first_sample);
            }

            const GST_FORMAT_TIME: c_int = 3;
            let mut duration_ns = 0i64;
            let mut has_duration = false;
            for _ in 0..100 {
                if unsafe { query_duration(pipeline, GST_FORMAT_TIME, &mut duration_ns) } != 0
                    && duration_ns > 0
                {
                    has_duration = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            if !has_duration {
                if let Ok(decoder) = Decoder::try_from(File::open(path).map_err(|e| e.to_string())?)
                {
                    if let Some(duration) = decoder.total_duration() {
                        duration_ns = duration.as_nanos().min(i64::MAX as u128) as i64;
                        has_duration = duration_ns > 0;
                    }
                }
            }
            if !has_duration {
                unsafe {
                    set_state(pipeline, 1);
                    object_unref(sink);
                    object_unref(pipeline);
                }
                return Err("GStreamer could not determine audio duration".into());
            }

            Ok(Self {
                api: Api {
                    _gst: gst,
                    _gst_app: gst_app,
                    _gobject: gobject,
                    set_state,
                    seek_simple,
                    pull_sample,
                    sample_get_buffer,
                    buffer_map,
                    buffer_unmap,
                    sample_unref,
                    object_unref,
                },
                pipeline,
                sink,
                samples: first_samples,
                offset: 0,
                duration: Duration::from_nanos(duration_ns as u64),
            })
        }

        fn refill(&mut self) -> Option<()> {
            let sample = unsafe { (self.api.pull_sample)(self.sink) };
            if sample.is_null() {
                return None;
            }
            let buffer = unsafe { (self.api.sample_get_buffer)(sample) };
            let mut map: GstMapInfo = unsafe { std::mem::zeroed() };
            if buffer.is_null() || unsafe { (self.api.buffer_map)(buffer, &mut map, 1) } == 0 {
                unsafe { (self.api.sample_unref)(sample) };
                return None;
            }
            self.samples.clear();
            let bytes = unsafe { std::slice::from_raw_parts(map.data, map.size) };
            self.samples.extend(
                bytes
                    .chunks_exact(4)
                    .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())),
            );
            unsafe {
                (self.api.buffer_unmap)(buffer, &mut map);
                (self.api.sample_unref)(sample);
            }
            self.offset = 0;
            Some(())
        }
    }

    impl Iterator for GstreamerDecoder {
        type Item = f32;

        fn next(&mut self) -> Option<Self::Item> {
            if self.offset >= self.samples.len() {
                self.refill()?;
            }
            let sample = self.samples[self.offset];
            self.offset += 1;
            Some(sample)
        }
    }

    impl Source for GstreamerDecoder {
        fn current_span_len(&self) -> Option<usize> {
            Some(self.samples.len().saturating_sub(self.offset))
        }

        fn channels(&self) -> ChannelCount {
            ChannelCount::new(2).unwrap()
        }

        fn sample_rate(&self) -> SampleRate {
            SampleRate::new(44_100).unwrap()
        }

        fn total_duration(&self) -> Option<Duration> {
            Some(self.duration)
        }

        fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
            const GST_FORMAT_TIME: c_int = 3;
            const GST_SEEK_FLAG_FLUSH_ACCURATE: u32 = 1 | 2;
            let position_ns = position.as_nanos().min(i64::MAX as u128) as i64;
            if unsafe {
                (self.api.seek_simple)(
                    self.pipeline,
                    GST_FORMAT_TIME,
                    GST_SEEK_FLAG_FLUSH_ACCURATE,
                    position_ns,
                )
            } == 0
            {
                return Err(rodio::source::SeekError::Other(Arc::new(
                    std::io::Error::other("GStreamer seek failed"),
                )));
            }
            self.samples.clear();
            self.offset = 0;
            Ok(())
        }
    }

    impl Drop for GstreamerDecoder {
        fn drop(&mut self) {
            unsafe {
                (self.api.set_state)(self.pipeline, 1);
                (self.api.object_unref)(self.sink);
                (self.api.object_unref)(self.pipeline);
            }
        }
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
    #[cfg(target_os = "linux")]
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"))
    {
        return gstreamer_decoder::GstreamerDecoder::open(path).map(FileDecoder::Gstreamer);
    }

    Decoder::try_from(File::open(path).map_err(|e| e.to_string())?)
        .map(FileDecoder::Rodio)
        .map_err(|e| e.to_string())
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

#[cfg(target_os = "linux")]
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
            set_error(&snapshot, error.to_string());
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
                    set_error(&snapshot, error.to_string());
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
    fn decodes_complete_mp3_across_corrupt_frame_boundary() {
        let path = Path::new(
            "/home/zteng/work/Tools/Music_JayZhou/周杰伦 - 你听得到 - 2004无与伦比演唱会.mp3",
        );
        if !path.exists() {
            return;
        }

        let decoder = open_decoder(path).unwrap();
        let duration = decoder.total_duration().unwrap().as_secs_f64();
        let rate = decoder.sample_rate().get() as f64;
        let channels = decoder.channels().get() as f64;
        let decoded_seconds = decoder.count() as f64 / rate / channels;

        assert!(
            (228.0..=230.0).contains(&duration),
            "duration={duration:.3}"
        );
        assert!(
            (228.0..=230.0).contains(&decoded_seconds),
            "decoded_seconds={decoded_seconds:.3}"
        );

        let mut late = DecodedTrack::open(path).unwrap();
        late.seek(Duration::from_secs(220)).unwrap();
        assert_eq!(late.read_samples(4096).len(), 4096);
    }

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
