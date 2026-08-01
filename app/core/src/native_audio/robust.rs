//! A Symphonia decoder that does not stop early.
//!
//! This exists because `rodio::Decoder` — which is itself a thin wrapper over
//! Symphonia — ends the sample stream on conditions that are recoverable, and
//! that is the whole of the "the song is 4:00 but the app only plays 3:12" bug.
//! Two failure modes, both in `rodio-0.22.2/src/decoder/symphonia.rs`:
//!
//! 1. `Iterator::next` calls `self.format.next_packet().ok()?`, so *any*
//!    demuxer error terminates the track. `Error::ResetRequired` (emitted when
//!    a stream's parameters change mid-file, e.g. at the splice point of a
//!    concatenated MP3) is a "reset and keep going" signal, not an end.
//! 2. `next` never checks `packet.track_id()`, unlike the initialization path
//!    which carefully does. In an MP4/M4A carrying a video track alongside the
//!    audio track — a music video, or a song shipped as `.mp4` — the first
//!    video packet is handed to the audio decoder, which returns a non-
//!    `DecodeError` error, and `Err(_) => return None` truncates playback at
//!    the first video keyframe.
//!
//! The project's previous answer was a native decoder per platform: GStreamer
//! on Linux, ExtAudioFile on macOS. That left Windows on the unpatched rodio
//! path (hence the recurrence there), and meant three decoders to keep in
//! agreement. This module is one decoder, identical on every platform, that
//! handles both cases directly: it pins the audio track and skips every packet
//! belonging to another one, and it classifies demuxer/decoder errors into
//! "recover and continue" versus "genuine end of stream" instead of collapsing
//! them all into the latter.

use rodio::{ChannelCount, SampleRate, Source};
use std::fs::File;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::TimeBase;

/// Cap on how many *consecutive* unreadable packets we push through before
/// declaring the stream over. Skipping without a limit (what rodio does for
/// `DecodeError`) risks spinning forever on a pathological file; a small
/// tolerance is not enough to cross the multi-second runs of damage that real
/// truncated downloads contain. A few thousand packets is under a minute of
/// audio and is reached in well under a second of wall time.
const MAX_CONSECUTIVE_ERRORS: u32 = 4096;

/// Whether Symphonia's gapless mode can be trusted for this file.
///
/// Gapless trimming drops the encoder's delay and padding — nice — but it
/// implements the tail trim by cutting the stream at the track's declared
/// `n_frames`. For MP3 without a Xing/VBRI header there is no declared count,
/// so Symphonia extrapolates one from the first 16 frames, and gapless then
/// truncates playback to that guess: a 4:00 VBR file stops dead at 3:01. That
/// is the single largest contributor to the "song is cut short" reports, and it
/// is invisible in testing with CBR or Xing-tagged files, which is most of them.
///
/// A trustworthy frame count is not sufficient: old files can independently
/// carry corrupt LAME delay/padding fields. Therefore gapless stays on for
/// non-MP3 containers and off for every MP3. The cost is up to one encoder
/// frame of padding; the cost of trusting bad metadata is the tail of the song.
fn gapless_is_safe(path: &Path) -> bool {
    let is_mp3 = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"));
    // Even a verified Xing frame count is not enough: old encoders sometimes
    // write corrupt LAME delay/padding fields beside it. Symphonia subtracts
    // those values when gapless mode is enabled and can trim tens of seconds.
    // The maximum cost of disabling MP3 gapless trimming is one encoder frame.
    !is_mp3
}

/// What to do after attempting to decode one packet.
enum Step {
    /// Audio is in the buffer and ready to hand out.
    Delivered,
    /// Nothing usable here; move on to the next packet.
    Skip,
    /// Recoverable failure — count it, maybe rebuild the decoder, retry.
    Recover,
    /// Unrecoverable; the stream is over.
    Fatal,
}

pub(super) struct RobustDecoder {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    time_base: Option<TimeBase>,
    spec: SignalSpec,
    buffer: SampleBuffer<f32>,
    offset: usize,
    total_duration: Option<Duration>,
    finished: bool,
}

