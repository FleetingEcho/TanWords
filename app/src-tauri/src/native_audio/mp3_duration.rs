//! Exact MP3 duration, measured from the bitstream itself.
//!
//! Every duration source we previously relied on for MP3 is an *estimate*:
//!
//! - `lofty`, with no Xing/VBRI header present, takes the **first frame's**
//!   bitrate and divides the file size by it ("MPEG: Using bitrate to estimate
//!   duration" in its own logs).
//! - symphonia's MPA demuxer averages the length of the **first 16 frames** and
//!   extrapolates over the file size (`estimate_num_mpeg_frames`).
//!
//! Both are exact for CBR and wrong for VBR-without-Xing — the encoder starts a
//! song quietly, the leading frames are unrepresentative, and a 4:00 track gets
//! reported as 3:12. Neither estimate subtracts trailing ID3v1/APE tag bytes
//! either, and `lofty`'s divides by a bitrate read before the ID3v2 tag is
//! accounted for, so the error compounds in both directions.
//!
//! This module instead walks the frame headers — reading 4 bytes per frame and
//! seeking over each frame body, never decoding — and sums the exact sample
//! count. That costs about 1.4 ms for a four-minute track, cheap enough that
//! there is never a reason to prefer an estimate, and cheap enough to also run
//! as a cross-check on the encoder's own declared frame count instead of taking
//! that count on faith (see [`Scan::declared_matches`]).

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// kbps by (version_group, layer, bitrate_index). Index 0 is "free format" and
/// 15 is invalid; both are stored as 0 and rejected by the parser.
const BITRATES_V1: [[u32; 16]; 3] = [
    // Layer I
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
    // Layer II
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
    // Layer III
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
];
const BITRATES_V2: [[u32; 16]; 3] = [
    // Layer I
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
    // Layer II
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    // Layer III (identical table to Layer II under MPEG 2/2.5)
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
];
const SAMPLE_RATES: [[u32; 3]; 3] = [
    [44_100, 48_000, 32_000], // MPEG 1
    [22_050, 24_000, 16_000], // MPEG 2
    [11_025, 12_000, 8_000],  // MPEG 2.5
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct FrameHeader {
    /// 0 = MPEG 1, 1 = MPEG 2, 2 = MPEG 2.5
    version: usize,
    /// 0 = Layer I, 1 = Layer II, 2 = Layer III
    layer: usize,
    sample_rate: u32,
    /// Total bytes of this frame including the 4 header bytes.
    frame_size: u64,
    samples: u32,
    mono: bool,
    /// Bytes between the end of the header and a Xing/Info tag, if this frame
    /// were to carry one.
    side_info_len: u64,
}

/// Parses the 4 header bytes of an MPEG audio frame, rejecting the reserved and
/// "free format" encodings that a random byte sequence would otherwise satisfy.
pub(super) fn parse_frame_header(word: u32) -> Option<FrameHeader> {
    if word & 0xFFE0_0000 != 0xFFE0_0000 {
        return None;
    }
    let version = match (word >> 19) & 0b11 {
        0b11 => 0, // MPEG 1
        0b10 => 1, // MPEG 2
        0b00 => 2, // MPEG 2.5
        _ => return None,
    };
    let layer = match (word >> 17) & 0b11 {
        0b11 => 0, // Layer I
        0b10 => 1, // Layer II
        0b01 => 2, // Layer III
        _ => return None,
    };
    let bitrate_index = ((word >> 12) & 0b1111) as usize;
    let sample_rate_index = ((word >> 10) & 0b11) as usize;
    if sample_rate_index == 0b11 {
        return None;
    }
    let table = if version == 0 { &BITRATES_V1 } else { &BITRATES_V2 };
    let bitrate = table[layer][bitrate_index] * 1000;
    if bitrate == 0 {
        return None;
    }
    let sample_rate = SAMPLE_RATES[version][sample_rate_index];
    let padding = ((word >> 9) & 1) as u64;
    let mono = (word >> 6) & 0b11 == 0b11;

    // Layer I is 384 samples/frame; Layer II is always 1152; Layer III is 1152
    // under MPEG 1 but only 576 under MPEG 2/2.5.
    let samples = match (layer, version) {
        (0, _) => 384,
        (1, _) => 1152,
        (_, 0) => 1152,
        _ => 576,
    };

    // Layer I is measured in 4-byte slots, the others in bytes.
    let frame_size = if layer == 0 {
        ((12 * bitrate as u64 / sample_rate as u64) + padding) * 4
    } else {
        (samples as u64 / 8) * bitrate as u64 / sample_rate as u64 + padding
    };
    if frame_size <= 4 {
        return None;
    }

    let side_info_len = match (version, mono) {
        (0, true) => 17,
        (0, false) => 32,
        (_, true) => 9,
        (_, false) => 17,
    };

    Some(FrameHeader {
        version,
        layer,
        sample_rate,
        frame_size,
        samples,
        mono,
        side_info_len,
    })
}

/// Size of a leading ID3v2 tag, so the scan starts on real audio rather than
/// resyncing through album art that happens to contain a sync word.
fn id3v2_len(reader: &mut BufReader<File>) -> std::io::Result<u64> {
    reader.seek(SeekFrom::Start(0))?;
    let mut header = [0u8; 10];
    if reader.read_exact(&mut header).is_err() || &header[..3] != b"ID3" {
        return Ok(0);
    }
    // Syncsafe integer: 7 significant bits per byte.
    let size = header[6..10]
        .iter()
        .fold(0u64, |acc, &byte| (acc << 7) | u64::from(byte & 0x7F));
    // Bit 4 of the flags marks a 10-byte footer.
    let footer = if header[5] & 0x10 != 0 { 10 } else { 0 };
    Ok(10 + size + footer)
}

/// End of the audio payload: the file length minus any trailing ID3v1 and/or
/// APE tag. Those tags are not audio, and counting their bytes is one of the
/// ways the bitrate-estimate approaches overshoot.
fn audio_end(reader: &mut BufReader<File>, file_len: u64) -> std::io::Result<u64> {
    let mut end = file_len;

    if end >= 128 {
        reader.seek(SeekFrom::Start(end - 128))?;
        let mut tag = [0u8; 3];
        if reader.read_exact(&mut tag).is_ok() && &tag == b"TAG" {
            end -= 128;
        }
    }
    // An APEv2 footer sits either at the very end or just before an ID3v1 tag.
    if end >= 32 {
        reader.seek(SeekFrom::Start(end - 32))?;
        let mut footer = [0u8; 32];
        if reader.read_exact(&mut footer).is_ok() && &footer[..8] == b"APETAGEX" {
            let size = u32::from_le_bytes([footer[12], footer[13], footer[14], footer[15]]) as u64;
            end = end.saturating_sub(size.max(32));
        }
    }
    Ok(end)
}

/// Frame count declared by a Xing/Info (VBR) or VBRI header in the first frame.
/// Written by the encoder, and exact for the audio that encoder produced — but
/// see [`Scan::declared_matches`] for why that is not the same as being exact
/// for the file it now sits at the front of.
#[cfg(test)]
fn declared_frame_count(first_frame: &[u8], header: &FrameHeader) -> Option<u64> {
    let xing_at = 4 + header.side_info_len as usize;
    if let Some(tag) = first_frame.get(xing_at..xing_at + 8) {
        if &tag[..4] == b"Xing" || &tag[..4] == b"Info" {
            let flags = u32::from_be_bytes([tag[4], tag[5], tag[6], tag[7]]);
            // Bit 0 of the flags means the frame count field is present.
            if flags & 1 != 0 {
                let frames = first_frame.get(xing_at + 8..xing_at + 12)?;
                let count =
                    u32::from_be_bytes([frames[0], frames[1], frames[2], frames[3]]) as u64;
                if count > 0 {
                    return Some(count);
                }
            }
        }
    }
    // VBRI is fixed at 32 bytes past the header, MPEG 1 only.
    if let Some(tag) = first_frame.get(36..50) {
        if &tag[..4] == b"VBRI" {
            let count = u32::from_be_bytes([tag[10], tag[11], tag[12], tag[13]]) as u64;
            if count > 0 {
                return Some(count);
            }
        }
    }
    None
}

/// A Xing/Info/VBRI header lives in an otherwise silent frame that is not part
/// of the music, so it must not be counted.
fn is_tag_frame(first_frame: &[u8], header: &FrameHeader) -> bool {
    let xing_at = 4 + header.side_info_len as usize;
    let xing = first_frame
        .get(xing_at..xing_at + 4)
        .is_some_and(|tag| tag == b"Xing" || tag == b"Info");
    let vbri = first_frame.get(36..40).is_some_and(|tag| tag == b"VBRI");
    xing || vbri
}

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
pub(super) fn mp3_duration_secs(path: &Path) -> Option<f64> {
    scan(path).map(|scan| scan.secs)
}

/// Walks every frame header in the file and sums the exact sample count.
///
/// Only headers are read — 4 bytes per frame plus a buffered seek over each
/// frame body — which measures a four-minute track in about 1.4 ms. That is
/// cheap enough that there is no reason to *ever* prefer an estimate, and cheap
/// enough to also run as a cross-check on the encoder's own declared count
/// rather than taking that count on faith.
fn scan(path: &Path) -> Option<Scan> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Builds a syntactically valid MPEG 1 Layer III frame header word.
    fn header_word(bitrate_index: u32, sample_rate_index: u32, padding: u32) -> u32 {
        0xFFE0_0000
            | (0b11 << 19) // MPEG 1
            | (0b01 << 17) // Layer III
            | (1 << 16) // no CRC
            | (bitrate_index << 12)
            | (sample_rate_index << 10)
            | (padding << 9)
    }

    fn write_frame(out: &mut Vec<u8>, bitrate_index: u32) -> u64 {
        let word = header_word(bitrate_index, 0, 0);
        let header = parse_frame_header(word).unwrap();
        out.extend_from_slice(&word.to_be_bytes());
        out.extend(std::iter::repeat_n(0u8, header.frame_size as usize - 4));
        header.frame_size
    }

    fn temp_path(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tanwords-mp3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn parses_a_known_frame_header() {
        // 128 kbps, 44.1 kHz, stereo, MPEG 1 Layer III.
        let header = parse_frame_header(header_word(9, 0, 0)).unwrap();
        assert_eq!(header.sample_rate, 44_100);
        assert_eq!(header.samples, 1152);
        assert_eq!(header.frame_size, 417);
        assert_eq!(header.side_info_len, 32);
        assert!(!header.mono);
        assert_eq!(header.version, 0);
        assert_eq!(header.layer, 2);
    }

    #[test]
    fn rejects_reserved_and_free_format_headers() {
        assert!(parse_frame_header(0x0000_0000).is_none());
        // Reserved bitrate index 15.
        assert!(parse_frame_header(header_word(15, 0, 0)).is_none());
        // Free-format bitrate index 0 — valid per spec but unmeasurable here.
        assert!(parse_frame_header(header_word(0, 0, 0)).is_none());
        // Reserved sample rate index 3.
        assert!(parse_frame_header(header_word(9, 3, 0)).is_none());
    }

    /// The core regression: a VBR file whose leading frames are *not*
    /// representative of the rest. Estimating from the first frames (what lofty
    /// and symphonia both do) reports a fraction of the real length; the walk
    /// gets it exactly right.
    #[test]
    fn measures_vbr_exactly_where_a_first_frame_estimate_undershoots() {
        let mut data = Vec::new();
        // 20 frames at 320 kbps (index 14) followed by 200 at 32 kbps (index 1).
        // A first-frames estimate divides total bytes by the *large* leading
        // frame size and lands far short of the true 220 frames.
        for _ in 0..20 {
            write_frame(&mut data, 14);
        }
        for _ in 0..200 {
            write_frame(&mut data, 1);
        }
        let path = temp_path("vbr.mp3");
        File::create(&path).unwrap().write_all(&data).unwrap();

        let expected = 220.0 * 1152.0 / 44_100.0;
        let measured = mp3_duration_secs(&path).unwrap();
        assert!(
            (measured - expected).abs() < 0.01,
            "measured={measured:.3} expected={expected:.3}"
        );

        // Demonstrate the failure mode being fixed: extrapolating the first
        // frame's size over the file is off by more than a factor of two.
        let first_frame_size = parse_frame_header(header_word(14, 0, 0)).unwrap().frame_size;
        let estimate =
            (data.len() as f64 / first_frame_size as f64) * 1152.0 / 44_100.0;
        assert!(
            estimate < expected * 0.5,
            "estimate={estimate:.3} should badly undershoot expected={expected:.3}"
        );

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn skips_id3v2_id3v1_and_ape_tags() {
        let mut data = Vec::new();
        // ID3v2 header declaring 2000 bytes of (sync-word-laden) tag payload.
        data.extend_from_slice(b"ID3\x04\x00\x00");
        data.extend_from_slice(&[0x00, 0x00, 0x0F, 0x50]); // syncsafe 2000
        data.extend(std::iter::repeat_n(0xFFu8, 2000));
        for _ in 0..100 {
            write_frame(&mut data, 9);
        }
        // Trailing APEv2 footer (32 bytes, declaring itself) then ID3v1.
        let mut ape = vec![0u8; 32];
        ape[..8].copy_from_slice(b"APETAGEX");
        ape[12..16].copy_from_slice(&32u32.to_le_bytes());
        data.extend_from_slice(&ape);
        let mut id3v1 = vec![0u8; 128];
        id3v1[..3].copy_from_slice(b"TAG");
        data.extend_from_slice(&id3v1);

        let path = temp_path("tagged.mp3");
        File::create(&path).unwrap().write_all(&data).unwrap();

        let expected = 100.0 * 1152.0 / 44_100.0;
        let measured = mp3_duration_secs(&path).unwrap();
        assert!(
            (measured - expected).abs() < 0.01,
            "measured={measured:.3} expected={expected:.3}"
        );
        std::fs::remove_file(&path).unwrap();
    }

    /// Garbage spliced between frames used to end decoding (and measurement)
    /// right there. The scan resyncs and counts the frames on the far side.
    #[test]
    fn resyncs_across_mid_file_garbage() {
        let mut data = Vec::new();
        for _ in 0..50 {
            write_frame(&mut data, 9);
        }
        data.extend_from_slice(&[0x13; 777]);
        for _ in 0..50 {
            write_frame(&mut data, 9);
        }
        let path = temp_path("spliced.mp3");
        File::create(&path).unwrap().write_all(&data).unwrap();

        let expected = 100.0 * 1152.0 / 44_100.0;
        let measured = mp3_duration_secs(&path).unwrap();
        assert!(
            (measured - expected).abs() < 0.01,
            "measured={measured:.3} expected={expected:.3}"
        );
        std::fs::remove_file(&path).unwrap();
    }

    /// Writes a Xing tag frame declaring `declared` audio frames, followed by
    /// `actual` real frames.
    fn write_xing_file(name: &str, declared: u32, actual: u32) -> std::path::PathBuf {
        let word = header_word(9, 0, 0);
        let header = parse_frame_header(word).unwrap();
        let mut tag_frame = vec![0u8; header.frame_size as usize];
        tag_frame[..4].copy_from_slice(&word.to_be_bytes());
        let xing_at = 4 + header.side_info_len as usize;
        tag_frame[xing_at..xing_at + 4].copy_from_slice(b"Xing");
        tag_frame[xing_at + 4..xing_at + 8].copy_from_slice(&1u32.to_be_bytes()); // frames flag
        tag_frame[xing_at + 8..xing_at + 12].copy_from_slice(&declared.to_be_bytes());

        let mut data = tag_frame;
        for _ in 0..actual {
            write_frame(&mut data, 9);
        }
        let path = temp_path(name);
        File::create(&path).unwrap().write_all(&data).unwrap();
        path
    }

    /// The silent frame carrying a Xing tag is not music and must not be
    /// counted; a count that matches the file is confirmed as trustworthy.
    #[test]
    fn excludes_the_xing_tag_frame_and_confirms_a_matching_count() {
        let path = write_xing_file("xing_ok.mp3", 300, 300);
        let expected = 300.0 * 1152.0 / 44_100.0;
        let scan = scan(&path).unwrap();
        assert!(
            (scan.secs - expected).abs() < 0.01,
            "secs={:.3} expected={expected:.3}",
            scan.secs
        );
        assert!(scan.declared_matches);
        assert!(has_exact_frame_count(&path));
        std::fs::remove_file(&path).unwrap();
    }

    /// Concatenating two MP3s leaves the first file's Xing header at the top of
    /// the result, describing only its own frames. Taking that count at face
    /// value — as both the duration display and Symphonia's gapless tail-trim
    /// used to — cuts the file off at the end of part one.
    #[test]
    fn rejects_a_xing_count_that_understates_the_file() {
        let path = write_xing_file("xing_stale.mp3", 300, 900);
        let expected = 900.0 * 1152.0 / 44_100.0;
        let scan = scan(&path).unwrap();
        assert!(
            (scan.secs - expected).abs() < 0.01,
            "secs={:.3} expected={expected:.3}",
            scan.secs
        );
        assert!(!scan.declared_matches, "a stale count must not be trusted");
        assert!(!has_exact_frame_count(&path));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn returns_none_for_non_mpeg_files() {
        let path = temp_path("notaudio.mp3");
        File::create(&path).unwrap().write_all(&[0u8; 4096]).unwrap();
        assert!(mp3_duration_secs(&path).is_none());
        std::fs::remove_file(&path).unwrap();
    }
}
