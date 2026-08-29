//! Remote TTS through a user-configured, OpenAI-compatible speech endpoint.
//!
//! `POST {api_base}/audio/speech` with `{model, input, voice, response_format:
//! "wav"}` is the OpenAI speech API shape, and a whole ecosystem speaks it:
//! OpenAI and Groq themselves, and — the reason this module exists — the
//! official Audio8 TTS ONNX service, whose `/v1/audio/speech` answers with a
//! WAV while the model itself (an `arktts` architecture) is far too new for
//! sherpa-onnx to load. Anything that speaks the shape works; the model field
//! is passed through verbatim.
//!
//! Deliberately *not* part of the `tts` feature: nothing here touches
//! sherpa-onnx or ONNX at all, and both build configurations that want it
//! (desktop sidecar, web server) already exist — but keeping the dependency
//! surface honest means a future "web-no-tts" build keeps remote speech.
//!
//! The provider row (see `db::ai_providers`) carries the base URL, model id
//! and the API key sealed — the same storage chat providers use — so no new
//! table and no new secret-handling path. The voice is a synced setting, not
//! part of the provider: Audio8 names its registered voices per service
//! (`speaker_a`, …) while OpenAI's are fixed (`alloy`, `echo`, …), so the same
//! provider row can serve several voices without duplicating sealed keys.

use crate::db;
use serde_json::{json, Value};

/// Maximum wall time for one synthesis call. CPU-class TTS endpoints (the
/// Audio8 ONNX runtime among them) can take tens of seconds for a long
/// sentence; the cap exists to keep a wedged endpoint from holding an IPC
/// slot forever, not to police response times.
const REQUEST_TIMEOUT_SECS: u64 = 180;

/// What `tts_remote_synthesize` needs to know to build and send one request.
/// Split out as a plain struct so the pure assembly is testable without any
/// network, socket, or state.
#[derive(Debug, PartialEq)]
pub(crate) struct RemoteSpeechRequest {
    pub url: String,
    pub api_key: String,
    pub body: Value,
}

/// Assembles the OpenAI-shaped request for one synthesis call.
///
/// * `base` — the provider's API base, conventionally including the version
///   path (`https://api.openai.com/v1`, `http://127.0.0.1:8024/v1`); the
///   `/audio/speech` suffix is appended after trimming a trailing `/`.
/// * `model` — passed through verbatim (`tts-1`, `arktts`, …). Empty falls
///   back to OpenAI's `tts-1`, because a missing field is a 400 on every
///   server of this shape.
/// * `voice` — sent only when non-empty: OpenAI would reject the missing
///   field, but some self-hosted services voice-pick server-side and reject
///   *unknown* names, so forcing a default in would break them.
/// * `speed` — sent only when it differs from 1.0 for the same reason: the
///   OpenAI API accepts 0.25–4.0, and an explicit neutral value is an unknown
///   field on servers that never implemented the parameter.
pub(crate) fn build_request(
    base: &str,
    model: &str,
    voice: &str,
    text: &str,
    speed: f32,
) -> Result<RemoteSpeechRequest, String> {
    let base = base.trim();
    if base.is_empty() {
        return Err("TTS provider has no base URL configured".into());
    }
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err(format!("TTS provider base URL must start with http:// or https:// (got {base})"));
    }
    let url = format!("{}/audio/speech", base.trim_end_matches('/'));

    let mut body = json!({
        "model": if model.trim().is_empty() { "tts-1" } else { model.trim() },
        "input": text,
        "response_format": "wav",
    });
    if !voice.trim().is_empty() {
        body["voice"] = json!(voice.trim());
    }
    if (speed - 1.0).abs() > f32::EPSILON {
        body["speed"] = json!(speed.clamp(0.25, 4.0));
    }
    Ok(RemoteSpeechRequest { url, api_key: String::new(), body })
}

