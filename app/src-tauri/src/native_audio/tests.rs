use super::decoder::{open_decoder, DecodedTrack};
#[cfg(target_os = "linux")]
use super::playback::NativeAudioSnapshot;
#[cfg(target_os = "linux")]
use super::playback::{playback_worker, Command};
#[cfg(target_os = "linux")]
use super::pulse;
use rodio::{ChannelCount, SampleRate, Source};
use std::path::Path;
#[cfg(target_os = "linux")]
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

// ---------------------------------------------------------------------------
// Truncation regressions.
//
// The tests below build their own fixtures with ffmpeg rather than pointing at
// files on one developer's disk, because the bug they cover kept coming back on
// whichever platform nobody had a reproducing file for. Each fixture is a shape
// of file that made a decoder stop early:
//
//   fixture              rodio 0.22.2 decoded   true length
//   music_video.mp4                     0.05 s        120 s
//   vbr_frontloaded.mp3                20.04 s        240 s
//   vbr_noxing.mp3                    181.32 s        240 s
//   mixed_rate.mp3                     60.00 s        120 s
//
// They skip (rather than fail) when ffmpeg is unavailable, so a machine without
// it still runs the rest of the suite.
// ---------------------------------------------------------------------------

/// Runs ffmpeg, returning false if it is not installed.
fn ffmpeg(args: &[&str]) -> bool {
    match std::process::Command::new("ffmpeg")
        .args(["-v", "error", "-y"])
        .args(args)
        .output()
    {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

fn fixture_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("tanwords-audio-fixtures-{}", std::process::id()));
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Total seconds of audio a source produces **when driven the way rodio's mixer
/// actually drives it**.
///
/// `mixer.rs:62` wraps every played source in a `UniformSourceIterator`, which
/// resamples span by span: read `current_span_len()`, wrap in `Take { n }`,
/// drain, re-read the length for the next span. Iterating a decoder directly —
/// which is what a naive test does — never exercises that loop, and so cannot
/// see a decoder that satisfies `Iterator` perfectly but violates the span
/// contract. A decoder can return every sample of a four-minute file on direct
/// iteration and 0.02 s through this wrapper; that gap is precisely where this
/// bug lived, so measuring through the wrapper is the point of this helper.
fn played_secs<S: Source + Send + 'static>(source: S) -> f64 {
    use rodio::source::UniformSourceIterator;
    // A device rate deliberately different from the fixtures' 44.1 kHz, so the
    // resampler is genuinely in play and span boundaries do not line up.
    let rate = SampleRate::new(48_000).unwrap();
    let channels = ChannelCount::new(2).unwrap();
    UniformSourceIterator::new(source, channels, rate).count() as f64 / 48_000.0 / 2.0
}

/// Total seconds a source produces under plain iteration, accumulated per span.
///
/// Not `count() / sample_rate()`: several fixtures change sample rate partway
/// through — that is the point of them — and a single division would misreport
/// exactly the case being tested.
fn decoded_secs<S: Source>(mut source: S) -> f64 {
    let mut seconds = 0.0;
    loop {
        let rate = source.sample_rate().get() as f64;
        let channels = source.channels().get() as f64;
        let span = source.current_span_len().unwrap_or(1).max(1);
        let mut taken = 0usize;
        let mut ended = false;
        for _ in 0..span {
            if source.next().is_none() {
                ended = true;
                break;
            }
            taken += 1;
        }
        seconds += taken as f64 / rate / channels;
        if ended {
            return seconds;
        }
    }
}

/// A song shipped as a video file: an h264 track sitting alongside the AAC
/// audio. rodio hands the first video packet to the audio decoder and ends the
/// stream on the resulting error, yielding 0.05 s of a two-minute track.
#[test]
fn plays_the_whole_audio_track_of_a_video_container() {
    let path = fixture_dir().join("music_video.mp4");
    if !ffmpeg(&[
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=120",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=120",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25",
        "-c:a", "aac", "-shortest",
        path.to_str().unwrap(),
    ]) {
        return;
    }

    let decoded = decoded_secs(open_decoder(&path).unwrap());
    assert!((decoded - 120.0).abs() < 2.0, "decoded={decoded:.2}s of 120s");
    let _ = std::fs::remove_file(&path);
}

