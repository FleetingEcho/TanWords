//! Exact MP4/M4A audio duration from the selected media track's `mdhd` box.
//!
//! Symphonia occasionally derives `n_frames` from an incomplete AAC sample
//! table and reports a plausible but much shorter duration. The container's
//! media header already stores the exact duration and time scale.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub(super) fn audio_duration_secs(path: &Path) -> Option<f64> {
    let extension = path.extension()?.to_str()?;
    if !extension.eq_ignore_ascii_case("mp4") && !extension.eq_ignore_ascii_case("m4a") {
        return None;
    }

    let mut file = File::open(path).ok()?;
    let file_len = file.metadata().ok()?.len();
    let mut position = 0u64;
    let mut indexed_duration: Option<f64> = None;
    while position + 8 <= file_len {
        file.seek(SeekFrom::Start(position)).ok()?;
        let (size, kind, header_len) = read_box_header(&mut file, file_len - position)?;
        if &kind == b"moov" || &kind == b"sidx" {
            let payload_len = usize::try_from(size.checked_sub(header_len)?).ok()?;
            let mut payload = vec![0u8; payload_len];
            file.read_exact(&mut payload).ok()?;
            if &kind == b"moov" {
                if let Some(duration) = moov_audio_duration(&payload) {
                    return Some(duration);
                }
            } else if let Some(duration) = parse_sidx(&payload) {
                indexed_duration =
                    Some(indexed_duration.map_or(duration, |current| current.max(duration)));
            }
        }
        position = position.checked_add(size)?;
    }
    indexed_duration
}

fn read_box_header(file: &mut File, remaining: u64) -> Option<(u64, [u8; 4], u64)> {
    let mut header = [0u8; 8];
    file.read_exact(&mut header).ok()?;
    let size32 = u32::from_be_bytes(header[..4].try_into().ok()?);
    let kind = header[4..8].try_into().ok()?;
    let (size, header_len) = match size32 {
        0 => (remaining, 8),
        1 => {
            let mut extended = [0u8; 8];
            file.read_exact(&mut extended).ok()?;
            (u64::from_be_bytes(extended), 16)
        }
        value => (u64::from(value), 8),
    };
    (size >= header_len && size <= remaining).then_some((size, kind, header_len))
}

fn moov_audio_duration(moov: &[u8]) -> Option<f64> {
    child_boxes(moov)
        .filter(|(kind, _)| kind == b"trak")
        .filter_map(|(_, trak)| track_audio_duration(trak))
        .reduce(f64::max)
}

fn track_audio_duration(trak: &[u8]) -> Option<f64> {
    let mdia = child_boxes(trak).find_map(|(kind, data)| (kind == *b"mdia").then_some(data))?;
    let mut is_audio = false;
    let mut media_header = None;
    let mut sample_duration = None;
    for (kind, data) in child_boxes(mdia) {
        match &kind {
            b"hdlr" if data.len() >= 12 => is_audio = &data[8..12] == b"soun",
            b"mdhd" => media_header = parse_mdhd(data),
            b"minf" => sample_duration = parse_sample_duration(data),
            _ => {}
        }
    }
    if !is_audio {
        return None;
    }
    let (timescale, declared_duration) = media_header?;
    let duration = declared_duration.filter(|value| *value > 0).or(sample_duration)?;
    (timescale > 0 && duration > 0).then_some(duration as f64 / timescale as f64)
}

fn parse_mdhd(data: &[u8]) -> Option<(u32, Option<u64>)> {
    let version = *data.first()?;
    let (timescale_offset, duration_offset, duration_len) = match version {
        0 => (12, 16, 4),
        1 => (20, 24, 8),
        _ => return None,
    };
    let timescale = u32::from_be_bytes(
        data.get(timescale_offset..timescale_offset + 4)?
            .try_into()
            .ok()?,
    );
    let duration = match duration_len {
        4 => u64::from(u32::from_be_bytes(
            data.get(duration_offset..duration_offset + 4)?
                .try_into()
                .ok()?,
        )),
        _ => u64::from_be_bytes(
            data.get(duration_offset..duration_offset + 8)?
                .try_into()
                .ok()?,
        ),
    };
    Some((timescale, (duration > 0).then_some(duration)))
}

fn parse_sample_duration(minf: &[u8]) -> Option<u64> {
    let stbl = child_boxes(minf).find_map(|(kind, data)| (kind == *b"stbl").then_some(data))?;
    let stts = child_boxes(stbl).find_map(|(kind, data)| (kind == *b"stts").then_some(data))?;
    let entry_count = usize::try_from(u32::from_be_bytes(stts.get(4..8)?.try_into().ok()?)).ok()?;
    let entries = stts.get(8..8usize.checked_add(entry_count.checked_mul(8)?)?)?;
    entries.chunks_exact(8).try_fold(0u64, |total, entry| {
        let count = u64::from(u32::from_be_bytes(entry[..4].try_into().ok()?));
        let delta = u64::from(u32::from_be_bytes(entry[4..].try_into().ok()?));
        total.checked_add(count.checked_mul(delta)?)
    })
}

/// Fragmented MP4 keeps empty `mdhd`/`stts` durations and declares segment
/// timing in one or more top-level Segment Index boxes instead.
fn parse_sidx(data: &[u8]) -> Option<f64> {
    let version = *data.first()?;
    let timescale = u32::from_be_bytes(data.get(8..12)?.try_into().ok()?);
    let (count_offset, entries_offset): (usize, usize) = match version {
        0 => (22, 24),
        1 => (30, 32),
        _ => return None,
    };
    let count = usize::from(u16::from_be_bytes(
        data.get(count_offset..count_offset + 2)?
            .try_into()
            .ok()?,
    ));
    let entries = data.get(entries_offset..entries_offset.checked_add(count.checked_mul(12)?)?)?;
    let duration = entries.chunks_exact(12).try_fold(0u64, |total, entry| {
        total.checked_add(u64::from(u32::from_be_bytes(
            entry[4..8].try_into().ok()?,
        )))
    })?;
    (timescale > 0 && duration > 0).then_some(duration as f64 / timescale as f64)
}

fn child_boxes(mut data: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    std::iter::from_fn(move || {
        if data.len() < 8 {
            return None;
        }
        let size32 = u32::from_be_bytes(data[..4].try_into().ok()?);
        let kind: [u8; 4] = data[4..8].try_into().ok()?;
        let (size, header_len) = match size32 {
            0 => (data.len(), 8),
            1 if data.len() >= 16 => (
                usize::try_from(u64::from_be_bytes(data[8..16].try_into().ok()?)).ok()?,
                16,
            ),
            value => (usize::try_from(value).ok()?, 8),
        };
        if size < header_len || size > data.len() {
            data = &[];
            return None;
        }
        let payload = &data[header_len..size];
        data = &data[size..];
        Some((kind, payload))
    })
}
