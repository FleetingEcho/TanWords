#![cfg(target_os = "macos")]

// rodio's Symphonia-based MP3 decoder can lose sync at a bad frame boundary
// partway through certain files and stop decoding there, even though the
// bitstream is complete and valid to the real end of the file (see the
// `coreaudio_decodes_complete_mp3_across_corrupt_frame_boundary` test).
// ExtAudioFile is the same system decoder QuickTime/Music.app use and does
// not have that failure mode, so MP3s are routed through it on macOS —
// mirroring the GStreamer bridge used for the same reason on Linux.

use rodio::{ChannelCount, SampleRate, Source};
use std::ffi::c_void;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

type OSStatus = i32;
type Boolean = u8;
type CFAllocatorRef = *const c_void;
type CFURLRef = *mut c_void;
type ExtAudioFileRef = *mut c_void;
type ExtAudioFilePropertyId = u32;
type AudioFormatId = u32;
type AudioFormatFlags = u32;

#[repr(C)]
#[derive(Clone, Copy)]
struct AudioStreamBasicDescription {
    sample_rate: f64,
    format_id: AudioFormatId,
    format_flags: AudioFormatFlags,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
    reserved: u32,
}

#[repr(C)]
struct AudioBuffer {
    number_channels: u32,
    data_byte_size: u32,
    data: *mut c_void,
}

#[repr(C)]
struct AudioBufferList {
    number_buffers: u32,
    buffers: [AudioBuffer; 1],
}

const fn fourcc(s: &[u8; 4]) -> u32 {
    ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
}

const K_AUDIO_FORMAT_LINEAR_PCM: AudioFormatId = fourcc(b"lpcm");
const K_LINEAR_PCM_FORMAT_FLAG_IS_FLOAT: AudioFormatFlags = 1 << 0;
const K_LINEAR_PCM_FORMAT_FLAG_IS_PACKED: AudioFormatFlags = 1 << 3;
const K_PROP_FILE_DATA_FORMAT: ExtAudioFilePropertyId = fourcc(b"ffmt");
const K_PROP_CLIENT_DATA_FORMAT: ExtAudioFilePropertyId = fourcc(b"cfmt");
const K_PROP_FILE_LENGTH_FRAMES: ExtAudioFilePropertyId = fourcc(b"#frm");

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFURLCreateFromFileSystemRepresentation(
        allocator: CFAllocatorRef,
        buffer: *const u8,
        buf_len: isize,
        is_directory: Boolean,
    ) -> CFURLRef;
    fn CFRelease(cf: *const c_void);
}

#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    fn ExtAudioFileOpenURL(url: CFURLRef, out_file: *mut ExtAudioFileRef) -> OSStatus;
    fn ExtAudioFileDispose(file: ExtAudioFileRef) -> OSStatus;
    fn ExtAudioFileGetProperty(
        file: ExtAudioFileRef,
        property_id: ExtAudioFilePropertyId,
        io_size: *mut u32,
        out_data: *mut c_void,
    ) -> OSStatus;
    fn ExtAudioFileSetProperty(
        file: ExtAudioFileRef,
        property_id: ExtAudioFilePropertyId,
        size: u32,
        data: *const c_void,
    ) -> OSStatus;
    fn ExtAudioFileRead(
        file: ExtAudioFileRef,
        io_number_frames: *mut u32,
        io_data: *mut AudioBufferList,
    ) -> OSStatus;
    fn ExtAudioFileSeek(file: ExtAudioFileRef, frame_offset: i64) -> OSStatus;
}

pub(crate) struct CoreAudioDecoder {
    file: ExtAudioFileRef,
    channels: u16,
    sample_rate: u32,
    total_frames: i64,
    buffer: Vec<f32>,
    offset: usize,
    finished: bool,
}

unsafe impl Send for CoreAudioDecoder {}

const READ_FRAMES: u32 = 4096;