/// Sends the assembled request and returns the raw response bytes.
///
/// Two trust models, one code path:
/// * desktop sidecar — the URL was typed by this machine's user into their
///   own provider settings; reaching `127.0.0.1` is exactly the point (the
///   Audio8 service lives there). A plain pooled client is used.
/// * web server (`web` feature) — the URL arrives from a logged-in user of a
///   multi-user host, so the dial goes through `http_util::send_guarded`,
///   which resolves first, refuses private/loopback/link-local targets, pins
///   the connection to the validated address, and re-checks every redirect
///   hop (same contract as the AI provider proxy).
async fn send_request(req: &RemoteSpeechRequest, api_key: &str) -> Result<Vec<u8>, String> {
    #[cfg(not(feature = "web"))]
    {
        // Serialized by hand rather than `.json(...)`: the core's reqwest
        // build does not carry the `json` feature (the web server's does, but
        // keeping this path dependency-free keeps a future build from
        // silently requiring it).
        let body = serde_json::to_string(&req.body).map_err(|e| e.to_string())?;
        let response = reqwest::Client::new()
            .post(&req.url)
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .bearer_auth(api_key)
            .body(body)
            .send()
            .await
            .map_err(|e| format!("remote TTS request failed: {e}"))?;
        read_response(response).await
    }

    #[cfg(feature = "web")]
    {
        let body = req.body.clone();
        let api_key = api_key.to_string();
        let response = crate::http_util::send_guarded(&req.url, move |client, url| {
            let mut builder = client
                .request(reqwest::Method::POST, url)
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .header(reqwest::header::CONTENT_TYPE, "application/json");
            if !api_key.is_empty() {
                // Cloned per call: `send_guarded` takes an `Fn` and may
                // re-invoke it for each redirect hop.
                builder = builder.bearer_auth(api_key.clone());
            }
            builder.json(&body)
        })
        .await?;
        read_response(response).await
    }
}

/// Checks the HTTP status and hands back the payload, turning upstream error
/// bodies (which are JSON in this ecosystem) into a short, visible message.
async fn read_response(response: reqwest::Response) -> Result<Vec<u8>, String> {
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("remote TTS response read failed: {e}"))?;
    if !status.is_success() {
        let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(240)]).to_string();
        return Err(format!("remote TTS returned {}: {}", status.as_u16(), preview));
    }
    Ok(bytes.to_vec())
}

/// Synthesizes speech through the configured OpenAI-compatible endpoint.
///
/// Returns base64-encoded WAV, the exact contract `tts_synthesize` already
/// uses, so the renderer's playback path (base64 → Blob → `Audio`) does not
/// care which engine produced the bytes.
///
/// Configuration lives in two places:
/// * provider row `tts_remote_provider_id` (kind `"tts"`, device-scoped,
///   sealed key) — base URL and model;
/// * synced settings `tts_remote_voice` — voice name (see the module docs).
#[crate::shim::command]
pub async fn tts_remote_synthesize(
    state: crate::shim::State<'_, crate::AppState>,
    text: String,
    speed: f32,
) -> Result<String, String> {
    let conn = db::conn(&state)?;
    let device = crate::appconfig::device_id();

    let provider_id = read_string_setting(&conn, "tts_remote_provider_id").await?;
    if provider_id.is_empty() {
        return Err("remote TTS is not selected".into());
    }
    let voice = read_string_setting(&conn, "tts_remote_voice").await?;

    let providers = db::ai_providers::list(&conn, &device).await?;
    let provider = providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| {
            format!("TTS provider `{provider_id}` is not configured on this device")
        })?;

    let api_key = db::ai_providers::key(&conn, &device, &provider_id).await?;

    let req = build_request(&provider.api_base, &provider.model_id, &voice, &text, speed)?;
    let wav = send_request(&req, &api_key).await?;

    if !wav.starts_with(b"RIFF") {
        // A 200 that isn't WAV means the endpoint "answered" but not in the
        // negotiated format — e.g. an HTML login page from a misconfigured
        // proxy. Surfacing a snippet beats handing the player garbage bytes.
        let preview = String::from_utf8_lossy(&wav[..wav.len().min(200)]).to_string();
        return Err(format!(
            "remote TTS returned a non-WAV response ({len} bytes): {preview}",
            len = wav.len(),
        ));
    }
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(wav))
}

/// One synced `user_settings` string, defaulting to "" — `get_setting` keeps
/// JSON-encoded values (the renderer persists with `JSON.stringify`), while
/// older rows may still contain raw text.
async fn read_string_setting(conn: &db::Conn, key: &str) -> Result<String, String> {
    let raw = db::settings::get_setting(conn, key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_string_setting(raw))
}

