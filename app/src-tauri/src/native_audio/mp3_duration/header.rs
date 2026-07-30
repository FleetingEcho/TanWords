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
    pub(super) version: usize,
    /// 0 = Layer I, 1 = Layer II, 2 = Layer III
    pub(super) layer: usize,
    pub(super) sample_rate: u32,
    /// Total bytes of this frame including the 4 header bytes.
    pub(super) frame_size: u64,
    pub(super) samples: u32,
    pub(super) mono: bool,
    /// Bytes between the end of the header and a Xing/Info tag, if this frame
    /// were to carry one.
    pub(super) side_info_len: u64,
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

/// Frame count declared by a Xing/Info (VBR) or VBRI header in the first frame.
/// Written by the encoder, and exact for the audio that encoder produced — but
/// see `walker::Scan::declared_matches` for why that is not the same as being
/// exact for the file it now sits at the front of.
#[cfg(test)]
pub(super) fn declared_frame_count(first_frame: &[u8], header: &FrameHeader) -> Option<u64> {
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
pub(super) fn is_tag_frame(first_frame: &[u8], header: &FrameHeader) -> bool {
    let xing_at = 4 + header.side_info_len as usize;
    let xing = first_frame
        .get(xing_at..xing_at + 4)
        .is_some_and(|tag| tag == b"Xing" || tag == b"Info");
    let vbri = first_frame.get(36..40).is_some_and(|tag| tag == b"VBRI");
    xing || vbri
}