impl CoreAudioDecoder {
    pub fn open(path: &Path) -> Result<Self, String> {
        let path_bytes = path.as_os_str().as_bytes();
        let url = unsafe {
            CFURLCreateFromFileSystemRepresentation(
                std::ptr::null(),
                path_bytes.as_ptr(),
                path_bytes.len() as isize,
                0,
            )
        };
        if url.is_null() {
            return Err("could not build a file URL for ExtAudioFile".into());
        }

        let mut file: ExtAudioFileRef = std::ptr::null_mut();
        let status = unsafe { ExtAudioFileOpenURL(url, &mut file) };
        unsafe { CFRelease(url) };
        if status != 0 || file.is_null() {
            return Err(format!("ExtAudioFileOpenURL failed ({status})"));
        }

        let mut file_format = AudioStreamBasicDescription {
            sample_rate: 0.0,
            format_id: 0,
            format_flags: 0,
            bytes_per_packet: 0,
            frames_per_packet: 0,
            bytes_per_frame: 0,
            channels_per_frame: 0,
            bits_per_channel: 0,
            reserved: 0,
        };
        let mut size = std::mem::size_of::<AudioStreamBasicDescription>() as u32;
        let status = unsafe {
            ExtAudioFileGetProperty(
                file,
                K_PROP_FILE_DATA_FORMAT,
                &mut size,
                (&mut file_format as *mut AudioStreamBasicDescription).cast(),
            )
        };
        if status != 0 || file_format.channels_per_frame == 0 || file_format.sample_rate <= 0.0 {
            unsafe { ExtAudioFileDispose(file) };
            return Err(format!("could not read the source audio format ({status})"));
        }

        let channels = file_format.channels_per_frame;
        let sample_rate = file_format.sample_rate;

        let client_format = AudioStreamBasicDescription {
            sample_rate,
            format_id: K_AUDIO_FORMAT_LINEAR_PCM,
            format_flags: K_LINEAR_PCM_FORMAT_FLAG_IS_FLOAT | K_LINEAR_PCM_FORMAT_FLAG_IS_PACKED,
            bytes_per_packet: 4 * channels,
            frames_per_packet: 1,
            bytes_per_frame: 4 * channels,
            channels_per_frame: channels,
            bits_per_channel: 32,
            reserved: 0,
        };
        let status = unsafe {
            ExtAudioFileSetProperty(
                file,
                K_PROP_CLIENT_DATA_FORMAT,
                std::mem::size_of::<AudioStreamBasicDescription>() as u32,
                (&client_format as *const AudioStreamBasicDescription).cast(),
            )
        };
        if status != 0 {
            unsafe { ExtAudioFileDispose(file) };
            return Err(format!("could not configure a PCM output format ({status})"));
        }

        let mut total_frames: i64 = 0;
        let mut size = std::mem::size_of::<i64>() as u32;
        unsafe {
            ExtAudioFileGetProperty(
                file,
                K_PROP_FILE_LENGTH_FRAMES,
                &mut size,
                (&mut total_frames as *mut i64).cast(),
            );
        }

        Ok(Self {
            file,
            channels: channels as u16,
            sample_rate: sample_rate as u32,
            total_frames,
            buffer: Vec::new(),
            offset: 0,
            finished: false,
        })
    }

    fn refill(&mut self) -> Option<()> {
        if self.finished {
            return None;
        }
        let channels = self.channels as usize;
        let mut pcm = vec![0f32; READ_FRAMES as usize * channels];
        let mut frames = READ_FRAMES;
        let mut buffer_list = AudioBufferList {
            number_buffers: 1,
            buffers: [AudioBuffer {
                number_channels: self.channels as u32,
                data_byte_size: (pcm.len() * 4) as u32,
                data: pcm.as_mut_ptr().cast(),
            }],
        };
        let status = unsafe { ExtAudioFileRead(self.file, &mut frames, &mut buffer_list) };
        if status != 0 || frames == 0 {
            self.finished = true;
            return None;
        }
        pcm.truncate(frames as usize * channels);
        self.buffer = pcm;
        self.offset = 0;
        Some(())
    }
}

impl Iterator for CoreAudioDecoder {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.offset >= self.buffer.len() && self.refill().is_none() {
            return None;
        }
        let sample = self.buffer[self.offset];
        self.offset += 1;
        Some(sample)
    }
}

impl Source for CoreAudioDecoder {
    fn current_span_len(&self) -> Option<usize> {
        Some(self.buffer.len().saturating_sub(self.offset))
    }

    fn channels(&self) -> ChannelCount {
        ChannelCount::new(self.channels).unwrap_or(ChannelCount::new(2).unwrap())
    }

    fn sample_rate(&self) -> SampleRate {
        SampleRate::new(self.sample_rate).unwrap_or(SampleRate::new(44_100).unwrap())
    }

    fn total_duration(&self) -> Option<Duration> {
        if self.total_frames > 0 && self.sample_rate > 0 {
            Some(Duration::from_secs_f64(
                self.total_frames as f64 / self.sample_rate as f64,
            ))
        } else {
            None
        }
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        let frame = (position.as_secs_f64() * self.sample_rate as f64) as i64;
        let status = unsafe { ExtAudioFileSeek(self.file, frame.max(0)) };
        if status != 0 {
            return Err(rodio::source::SeekError::Other(Arc::new(
                std::io::Error::other("ExtAudioFile seek failed"),
            )));
        }
        self.buffer.clear();
        self.offset = 0;
        self.finished = false;
        Ok(())
    }
}

impl Drop for CoreAudioDecoder {
    fn drop(&mut self) {
        unsafe {
            ExtAudioFileDispose(self.file);
        }
    }
}
