use rodio::{ChannelCount, Decoder, SampleRate, Source};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::Duration;

type RodioDecoder = Decoder<BufReader<File>>;

pub(super) enum FileDecoder {
    Robust(super::robust::RobustDecoder),
    Rodio(RodioDecoder),
    #[cfg(target_os = "linux")]
    Gstreamer(super::gstreamer::GstreamerDecoder),
    #[cfg(target_os = "macos")]
    CoreAudio(super::coreaudio::CoreAudioDecoder),
}

/// Every `Source`/`Iterator` method is the same three-to-five-arm match over
/// the variants; spelling each one out by hand was where a variant last got
/// forgotten.
macro_rules! dispatch {
    ($self:expr, $decoder:ident => $call:expr) => {
        match $self {
            Self::Robust($decoder) => $call,
            Self::Rodio($decoder) => $call,
            #[cfg(target_os = "linux")]
            Self::Gstreamer($decoder) => $call,
            #[cfg(target_os = "macos")]
            Self::CoreAudio($decoder) => $call,
        }
    };
}

impl Iterator for FileDecoder {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        dispatch!(self, decoder => decoder.next())
    }
}

impl Source for FileDecoder {
    fn current_span_len(&self) -> Option<usize> {
        dispatch!(self, decoder => decoder.current_span_len())
    }

    fn channels(&self) -> ChannelCount {
        dispatch!(self, decoder => decoder.channels())
    }

    fn sample_rate(&self) -> SampleRate {
        dispatch!(self, decoder => decoder.sample_rate())
    }

    fn total_duration(&self) -> Option<Duration> {
        dispatch!(self, decoder => decoder.total_duration())
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        dispatch!(self, decoder => decoder.try_seek(position))
    }
}

impl FileDecoder {
    /// Overrides the container's declared length with an independently measured
    /// one (see `super::accurate_duration`), so that what the seek bar shows and
    /// what the decoder will actually produce cannot disagree.
    /// The other backends derive duration from the container or the system
    /// decoder and have no equivalent override; they are fallbacks only.
    pub(super) fn set_total_duration(&mut self, duration: Duration) {
        if let Self::Robust(decoder) = self {
            decoder.set_total_duration(duration);
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

/// Opens the best available decoder for `path`.
///
/// `RobustDecoder` is the path for every format on every platform — that
/// uniformity is the point. Truncated playback used to be fixed one operating
/// system at a time (GStreamer for Linux MP3, ExtAudioFile for macOS
/// MP3/MP4), which left whichever platform had not been patched yet — most
/// recently Windows — still running the unfixed rodio decoder, and made the
/// bug look like it kept coming back. It was never fixed at the source; it was
/// routed around. `RobustDecoder` fixes it at the source, so there is one
/// decoding path to reason about and to test.
///
/// The native backends remain only as *fallbacks for files Symphonia cannot
/// open at all* — chiefly Apple Lossless and other system-only codecs on
/// macOS — never as the primary path, so they can no longer silently diverge
/// from it on files both can handle.
pub(super) fn open_decoder(path: &Path) -> Result<FileDecoder, String> {
    let primary = match super::robust::RobustDecoder::open(path) {
        Ok(decoder) => return Ok(FileDecoder::Robust(decoder)),
        Err(error) => error,
    };

    #[cfg(target_os = "linux")]
    if let Ok(decoder) = super::gstreamer::GstreamerDecoder::open(path) {
        return Ok(FileDecoder::Gstreamer(decoder));
    }

    #[cfg(target_os = "macos")]
    if let Ok(decoder) = super::coreaudio::CoreAudioDecoder::open(path) {
        return Ok(FileDecoder::CoreAudio(decoder));
    }

    Decoder::try_from(File::open(path).map_err(|e| e.to_string())?)
        .map(FileDecoder::Rodio)
        .map_err(|_| primary)
}
