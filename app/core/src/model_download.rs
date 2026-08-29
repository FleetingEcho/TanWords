//! Shared sherpa-onnx model downloader for the TTS and ASR download commands.
//!
//! Both commands used to carry byte-identical copies of this flow: allowlist
//! the URL, stream the tar.bz2 to a temp file with per-chunk progress events,
//! then extract on the blocking pool into a staging directory. One copy of the
//! flow lives here now; the two commands differ only in the release-tag
//! allowlist, the event name, and the model-recognition step that runs on the
//! unpacked directory.

use std::path::Path;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tokio::io::AsyncWriteExt;

use crate::shim::AppHandle;

#[derive(Serialize, Clone)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub(crate) enum DownloadProgress {
    Downloading { received: u64, total: u64 },
    Extracting,
}

/// Streams `url` to `tmp_path`, emitting `event` progress payloads, then
/// extracts the tar.bz2 into `staging_dir`. The caller keeps the staging →
/// atomic-rename → recognize sequence so a failed run only ever removes what
/// it created.
///
/// Connect must fail fast. The transfer itself gets NO total timeout — model
/// archives run to hundreds of MB on slow links — but each chunk does: a
/// dead connection otherwise sits in `stream.next()` forever with the UI
/// showing a frozen progress bar.
pub(crate) async fn download_and_extract(
    app: &AppHandle,
    url: &str,
    event: &str,
    tmp_path: &Path,
    staging_dir: &Path,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    // tokio::fs keeps every write off the async worker threads that service
    // other IPC commands.
    let mut file = tokio::fs::File::create(tmp_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut stream = resp.bytes_stream();
    loop {
        let chunk = match tokio::time::timeout(Duration::from_secs(60), stream.next()).await {
            Ok(Some(chunk)) => chunk.map_err(|e| format!("download failed: {e}"))?,
            Ok(None) => break,
            Err(_) => return Err("download stalled (no data for 60s)".to_string()),
        };
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        let _ = app.emit(
            event,
            DownloadProgress::Downloading { received, total },
        );
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    let _ = app.emit(event, DownloadProgress::Extracting);

    // bzip2+untar of a multi-hundred-MB archive is CPU-bound — keep it off
    // the async worker that services other IPC commands.
    let tmp = tmp_path.to_path_buf();
    let staging = staging_dir.to_path_buf();
    tokio::task::spawn_blocking(move || extract_tar_bz2(&tmp, &staging))
        .await
        .map_err(|e| format!("extract worker failed: {e}"))??;

    Ok(())
}

fn extract_tar_bz2(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let decompressed = bzip2::read::BzDecoder::new(file);
    let mut archive = tar::Archive::new(decompressed);
    archive.unpack(dest).map_err(|e| e.to_string())
}
