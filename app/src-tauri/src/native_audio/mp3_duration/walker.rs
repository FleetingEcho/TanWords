use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use super::header::{is_tag_frame, parse_frame_header, FrameHeader};
#[cfg(test)]
use super::header::declared_frame_count;
use super::tags::{audio_end, id3v2_len};

pub(super) struct Scan {
    /// Duration in seconds, summed frame by frame.
    pub(super) secs: f64,
    /// Whether the file's own Xing/Info/VBRI header declares a frame count that
    /// agrees with what the file actually contains.
    #[cfg(test)]
    pub(super) declared_matches: bool,
}

/// Whether the file's declared frame count can be trusted to describe the whole
/// file.
///
/// Callers use this to decide whether Symphonia's gapless trimming is safe:
/// gapless implements its tail trim by cutting the stream at the declared frame
/// count, so wherever that count is wrong it silently truncates playback to the
/// wrong value.
///
/// Note this is deliberately stronger than "a Xing header is present". When two
/// MP3s are concatenated — a very common way for a long file to be assembled —
/// the header of the first one survives at the top of the joined file and
/// describes only its own part. Trusting its mere presence caps playback at the
/// end of part one.
#[cfg(test)]
pub(super) fn has_exact_frame_count(path: &Path) -> bool {
    scan(path).is_some_and(|scan| scan.declared_matches)
}

/// Exact duration of an MP3 in seconds, or `None` if the file is not parseable
/// as MPEG audio.
pub(in crate::native_audio) fn mp3_duration_secs(path: &Path) -> Option<f64> {
    scan(path).map(|scan| scan.secs)
}

/// Walks every frame header in the file and sums the exact sample count.
///
/// Only headers are read — 4 bytes per frame plus a buffered seek over each
/// frame body — which measures a four-minute track in about 1.4 ms. That is
/// cheap enough that there is no reason to *ever* prefer an estimate, and cheap
/// enough to also run as a cross-check on the encoder's own declared count
/// rather than taking that count on faith.
pub(super) fn scan(path: &Path) -> Option<Scan> {
    let file = File::open(path).ok()?;
    let file_len = file.metadata().ok()?.len();
    let mut reader = BufReader::with_capacity(64 * 1024, file);

    let start = id3v2_len(&mut reader).ok()?.min(file_len);
    let end = audio_end(&mut reader, file_len).ok()?;
    if end <= start {
        return None;
    }

    reader.seek(SeekFrom::Start(start)).ok()?;
    let mut position = start;

    // Resync to the first real frame. Some files carry junk between the ID3v2
    // tag and the first frame; the sync loop below tolerates it.
    let (first_header, first_position) = find_next_frame(&mut reader, &mut position, end)?;

    // Read the first frame whole so its Xing/Info/VBRI tag (if any) can be read.
    let mut first_frame = vec![0u8; first_header.frame_size as usize];
    seek_to(&mut reader, &mut position, first_position).ok()?;
    let read = read_up_to(&mut reader, &mut first_frame);
    position += read as u64;
    first_frame.truncate(read);

    // The declared count covers the audio frames only, the tag frame itself
    // excluded — but only for the part of the file the tag was written for.
    #[cfg(test)]
    let declared_secs = declared_frame_count(&first_frame, &first_header).map(|frames| {
        frames as f64 * first_header.samples as f64 / first_header.sample_rate as f64
    });

    let mut seconds = 0.0f64;
    let mut header = first_header;
    let mut frame_start = first_position;
    if !is_tag_frame(&first_frame, &first_header) {
        seconds += header.samples as f64 / header.sample_rate as f64;
    }

    loop {
        let next_start = frame_start + header.frame_size;
        if next_start >= end {
            break;
        }
        if seek_to(&mut reader, &mut position, next_start).is_err() {
            break;
        }
        let Some((next_header, next_position)) = find_next_frame(&mut reader, &mut position, end)
        else {
            break;
        };
        seconds += next_header.samples as f64 / next_header.sample_rate as f64;
        header = next_header;
        frame_start = next_position;
    }

    if seconds <= 0.0 {
        return None;
    }
    // One frame of slack: the declared count legitimately differs by the tag
    // frame itself or a single trailing partial frame.
    #[cfg(test)]
    let slack = 2.0 * first_header.samples as f64 / first_header.sample_rate as f64;
    Some(Scan {
        #[cfg(test)]
        declared_matches: declared_secs.is_some_and(|declared| (declared - seconds).abs() <= slack),
        secs: seconds,
    })
}

/// Moves to an absolute offset via a *relative* seek, which lets `BufReader`
/// keep its buffer when the target is already inside it. Frame bodies are
/// typically a few hundred bytes, so an absolute `SeekFrom::Start` per frame
/// would discard and refill the 64 KiB buffer thousands of times over a single
/// track — turning a header walk into a full re-read of the file many times
/// over.
fn seek_to(reader: &mut BufReader<File>, position: &mut u64, target: u64) -> std::io::Result<()> {
    let delta = target as i64 - *position as i64;
    reader.seek_relative(delta)?;
    *position = target;
    Ok(())
}

fn read_up_to(reader: &mut BufReader<File>, buffer: &mut [u8]) -> usize {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => filled += n,
        }
    }
    filled
}

/// Advances to the next valid frame header at or after the reader's current
/// position, returning the header and the byte offset the frame starts at.
///
/// Scanning forward byte-by-byte (rather than giving up on the first
/// non-header) is what makes the walk survive the mid-file garbage — stray
/// tags, splice points, truncated frames — that made the estimating parsers
/// stop early on exactly the files this bug was reported against.
fn find_next_frame(
    reader: &mut BufReader<File>,
    position: &mut u64,
    end: u64,
) -> Option<(FrameHeader, u64)> {
    let mut word = 0u32;
    let mut primed = 0;
    let mut byte = [0u8; 1];

    while *position < end {
        if reader.read_exact(&mut byte).is_err() {
            return None;
        }
        *position += 1;
        word = (word << 8) | u32::from(byte[0]);
        primed += 1;
        if primed < 4 {
            continue;
        }
        if let Some(header) = parse_frame_header(word) {
            let frame_start = *position - 4;
            if frame_start + header.frame_size <= end {
                return Some((header, frame_start));
            }
        }
    }
    None
}
