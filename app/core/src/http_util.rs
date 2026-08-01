//! Shared HTTP body reading with a hard size cap.
//!
//! The fetch sites (RSS feeds, article reader) all carry a 15s *duration*
//! timeout, but duration caps don't cap bytes: a fast or hostile server —
//! feed and article URLs are remote-controlled strings — could otherwise
//! stream unbounded data into memory within those 15 seconds, and the parser
//! (XML / full HTML DOM) then amplifies it further.

use futures_util::StreamExt;

/// Reads a response body with a hard byte cap, erroring past it.
pub(crate) async fn read_body_capped(
    resp: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Request failed: {e}"))?;
        if buf.len() + chunk.len() > max_bytes {
            return Err(format!("Response too large (limit is {} MB)", max_bytes / 1024 / 1024));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}
