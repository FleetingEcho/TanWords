use super::decoder::{open_decoder, DecodedTrack};
#[cfg(target_os = "linux")]
use super::playback::NativeAudioSnapshot;
#[cfg(target_os = "linux")]
use super::playback::{playback_worker, Command};
#[cfg(target_os = "linux")]
use super::pulse;
use rodio::Source;
use std::path::Path;
#[cfg(target_os = "linux")]
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

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
