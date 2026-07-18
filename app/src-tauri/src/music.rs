use std::path::Path;

use serde::Serialize;
use walkdir::WalkDir;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "m4a", "flac", "ogg", "aac"];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrack {
    pub path: String,
    pub title: String,
    pub artist: Option<String>,
    pub duration_sec: Option<f64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MusicCollection {
    /// First-level subfolder name; empty string for files sitting directly in
    /// the root (the frontend renders its own "uncategorized" label for it).
    pub name: String,
    pub tracks: Vec<MusicTrack>,
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Collection key for a file: its first path component relative to the scan
/// root, or "" when it sits directly in the root.
fn collection_name(root: &Path, file: &Path) -> String {
    file.strip_prefix(root)
        .ok()
        .and_then(|rel| {
            let mut comps = rel.components();
            let first = comps.next()?;
            // A lone component means the file itself is in the root.
            comps.next()?;
            Some(first.as_os_str().to_string_lossy().to_string())
        })
        .unwrap_or_default()
}

/// ID3v1/v2.3 tags written by Chinese rippers are usually GBK bytes that the
/// spec (and lofty) decode as Latin-1, yielding mojibake like "ÖÜ½ÜÂ×" for
/// "周杰伦". If every char fits in Latin-1 and the byte string round-trips
/// cleanly through GBK, prefer that reading; real Latin-1 text (ASCII,
/// Western European) is left untouched.
fn fix_legacy_encoding(s: String) -> String {
    let suspicious = s.chars().any(|c| ('\u{80}'..'\u{100}').contains(&c));
    if !suspicious || s.chars().any(|c| c as u32 > 0xFF) {
        return s;
    }
    let bytes: Vec<u8> = s.chars().map(|c| c as u32 as u8).collect();
    let (decoded, _, had_errors) = encoding_rs::GBK.decode(&bytes);
    if had_errors { s } else { decoded.into_owned() }
}

fn read_metadata(path: &Path) -> (Option<String>, Option<String>, Option<f64>) {
    use lofty::file::TaggedFileExt;
    use lofty::prelude::*;

    match lofty::read_from_path(path) {
        Ok(tagged) => {
            let duration = tagged.properties().duration().as_secs_f64();
            let (title, artist) = tagged
                .primary_tag()
                .or_else(|| tagged.first_tag())
                .map(|tag| {
                    (
                        tag.title().map(|s| fix_legacy_encoding(s.to_string())),
                        tag.artist().map(|s| fix_legacy_encoding(s.to_string())),
                    )
                })
                .unwrap_or((None, None));
            (title, artist, Some(duration))
        }
        Err(_) => (None, None, None),
    }
}

fn scan_library(root: &Path) -> Result<Vec<MusicCollection>, String> {
    if !root.is_dir() {
        return Err(format!("not a directory: {}", root.display()));
    }

    let mut groups: std::collections::BTreeMap<String, Vec<MusicTrack>> =
        std::collections::BTreeMap::new();

    for entry in WalkDir::new(root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_audio_file(path) {
            continue;
        }
        let (title, artist, duration_sec) = read_metadata(path);
        let fallback_title = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string());
        groups
            .entry(collection_name(root, path))
            .or_default()
            .push(MusicTrack {
                path: path.to_string_lossy().to_string(),
                title: title.filter(|t| !t.trim().is_empty()).unwrap_or(fallback_title),
                artist,
                duration_sec,
            });
    }

    let mut collections: Vec<MusicCollection> = groups
        .into_iter()
        .map(|(name, mut tracks)| {
            tracks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
            MusicCollection { name, tracks }
        })
        .collect();
    // Root-level loose files ("") go last, named folders first in name order.
    collections.sort_by(|a, b| match (a.name.is_empty(), b.name.is_empty()) {
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(collections)
}

/// Scans the user's configured music folder into per-subfolder collections.
/// Stateless by design: the library is re-scanned on each page visit, so file
/// additions/removals never need cache invalidation.
#[tauri::command]
pub async fn music_scan_library(root: String) -> Result<Vec<MusicCollection>, String> {
    // Metadata parsing is blocking I/O over potentially many files — keep it
    // off the async IPC thread.
    tauri::async_runtime::spawn_blocking(move || scan_library(Path::new(&root)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"").unwrap();
    }

    #[test]
    fn groups_by_first_level_folder_and_filters_extensions() {
        let dir = std::env::temp_dir().join(format!("tanwords-music-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        touch(&dir.join("loose.mp3"));
        touch(&dir.join("notes.txt"));
        touch(&dir.join("podcasts/ep1.MP3"));
        touch(&dir.join("podcasts/nested/deep/ep2.wav"));
        touch(&dir.join("recordings/interview.m4a"));

        let collections = scan_library(&dir).unwrap();
        let summary: Vec<(String, Vec<String>)> = collections
            .iter()
            .map(|c| (c.name.clone(), c.tracks.iter().map(|t| t.title.clone()).collect()))
            .collect();

        assert_eq!(
            summary,
            vec![
                ("podcasts".into(), vec!["ep1".into(), "ep2".into()]),
                ("recordings".into(), vec!["interview".into()]),
                ("".into(), vec!["loose".into()]),
            ]
        );
        // Empty stub files aren't parseable audio — metadata falls back gracefully.
        assert!(collections[0].tracks[0].duration_sec.is_none());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn regbk_decodes_latin1_mojibake_but_leaves_real_text_alone() {
        // "周杰伦" in GBK bytes, mis-decoded as Latin-1 by ID3 readers.
        assert_eq!(fix_legacy_encoding("ÖÜ½ÜÂ×".to_string()), "周杰伦");
        assert_eq!(fix_legacy_encoding("plain ascii".to_string()), "plain ascii");
        // Already-correct UTF-8 CJK must pass through untouched.
        assert_eq!(fix_legacy_encoding("周杰伦".to_string()), "周杰伦");
    }

    #[test]
    fn rejects_missing_directory() {
        assert!(scan_library(Path::new("/nonexistent/tanwords-music")).is_err());
    }
}