impl RobustDecoder {
    pub(super) fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        let stream = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());

        let mut hint = Hint::new();
        if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(extension);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                stream,
                &FormatOptions {
                    enable_gapless: gapless_is_safe(path),
                    ..Default::default()
                },
                &MetadataOptions::default(),
            )
            .map_err(|e| e.to_string())?;
        let mut format = probed.format;

        let (track_id, decoder, time_base, n_frames) = select_audio_track(format.as_mut())?;

        // Placeholder spec, immediately replaced by the first decoded packet
        // below; nothing observes it before then.
        let spec = SignalSpec::new(44_100, symphonia::core::audio::Channels::FRONT_LEFT);
        let mut this = Self {
            format,
            decoder,
            track_id,
            time_base,
            spec,
            buffer: SampleBuffer::<f32>::new(0, spec),
            offset: 0,
            total_duration: super::measured_container_duration_secs(path)
                .map(Duration::from_secs_f64)
                .or_else(|| {
                    time_base
                        .zip(n_frames)
                        .map(|(base, frames)| Duration::from(base.calc_time(frames)))
                        .filter(|d| !d.is_zero())
                }),
            finished: false,
        };

        // Decode forward to the first packet that yields audio, so channels and
        // sample rate are known before rodio queries them.
        if this.fill().is_none() {
            return Err("no decodable audio in this file".into());
        }
        Ok(this)
    }

    pub(super) fn set_total_duration(&mut self, duration: Duration) {
        self.total_duration = Some(duration);
    }

    /// Pulls packets until one decodes into audio frames, refilling `buffer`.
    /// Returns `None` only at a genuine end of stream.
    fn fill(&mut self) -> Option<()> {
        if self.finished {
            return None;
        }
        let mut errors = 0u32;
        loop {
            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                // The only unambiguous end-of-stream signal Symphonia gives.
                Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    self.finished = true;
                    return None;
                }
                // Parameters changed mid-stream. rodio treats this as the end;
                // it means "rebuild the decoder and carry on".
                Err(Error::ResetRequired) => {
                    errors += 1;
                    if self.rebuild_decoder().is_none() || errors > MAX_CONSECUTIVE_ERRORS {
                        self.finished = true;
                        return None;
                    }
                    continue;
                }
                // A damaged region in the middle of an otherwise fine file. The
                // demuxer resyncs on the following call, so keep asking.
                Err(Error::DecodeError(_)) | Err(Error::IoError(_)) => {
                    errors += 1;
                    if errors > MAX_CONSECUTIVE_ERRORS {
                        self.finished = true;
                        return None;
                    }
                    continue;
                }
                Err(_) => {
                    self.finished = true;
                    return None;
                }
            };

            // The fix for audio-in-video containers: never feed another track's
            // packets to this decoder.
            if packet.track_id() != self.track_id {
                continue;
            }

            // A given packet gets one rebuild-and-retry before it is written
            // off as damaged.
            let mut rebuilt = false;
            loop {
                // The match produces a borrow-free `Step` rather than acting on
                // `self` inside its arms: `decoded` borrows `self.decoder` for
                // the whole match, so `self.rebuild_decoder()` cannot be called
                // there. (Storing the samples *is* fine inside the arm —
                // `self.buffer` and `self.spec` are disjoint fields from
                // `self.decoder`.)
                let step = match self.decoder.decode(&packet) {
                    // Metadata-only packet; common right after a seek.
                    Ok(decoded) if decoded.frames() == 0 => Step::Skip,
                    Ok(decoded) => {
                        let spec = *decoded.spec();
                        let frames = decoded.capacity() as u64;
                        let needed = frames.saturating_mul(spec.channels.count() as u64) as usize;
                        if self.buffer.capacity() < needed {
                            self.buffer = SampleBuffer::<f32>::new(frames, spec);
                        }
                        self.spec = spec;
                        self.buffer.copy_interleaved_ref(decoded);
                        self.offset = 0;
                        Step::Delivered
                    }
                    Err(Error::DecodeError(_))
                    | Err(Error::IoError(_))
                    | Err(Error::ResetRequired) => Step::Recover,
                    Err(_) => Step::Fatal,
                };

                match step {
                    Step::Delivered => return Some(()),
                    Step::Skip => break,
                    Step::Fatal => {
                        self.finished = true;
                        return None;
                    }
                    Step::Recover => {
                        errors += 1;
                        if errors > MAX_CONSECUTIVE_ERRORS {
                            self.finished = true;
                            return None;
                        }
                        if !rebuilt {
                            rebuilt = true;
                            if self.rebuild_decoder().is_some() {
                                continue;
                            }
                        }
                        break;
                    }
                }
            }
        }
    }

    /// Builds a fresh codec instance, which is how a mid-stream change of
    /// sample rate or channel layout is survived.
    ///
    /// Symphonia's MP3 decoder allocates its output buffer from the first frame
    /// it sees and then rejects — forever, with a plain `DecodeError` and never
    /// a `ResetRequired` — any later frame whose spec differs:
    /// `"mpa: invalid audio buffer signal spec for packet"`. So every packet
    /// after the join in a concatenated MP3, or after a station-ID splice,
    /// fails to decode and the track appears to end there even though the
    /// demuxer happily reads on to the true end of file.
    ///
    /// A *new* decoder has no buffer yet and therefore adopts the spec of the
    /// next frame header it reads, which is exactly the recovery needed. It is
    /// built from the track's parameters even though those still describe the
    /// old spec: for MPEG audio the authoritative spec is in the frame header,
    /// not the container.
    fn rebuild_decoder(&mut self) -> Option<()> {
        let track = self
            .format
            .tracks()
            .iter()
            .find(|track| track.id == self.track_id)?;
        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .ok()?;
        self.decoder = decoder;
        Some(())
    }
}

/// The chosen track's id, its codec, and the two fields needed to report and
/// seek by time.
type SelectedTrack = (u32, Box<dyn Decoder>, Option<TimeBase>, Option<u64>);

