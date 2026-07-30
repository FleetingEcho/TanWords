use super::header::parse_frame_header;
use super::walker::{has_exact_frame_count, mp3_duration_secs, scan};
use std::fs::File;
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