/// A VBR MP3 with no Xing header. Symphonia guesses the frame count from the
/// first 16 frames, and gapless trimming then cuts the stream at the guess —
/// so the file plays 181 s of its 240 s. Independently, `lofty` reports its
/// length as 40 s.
#[test]
fn plays_and_measures_vbr_mp3_without_a_xing_header() {
    let path = fixture_dir().join("vbr_noxing.mp3");
    if !ffmpeg(&[
        "-f", "lavfi", "-i", "sine=frequency=440:duration=240",
        "-c:a", "libmp3lame", "-q:a", "4", "-write_xing", "0",
        path.to_str().unwrap(),
    ]) {
        return;
    }

    let measured = super::measured_mp3_duration_secs(&path).unwrap();
    assert!((measured - 240.0).abs() < 1.0, "measured={measured:.2}s");
    let decoded = decoded_secs(open_decoder(&path).unwrap());
    assert!((decoded - 240.0).abs() < 2.0, "decoded={decoded:.2}s of 240s");
    let _ = std::fs::remove_file(&path);
}

/// Two MP3s concatenated — how plenty of long files are assembled. The join
/// changes the sample rate, and Symphonia's MP3 decoder then rejects every
/// subsequent packet with "invalid audio buffer signal spec" (never a
/// `ResetRequired`), so playback stops at the end of part one. The surviving
/// Xing header from part one also understates the length, which is why it is
/// cross-checked against the bitstream rather than trusted.
#[test]
fn plays_and_measures_past_a_mid_file_parameter_change() {
    let dir = fixture_dir();
    let (first, second, joined) = (
        dir.join("r44.mp3"),
        dir.join("r32.mp3"),
        dir.join("mixed_rate.mp3"),
    );
    if !ffmpeg(&[
        "-f", "lavfi", "-i", "sine=frequency=440:duration=60:sample_rate=44100",
        "-c:a", "libmp3lame", "-q:a", "5", first.to_str().unwrap(),
    ]) {
        return;
    }
    assert!(ffmpeg(&[
        "-f", "lavfi", "-i", "sine=frequency=660:duration=60:sample_rate=32000",
        "-c:a", "libmp3lame", "-q:a", "5", second.to_str().unwrap(),
    ]));
    let mut bytes = std::fs::read(&first).unwrap();
    bytes.extend(std::fs::read(&second).unwrap());
    std::fs::write(&joined, &bytes).unwrap();

    let measured = super::measured_mp3_duration_secs(&joined).unwrap();
    assert!((measured - 120.0).abs() < 1.0, "measured={measured:.2}s");
    let decoded = decoded_secs(open_decoder(&joined).unwrap());
    assert!((decoded - 120.0).abs() < 2.0, "decoded={decoded:.2}s of 120s");

    for path in [first, second, joined] {
        let _ = std::fs::remove_file(path);
    }
}

/// A valid Xing count can sit beside corrupt LAME trim metadata. Symphonia
/// trusts both when gapless mode is on, so valid audio at the tail disappears.
#[test]
fn ignores_corrupt_lame_padding_and_plays_the_tail() {
    let path = fixture_dir().join("bad-lame-padding.mp3");
    if !ffmpeg(&[
        "-f", "lavfi", "-i", "sine=frequency=440:duration=8:sample_rate=44100",
        "-c:a", "libmp3lame", "-q:a", "4", path.to_str().unwrap(),
    ]) {
        return;
    }
    let mut bytes = std::fs::read(&path).unwrap();
    let encoder = bytes
        .windows(4)
        .position(|window| window == b"Lavc" || window == b"LAME")
        .expect("ffmpeg MP3 should contain a LAME extension");
    bytes[encoder + 21..encoder + 24].fill(0xff);
    std::fs::write(&path, bytes).unwrap();

    let decoded = decoded_secs(open_decoder(&path).unwrap());
    assert!(decoded > 7.95, "decoded={decoded:.3}s of 8s");
    let _ = std::fs::remove_file(path);
}

/// Fragmented MP4 files may leave `mdhd` and `stts` at zero and store the real
/// duration in a top-level `sidx`. Symphonia reports only a short fragment.
#[test]
fn measures_fragmented_mp4_from_its_segment_index() {
    let path = fixture_dir().join("fragmented-duration.mp4");
    if !ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=8:sample_rate=48000",
        "-c:a",
        "aac",
        "-movflags",
        "dash+frag_keyframe+empty_moov",
        path.to_str().unwrap(),
    ]) {
        return;
    }
    let duration = super::mp4_duration::audio_duration_secs(&path).unwrap();
    assert!((duration - 8.0).abs() < 0.1, "duration={duration:.3}s");
    let _ = std::fs::remove_file(path);
}