/// Picks the track to play: the default track when it is decodable audio,
/// otherwise the first track Symphonia can build a codec for.
///
/// Symphonia's codec registry contains audio codecs only, so "a codec can be
/// made for it" is exactly the test for "this is an audio track" — which is how
/// the video track of a music-video MP4 gets excluded rather than played.
///
/// Taking `n_frames` from *this* track also fixes a subtler miscount: rodio
/// reads the time base from the first supported track but the frame count from
/// the container's default track, which in a music video is the video track.
fn select_audio_track(format: &mut dyn FormatReader) -> Result<SelectedTrack, String> {
    let default_id = format.default_track().map(|track| track.id);
    let codecs = symphonia::default::get_codecs();

    let mut candidates: Vec<_> = format
        .tracks()
        .iter()
        .filter(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .map(|track| (track.id, track.codec_params.clone()))
        .collect();
    // Prefer the container's own default track when it qualifies.
    candidates.sort_by_key(|(id, _)| Some(*id) != default_id);

    for (id, params) in candidates {
        if let Ok(decoder) = codecs.make(&params, &DecoderOptions::default()) {
            return Ok((id, decoder, params.time_base, params.n_frames));
        }
    }
    Err("no supported audio track in this file".into())
}

impl Iterator for RobustDecoder {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.offset >= self.buffer.len() {
            self.fill()?;
        }
        let sample = *self.buffer.samples().get(self.offset)?;
        self.offset += 1;
        // Decode the next span *now*, before anyone can observe an exhausted
        // buffer. See `current_span_len` for why an empty one is fatal.
        if self.offset >= self.buffer.len() {
            let _ = self.fill();
        }
        Some(sample)
    }
}

impl Source for RobustDecoder {
    /// Samples remaining in the current span — **never `Some(0)`** while the
    /// file still has audio in it.
    ///
    /// This is the contract that killed playback at a random point in the
    /// track, and the reason the bug looked platform-specific and intermittent.
    /// `rodio`'s mixer wraps every source in a `UniformSourceIterator`, which
    /// resamples one span at a time: it reads `current_span_len()`, wraps the
    /// source in `Take { n: that }`, drains it, then re-reads the length for the
    /// next span (`rodio-0.22.2/src/source/uniform.rs`). If the re-read returns
    /// `Some(0)` it builds `Take { n: 0 }`, which yields nothing, and the track
    /// is declared finished — mid-song, with the decoder still holding the rest
    /// of the file.
    ///
    /// Reporting "however much is left in the decode buffer" hits that whenever
    /// a span boundary lands exactly on a buffer boundary — which depends on the
    /// ratio between the file's sample rate and the output device's, hence a
    /// failure that moves between machines and operating systems and lands at a
    /// different second in every track. Eagerly refilling in `next` keeps the
    /// buffer non-empty until the file genuinely ends, so 0 means 0.
    fn current_span_len(&self) -> Option<usize> {
        Some(self.buffer.len().saturating_sub(self.offset))
    }

    fn channels(&self) -> ChannelCount {
        ChannelCount::new(self.spec.channels.count().min(u16::MAX as usize) as u16)
            .unwrap_or(ChannelCount::new(2).expect("2 is a valid channel count"))
    }

    fn sample_rate(&self) -> SampleRate {
        SampleRate::new(self.spec.rate)
            .unwrap_or(SampleRate::new(44_100).expect("44100 is a valid sample rate"))
    }

    fn total_duration(&self) -> Option<Duration> {
        self.total_duration
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        let mut target = position;
        if let Some(total) = self.total_duration {
            if target > total {
                target = total;
            }
        }

        // Accurate seeking needs a time base to convert the request into a
        // timestamp; without one, coarse is the only option available.
        let mode = if self.time_base.is_some() {
            SeekMode::Accurate
        } else {
            SeekMode::Coarse
        };
        let seeked = self
            .format
            .seek(
                mode,
                SeekTo::Time {
                    time: target.into(),
                    track_id: Some(self.track_id),
                },
            )
            .map_err(|e| rodio::source::SeekError::Other(Arc::new(std::io::Error::other(e))))?;

        self.decoder.reset();
        self.buffer.clear();
        self.offset = 0;
        // A seek past a previously-hit end is a valid way to resume playback.
        self.finished = false;

        if self.fill().is_none() {
            return Ok(());
        }

        // Symphonia lands on the nearest packet boundary, not the exact sample.
        // Drop the overshoot so position reporting and A/B looping stay honest.
        if let Some(base) = self.time_base {
            let skew = base.calc_time(seeked.required_ts.saturating_sub(seeked.actual_ts));
            let channels = (self.channels().get() as usize).max(1);
            let mut to_skip = (Duration::from(skew).as_secs_f64()
                * self.sample_rate().get() as f64
                * channels as f64) as usize;
            to_skip -= to_skip % channels;
            for _ in 0..to_skip {
                if self.next().is_none() {
                    break;
                }
            }
        }
        Ok(())
    }
}
