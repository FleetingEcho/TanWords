use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};

/// Size of a leading ID3v2 tag, so the scan starts on real audio rather than
/// resyncing through album art that happens to contain a sync word.
pub(super) fn id3v2_len(reader: &mut BufReader<File>) -> std::io::Result<u64> {
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
pub(super) fn audio_end(reader: &mut BufReader<File>, file_len: u64) -> std::io::Result<u64> {
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
