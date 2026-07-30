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
//! that count on faith (see `walker::Scan::declared_matches`).

mod header;
mod tags;
mod walker;

#[cfg(test)]
mod tests;

pub(super) use walker::mp3_duration_secs;
