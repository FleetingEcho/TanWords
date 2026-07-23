use rodio::{ChannelCount, Decoder, SampleRate, Source};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::Duration;

type RodioDecoder = Decoder<BufReader<File>>;

pub(super) enum FileDecoder {
    Rodio(RodioDecoder),
    #[cfg(target_os = "linux")]
    Gstreamer(super::gstreamer::GstreamerDecoder),
    #[cfg(target_os = "macos")]
    CoreAudio(super::coreaudio::CoreAudioDecoder),
}

impl Iterator for FileDecoder {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::Rodio(decoder) => decoder.next(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.next(),
            #[cfg(target_os = "macos")]
            Self::CoreAudio(decoder) => decoder.next(),
        }
    }
}

impl Source for FileDecoder {
    fn current_span_len(&self) -> Option<usize> {
        match self {
            Self::Rodio(decoder) => decoder.current_span_len(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.current_span_len(),
            #[cfg(target_os = "macos")]
            Self::CoreAudio(decoder) => decoder.current_span_len(),
        }
    }

    fn channels(&self) -> ChannelCount {
        match self {
            Self::Rodio(decoder) => decoder.channels(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.channels(),
            #[cfg(target_os = "macos")]
            Self::CoreAudio(decoder) => decoder.channels(),
        }
    }

    fn sample_rate(&self) -> SampleRate {
        match self {
            Self::Rodio(decoder) => decoder.sample_rate(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.sample_rate(),
            #[cfg(target_os = "macos")]
            Self::CoreAudio(decoder) => decoder.sample_rate(),
        }
    }

    fn total_duration(&self) -> Option<Duration> {
        match self {
            Self::Rodio(decoder) => decoder.total_duration(),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.total_duration(),
            #[cfg(target_os = "macos")]
            Self::CoreAudio(decoder) => decoder.total_duration(),
        }
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        match self {
            Self::Rodio(decoder) => decoder.try_seek(position),
            #[cfg(target_os = "linux")]
            Self::Gstreamer(decoder) => decoder.try_seek(position),
            #[cfg(target_os = "macos")]
            Self::CoreAudio(decoder) => decoder.try_seek(position),
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

pub(super) fn open_decoder(path: &Path) -> Result<FileDecoder, String> {
    let is_mp3 = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"));

    #[cfg(target_os = "linux")]
    if is_mp3 {
        return super::gstreamer::GstreamerDecoder::open(path).map(FileDecoder::Gstreamer);
    }

    // rodio's Symphonia demuxers can also misjudge duration/track boundaries
    // for mp4-family containers (mp4/m4a/aac), including audio-in-video files
    // (music videos) where a video track sits alongside the audio track.
    // ExtAudioFile natively opens all of these and reads the enabled audio
    // track, same as QuickTime/Music.app.
    #[cfg(target_os = "macos")]
    let is_coreaudio_format = is_mp3
        || path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                matches!(extension.to_ascii_lowercase().as_str(), "mp4" | "m4a" | "aac")
            });
    #[cfg(target_os = "macos")]
    if is_coreaudio_format {
        return super::coreaudio::CoreAudioDecoder::open(path).map(FileDecoder::CoreAudio);
    }

    let _ = is_mp3;
    Decoder::try_from(File::open(path).map_err(|e| e.to_string())?)
        .map(FileDecoder::Rodio)
        .map_err(|e| e.to_string())
}