fn parse_string_setting(raw: Option<String>) -> String {
    raw.map(|value| serde_json::from_str::<String>(&value).unwrap_or(value))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_openai_shaped_request() {
        let req = build_request(
            "http://127.0.0.1:8024/v1/",
            "arktts",
            "speaker_a",
            "Hello there.",
            1.0,
        )
        .expect("valid provider");
        assert_eq!(req.url, "http://127.0.0.1:8024/v1/audio/speech");
        assert_eq!(req.body["model"], "arktts");
        assert_eq!(req.body["input"], "Hello there.");
        assert_eq!(req.body["voice"], "speaker_a");
        assert_eq!(req.body["response_format"], "wav");
        // Neutral speed is omitted — an unknown field on servers that never
        // implemented it.
        assert!(req.body.get("speed").is_none());
    }

    #[test]
    fn defaults_and_omits_tolerantly() {
        // Empty model falls back to OpenAI's default; empty voice is omitted.
        let req = build_request("https://api.openai.com/v1", "", "", "Hi", 1.0)
            .expect("valid");
        assert_eq!(req.body["model"], "tts-1");
        assert!(req.body.get("voice").is_none());

        // Non-neutral speed is clamped into the OpenAI-legal range and sent.
        let req = build_request("https://api.openai.com/v1", "tts-1", "alloy", "Hi", 9.0)
            .expect("valid");
        assert_eq!(req.body["speed"], 4.0);
    }

    #[test]
    fn rejects_bases_without_a_scheme() {
        assert!(build_request("127.0.0.1:8024/v1", "m", "v", "t", 1.0).is_err());
        assert!(build_request("", "m", "v", "t", 1.0).is_err());
    }

    #[test]
    fn string_setting_accepts_missing_quoted_and_raw_values() {
        // Optional settings such as `tts_remote_voice` are legitimately absent;
        // an empty value lets OpenAI-compatible servers apply their default.
        assert_eq!(parse_string_setting(None), "");

        // Synced settings arrive JSON-encoded from the renderer.
        assert_eq!(
            parse_string_setting(Some("\"speaker_a\"".into())),
            "speaker_a"
        );

        // Keep compatibility with settings written before JSON encoding.
        assert_eq!(parse_string_setting(Some("speaker_b".into())), "speaker_b");
    }

    /// Serves one canned response on an ephemeral loopback listener and
    /// returns the bound address — a miniature HTTP server for exercising
    /// `send_request` end to end on the desktop (unguarded) code path.
    async fn one_shot_server(
        status: &'static str,
        headers: &'static str,
        body: Vec<u8>,
    ) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = [0u8; 4096];
            // Drain the request (we don't parse it — one read is enough to
            // let the client finish sending; small JSON bodies arrive in the
            // first segment at loopback speeds).
            let _ = socket.read(&mut buf).await;
            let mut out = format!("HTTP/1.1 {status}\r\n{headers}\r\n\r\n").into_bytes();
            out.extend_from_slice(&body);
            let _ = socket.write_all(&out).await;
        });
        addr
    }

    fn tiny_wav() -> Vec<u8> {
        // A well-formed RIFF header followed by 16 bytes of data — the
        // response parser only inspects the magic + length today, but the
        // fixture is a real header shape so the test stays meaningful if the
        // validation ever grows.
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&36u32.to_le_bytes()); // rest-of-file length
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
        wav.extend_from_slice(&[0u8; 16]);
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&[0u8; 16]);
        wav
    }

    #[tokio::test]
    async fn send_request_round_trips_wav() {
        let wav = tiny_wav();
        let addr = one_shot_server("200 OK", "content-type: audio/wav", wav.clone()).await;
        let req = build_request(&format!("http://{addr}/v1"), "arktts", "v", "text", 1.0)
            .expect("request");
        let out = send_request(&req, "secret-key").await.expect("synth");
        assert_eq!(out, wav);
    }

    #[tokio::test]
    async fn send_request_surfaces_error_bodies() {
        let addr = one_shot_server(
            "404 Not Found",
            "content-type: application/json",
            br#"{"error":"no such voice"}"#.to_vec(),
        )
        .await;
        let req = build_request(&format!("http://{addr}/v1"), "arktts", "ghost", "t", 1.0)
            .expect("request");
        let err = send_request(&req, "").await.expect_err("must fail");
        assert!(err.contains("404"), "status in message: {err}");
        assert!(err.contains("no such voice"), "body in message: {err}");
    }
}