/// The span contract, checked directly: a decoder must never report an empty
/// span while it still has audio.
///
/// rodio turns `current_span_len()` into `Take { n }`. An `n` of 0 yields
/// nothing, and `UniformSourceIterator` reads that as the end of the track —
/// so a single zero-length span mid-file ends the song. Whether that happens
/// depends on where span boundaries fall relative to the decoder's internal
/// buffer, which depends on the file's sample rate against the output device's:
/// a different second in every track, a different result on every machine.
#[test]
fn never_reports_an_empty_span_before_the_end() {
    let path = fixture_dir().join("span.mp3");
    if !ffmpeg(&[
        "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
        "-c:a", "libmp3lame", "-q:a", "4", path.to_str().unwrap(),
    ]) {
        return;
    }

    let mut decoder = open_decoder(&path).unwrap();
    let mut samples = 0u64;
    loop {
        // The contract, stated exactly: an empty span must mean the stream is
        // over. Reporting one while `next()` still has samples is what ends a
        // song early.
        if decoder.current_span_len() == Some(0) {
            assert!(
                decoder.next().is_none(),
                "empty span reported after {samples} samples, but audio remains"
            );
            break;
        }
        if decoder.next().is_none() {
            break;
        }
        samples += 1;
    }
    // 8 s at 44.1 kHz; enough to prove the loop ran to the real end.
    assert!(samples > 300_000, "samples={samples}");
    let _ = std::fs::remove_file(&path);
}

/// The same files, played through rodio's resampling wrapper rather than
/// iterated directly. Before the span fix these returned hundredths of a second
/// apiece while direct iteration returned the whole file.
#[test]
fn plays_to_the_end_through_rodios_resampler() {
    let dir = fixture_dir();
    let mp3 = dir.join("played.mp3");
    if !ffmpeg(&[
        "-f", "lavfi", "-i", "sine=frequency=440:duration=120",
        "-c:a", "libmp3lame", "-q:a", "4", mp3.to_str().unwrap(),
    ]) {
        return;
    }
    let played = played_secs(open_decoder(&mp3).unwrap());
    assert!((played - 120.0).abs() < 2.0, "played={played:.2}s of 120s");

    let mp4 = dir.join("played.mp4");
    assert!(ffmpeg(&[
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=120",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=120",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25",
        "-c:a", "aac", "-shortest", mp4.to_str().unwrap(),
    ]));
    let played = played_secs(open_decoder(&mp4).unwrap());
    assert!((played - 120.0).abs() < 2.0, "played={played:.2}s of 120s");

    for path in [mp3, mp4] {
        let _ = std::fs::remove_file(path);
    }
}

/// Seeking must land where it was asked to, and playing on from there must
/// reach the real end of the file rather than the container's declared one.
#[test]
fn seeks_land_where_asked_and_play_to_the_end() {
    let path = fixture_dir().join("seekable.mp3");
    if !ffmpeg(&[
        "-f", "lavfi", "-i", "sine=frequency=440:duration=240",
        "-c:a", "libmp3lame", "-q:a", "4", path.to_str().unwrap(),
    ]) {
        return;
    }

    let mut decoder = open_decoder(&path).unwrap();
    decoder.try_seek(Duration::from_secs(180)).unwrap();
    let remaining = decoded_secs(decoder);
    assert!((remaining - 60.0).abs() < 2.0, "remaining={remaining:.2}s, expected 60s");
    let _ = std::fs::remove_file(&path);
}

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

#[cfg(target_os = "macos")]
#[test]
fn coreaudio_decodes_complete_mp3_across_corrupt_frame_boundary() {
    let path = Path::new(
        "/Users/tengzhang/work/Music_JayZhou/周杰伦 - 你听得到 - 2004无与伦比演唱会.mp3",
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

// mp4 audio-in-video file (music video with an h264 track alongside aac
// audio) that rodio's isomp4 demuxer previously mis-measured/truncated.
#[cfg(target_os = "macos")]
#[test]
fn coreaudio_reads_full_mp4_audio_track() {
    let path = Path::new(
        "/Users/tengzhang/work/Music_JayZhou/“我只为自己而哭泣”！Cry For Me (feat. Ami) - Original.mp4",
    );
    if !path.exists() {
        return;
    }
    let decoder = open_decoder(path).unwrap();
    let duration = decoder.total_duration().unwrap().as_secs_f64();
    let rate = decoder.sample_rate().get() as f64;
    let channels = decoder.channels().get() as f64;
    let decoded_seconds = decoder.count() as f64 / rate / channels;
    assert!((300.0..=304.0).contains(&duration), "duration={duration:.3}");
    assert!(
        (300.0..=304.0).contains(&decoded_seconds),
        "decoded_seconds={decoded_seconds:.3}"
    );
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
    let worker =
        std::thread::spawn(move || playback_worker(decoder, rate, channels, true, 1, shared, rx));
    std::thread::sleep(Duration::from_millis(350));
    tx.send(Command::Seek(0.0)).unwrap();
    std::thread::sleep(Duration::from_millis(250));

    assert!(snapshot.lock().unwrap().position_sec < 1.0);
    tx.send(Command::Stop).unwrap();
    worker.join().unwrap();
}
