#![cfg(target_os = "linux")]

use rodio::{ChannelCount, Decoder, SampleRate, Source};
use std::ffi::{c_char, c_int, c_void, CString};
use std::fs::File;
use std::path::Path;
use std::sync::{Arc, Once};
use std::time::Duration;

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
    _gst: libloading::Library,
    _gst_app: libloading::Library,
    _gobject: libloading::Library,
    set_state: SetStateFn,
    seek_simple: SeekSimpleFn,
    pull_sample: PullSampleFn,
    sample_get_buffer: SampleGetBufferFn,
    buffer_map: BufferMapFn,
    buffer_unmap: BufferUnmapFn,
    sample_unref: UnrefFn,
    object_unref: UnrefFn,
}

pub(crate) struct GstreamerDecoder {
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
        use libloading::Library;
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
        if first_buffer.is_null() || unsafe { buffer_map(first_buffer, &mut first_map, 1) } == 0 {
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
            if let Ok(decoder) = Decoder::try_from(File::open(path).map_err(|e| e.to_string())?) {
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
