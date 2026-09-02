//! ntfy push reminders for calendar events.
//!
//! A self-hosted (or public) ntfy server receives one plain POST per
//! reminder — `POST {server}/{topic}` with a `Title` header and the message
//! as the body — and forwards it to every phone subscribed to that topic.
//! That single-request shape is the whole reason ntfy was chosen: no
//! provider account, no vendor SDK, and the topic name is the only
//! "credential" (see the settings section's warning about guessing it).
//!
//! Where this runs — the two build configurations want different owners:
//!
//! * **web server (`web` feature)** — `web/server` spawns one scheduler task
//!   at startup that walks every user's runtime every 30 seconds and calls
//!   [`tick`]. The server is the always-online process, so it owns the job;
//!   the desktop sidecar deliberately does *not* run a scheduler, because
//!   two senders over one shared database would mean duplicate pushes.
//! * **desktop** — no scheduler. The only thing this module does on desktop
//!   is the `ntfy_test_notification` command, so the settings page can
//!   verify the server/topic pair end to end.
//!
//! Configuration lives in the synced `user_settings` table (`ntfy_server_url`,
//! `ntfy_topic`, `ntfy_all_day_time`) so the desktop app and the web page —
//! which share a database — read the same reminders.
//!
//! The one-at-a-time guarantee is `calendar_events.reminder_sent_at`:
//! [`claim`] flips it with a `WHERE … IS NULL` guard, so even if two
//! scheduler passes ever overlapped, only one would see the row as
//! unsent. `db_update_calendar_event` clears the stamp whenever the start
//! time or the reminder setting changes, which is the "re-arm" rule.
//!
//! Trust model, same as `tts_remote`: on desktop the URL was typed by this
//! machine's user, so a plain client dials it (a LAN ntfy server is the
//! normal case). Under the `web` feature the dial goes through
//! `http_util::send_guarded` — resolve first, refuse private/loopback
//! targets, pin the connection, re-check every redirect — because the URL
//! comes from a logged-in user of a multi-user host. A *self-hosted ntfy
//! on the same LAN as the web server* is the one legitimate case that
//! guard refuses, so the host operator can opt back in with
//! `TANWORDS_NTFY_ALLOW_PRIVATE=1`; that is a server-wide decision made by
//! the person who owns the box, not a per-user setting.

use crate::db::{self, Conn};
use crate::shim::State;
use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;

/// Default all-day reminder time (`ntfy_all_day_time` overrides).
const DEFAULT_ALL_DAY_TIME: &str = "09:00";
/// One reminder POST is a few hundred bytes; 15s is generous.
const REQUEST_TIMEOUT_SECS: u64 = 15;

// ── configuration ───────────────────────────────────────────────────────────

/// The three synced settings this feature reads.
#[derive(Debug, Clone, PartialEq)]
pub struct NtfyConfig {
    pub server_url: String,
    pub topic: String,
    /// `HH:mm`, the time of day an all-day event reminds. Defaults to 09:00.
    pub all_day_time: String,
}

impl NtfyConfig {
    /// Reminders fire only when both the server and the topic are set — an
    /// empty topic would POST to the server root, which is not a push.
    pub fn enabled(&self) -> bool {
        !self.server_url.trim().is_empty() && !self.topic.trim().is_empty()
    }

    /// The parsed morning reminder time, or the default when the stored
    /// setting is absent or malformed.
    fn all_day_naive_time(&self) -> NaiveTime {
        parse_hhmm(&self.all_day_time).unwrap_or_else(|| {
            parse_hhmm(DEFAULT_ALL_DAY_TIME).expect("default parses")
        })
    }
}

/// Reads the ntfy settings from `user_settings`.
pub async fn load_config(conn: &Conn) -> Result<NtfyConfig, String> {
    Ok(NtfyConfig {
        server_url: read_string_setting(conn, "ntfy_server_url").await?,
        topic: read_string_setting(conn, "ntfy_topic").await?,
        all_day_time: read_string_setting(conn, "ntfy_all_day_time").await?,
    })
}

/// One synced `user_settings` string, defaulting to "". `get_setting` keeps
/// JSON-encoded values (the renderer persists with `JSON.stringify`), while
/// older rows may still contain raw text — same tolerance `tts_remote`
/// applies to its voice setting.
async fn read_string_setting(conn: &Conn, key: &str) -> Result<String, String> {
    let raw = db::settings::get_setting(conn, key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_string_setting(raw))
}

fn parse_string_setting(raw: Option<String>) -> String {
    raw.map(|value| serde_json::from_str::<String>(&value).unwrap_or(value))
        .unwrap_or_default()
}

fn parse_hhmm(raw: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(raw.trim(), "%H:%M").ok()
}

// ── due computation (pure) ──────────────────────────────────────────────────

/// One unsent reminder candidate, as the scheduler sees it.
#[derive(Debug, Clone)]
pub(crate) struct DueEvent {
    pub id: String,
    pub title: String,
    /// DB wire: `YYYY-MM-DD` (all-day) or `YYYY-MM-DD HH:mm` (timed).
    pub start: String,
    pub all_day: bool,
    /// Timed: minutes before start. All-day: ignored (stored as 0).
    pub reminder_minutes: i64,
}

/// When this event's reminder becomes due, if the wire strings parse.
///
/// * timed — `start` minus the lead time;
/// * all-day — the start *date* at the configured morning time, so the
///   reminder lands on the day itself rather than the night before.
pub(crate) fn reminder_due_at(
    start: &str,
    all_day: bool,
    reminder_minutes: i64,
    all_day_time: &str,
) -> Option<NaiveDateTime> {
    if all_day {
        let date = NaiveDate::parse_from_str(start.trim(), "%Y-%m-%d").ok()?;
        let time = parse_hhmm(all_day_time)
            .unwrap_or_else(|| parse_hhmm(DEFAULT_ALL_DAY_TIME).expect("default parses"));
        Some(date.and_time(time))
    } else {
        let dt = NaiveDateTime::parse_from_str(start.trim(), "%Y-%m-%d %H:%M").ok()?;
        Some(dt - chrono::Duration::minutes(reminder_minutes))
    }
}

/// The moment the reminder stops being worth sending: the event's start for
/// timed events (after that it's not a reminder, it's an obituary), and the
/// end of the all-day date for all-day events (a missed 9am still matters at
/// 2pm, but not the next day).
pub(crate) fn reminder_deadline(start: &str, all_day: bool) -> Option<NaiveDateTime> {
    if all_day {
        let date = NaiveDate::parse_from_str(start.trim(), "%Y-%m-%d").ok()?;
        Some(date.succ_opt()?.and_hms_opt(0, 0, 0)?)
    } else {
        NaiveDateTime::parse_from_str(start.trim(), "%Y-%m-%d %H:%M").ok()
    }
}

/// The send window is `[due, deadline)`: a reminder that became due while the
/// scheduler was down still fires on the next pass (late is better than
/// silent), but one whose event already began (timed) or whose day already
/// ended (all-day) never does.
pub(crate) fn is_due(ev: &DueEvent, cfg: &NtfyConfig, now: NaiveDateTime) -> bool {
    let Some(due) = reminder_due_at(&ev.start, ev.all_day, ev.reminder_minutes, &cfg.all_day_time)
    else {
        return false;
    };
    let Some(deadline) = reminder_deadline(&ev.start, ev.all_day) else {
        return false;
    };
    due <= now && now < deadline
}

/// The notification body (English by decision — the event title itself is
/// passed through verbatim whatever language it is in).
pub(crate) fn message_body(ev: &DueEvent, now: NaiveDateTime) -> String {
    if ev.all_day {
        return format!("Today: {}", ev.title);
    }
    let starts_in = NaiveDateTime::parse_from_str(ev.start.trim(), "%Y-%m-%d %H:%M")
        .map(|start| start.signed_duration_since(now).num_minutes())
        .unwrap_or(0);
    if starts_in > 0 {
        format!("In {} minutes: {}", starts_in, ev.title)
    } else {
        format!("Starts now: {}", ev.title)
    }
}

// ── database side ───────────────────────────────────────────────────────────

/// One calendar event row in the shape the scheduler needs.
#[derive(Serialize)]
struct ReminderRow {
    id: String,
    title: String,
    start: String,
    all_day: bool,
    reminder_minutes: i64,
}

/// Every unsent reminder whose window is open at `now`, oldest first.
pub async fn due_events(conn: &Conn, cfg: &NtfyConfig, now: NaiveDateTime) -> Result<Vec<DueEvent>, String> {
    // The table is a personal calendar — dozens of rows, not thousands — so
    // the window math is cheaper in Rust than it would ever be correct in
    // TEXT-arithmetic SQL.
    let rows = db::fetch_all(
        conn,
        "SELECT id, title, \"start\", all_day, reminder_minutes
         FROM calendar_events
         WHERE reminder_minutes IS NOT NULL AND reminder_sent_at IS NULL
         ORDER BY \"start\" ASC, id ASC",
        (),
        |r| {
            Ok(ReminderRow {
                id: r.get(0)?,
                title: r.get(1)?,
                start: r.get(2)?,
                all_day: r.get::<i64>(3)? != 0,
                reminder_minutes: r.get::<i64>(4)?,
            })
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| DueEvent {
            id: r.id,
            title: r.title,
            start: r.start,
            all_day: r.all_day,
            reminder_minutes: r.reminder_minutes,
        })
        .filter(|ev| is_due(ev, cfg, now))
        .collect())
}

/// Atomically marks one event's reminder as sent. Returns `false` when
/// another writer claimed it first — the caller skips, exactly one push
/// goes out.
pub async fn claim(conn: &Conn, id: &str) -> Result<bool, String> {
    let affected = conn
        .execute(
            "UPDATE calendar_events SET reminder_sent_at = datetime('now')
             WHERE id = ?1 AND reminder_sent_at IS NULL",
            db::params![id],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(affected == 1)
}

/// Undoes a claim after a failed send so the next pass retries instead of
/// the reminder being silently swallowed.
pub async fn unclaim(conn: &Conn, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE calendar_events SET reminder_sent_at = NULL WHERE id = ?1",
        db::params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── sending ─────────────────────────────────────────────────────────────────

/// The POST target: `{server}/{topic}` with the exact topic the phone
/// subscribed to. Trimmed so a pasted trailing slash on the server doesn't
/// create a `//topic` 404.
pub(crate) fn publish_url(cfg: &NtfyConfig) -> Result<String, String> {
    let server = cfg.server_url.trim().trim_end_matches('/');
    let topic = cfg.topic.trim();
    if server.is_empty() || topic.is_empty() {
        return Err("ntfy server URL and topic must both be set".into());
    }
    // The topic is a path segment: a stray `/` would silently split it into
    // two and push to the wrong (nonexistent) topic.
    if topic.contains('/') {
        return Err("ntfy topic must not contain '/'".into());
    }
    Ok(format!("{server}/{topic}"))
}

/// Sends one reminder. Desktop: plain pooled client (a LAN server is the
/// point). Web: `send_guarded`, unless the host operator opted into private
/// targets with `TANWORDS_NTFY_ALLOW_PRIVATE=1`.
async fn send(cfg: &NtfyConfig, ev: &DueEvent, now: NaiveDateTime) -> Result<(), String> {
    send_raw(cfg, "TanWords reminder", &message_body(ev, now)).await
}

/// Sends an arbitrary message through the configured ntfy server — the
/// reminder path and the settings page's test button share it.
async fn send_raw(cfg: &NtfyConfig, title: &str, body: &str) -> Result<(), String> {
    let url = publish_url(cfg)?;
    let title = title.to_string();
    let body = body.to_string();
    #[cfg(feature = "web")]
    {
        // The operator's explicit, server-wide decision — see the module
        // docs for why this is an env var and not a per-user setting.
        let allow_private = std::env::var("TANWORDS_NTFY_ALLOW_PRIVATE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if !allow_private {
            let response = crate::http_util::send_guarded(&url, move |client, url| {
                client
                    .post(url)
                    .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                    .header("Title", title.clone())
                    .body(body.clone())
            })
            .await?;
            return read_response(response).await;
        }
    }
    // Desktop, or web with the operator opt-in.
    let response = reqwest::Client::new()
        .post(&url)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .header("Title", title)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("ntfy request failed: {e}"))?;
    read_response(response).await
}

/// ntfy answers JSON (a message envelope on success, an error object on
/// failure) — only the status matters here, so the body is surfaced as the
/// error preview when something went wrong.
async fn read_response(response: reqwest::Response) -> Result<(), String> {
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("ntfy response read failed: {e}"))?;
    if !status.is_success() {
        let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(240)]).to_string();
        return Err(format!("ntfy returned {}: {}", status.as_u16(), preview));
    }
    Ok(())
}

// ── scheduler entry point ───────────────────────────────────────────────────

/// One scheduler pass over one database: find due unsent reminders, claim
/// each, push it. A failed push unclaims so the next pass retries. Returns
/// how many were sent. `web/server` calls this per user every 30 seconds;
/// errors are per-event and never abort the pass (one unreachable ntfy
/// server must not stop the other users' reminders).
pub async fn tick(conn: &Conn) -> Result<usize, String> {
    let cfg = load_config(conn).await?;
    if !cfg.enabled() {
        return Ok(0);
    }
    let now = chrono::Local::now().naive_local();
    let mut sent = 0;
    for ev in due_events(conn, &cfg, now).await? {
        if !claim(conn, &ev.id).await? {
            continue;
        }
        match send(&cfg, &ev, now).await {
            Ok(()) => sent += 1,
            Err(e) => {
                eprintln!("[ntfy] reminder for `{}` failed: {e}", ev.title);
                if let Err(unclaim_err) = unclaim(conn, &ev.id).await {
                    // Worse than the send failure itself: the reminder is
                    // now marked sent and will never fire. Loud is correct.
                    eprintln!("[ntfy] could not unclaim `{}`: {unclaim_err}", ev.id);
                }
            }
        }
    }
    Ok(sent)
}

// ── command ─────────────────────────────────────────────────────────────────

/// Fires one "it works" push through the configured server+topic, so the
/// settings page can verify the pair end to end before relying on it.
#[crate::shim::command]
pub async fn ntfy_test_notification(conn: State<'_, crate::AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let cfg = load_config(&db).await?;
    if !cfg.enabled() {
        return Err("ntfy server URL and topic must be saved first".into());
    }
    send_raw(
        &cfg,
        "TanWords reminder",
        "This is a test notification. Calendar reminders will arrive like this.",
    )
    .await
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(all_day_time: &str) -> NtfyConfig {
        NtfyConfig {
            server_url: "https://ntfy.example.com".into(),
            topic: "tanwords-test".into(),
            all_day_time: all_day_time.into(),
        }
    }

    fn at(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    fn ev(start: &str, all_day: bool, minutes: i64) -> DueEvent {
        DueEvent {
            id: "e1".into(),
            title: "Vocabulary review".into(),
            start: start.into(),
            all_day,
            reminder_minutes: minutes,
        }
    }

    #[test]
    fn timed_reminder_window_is_due_minus_start() {
        // 10:00 event, 30-minute reminder.
        let e = ev("2026-08-30 10:00", false, 30);
        let c = cfg("09:00");
        // 09:29 — one minute early.
        assert!(!is_due(&e, &c, at("2026-08-30 09:29")));
        // 09:30 — due, and stays due until the event starts.
        assert!(is_due(&e, &c, at("2026-08-30 09:30")));
        assert!(is_due(&e, &c, at("2026-08-30 09:59")));
        // 10:00 — the event began; a reminder now is noise.
        assert!(!is_due(&e, &c, at("2026-08-30 10:00")));
    }

    #[test]
    fn late_reminder_still_fires_within_the_window() {
        // The scheduler was down at 09:30; 09:41 must still send.
        let e = ev("2026-08-30 10:00", false, 30);
        assert!(is_due(&e, &cfg("09:00"), at("2026-08-30 09:41")));
    }

    #[test]
    fn all_day_reminder_uses_the_morning_time_all_day() {
        let e = ev("2026-08-30", true, 0);
        // 08:00 with the default 09:00 setting — not yet.
        assert!(!is_due(&e, &cfg("09:00"), at("2026-08-30 08:00")));
        // 09:00 sharp, and still at 23:59 — the day isn't over.
        assert!(is_due(&e, &cfg("09:00"), at("2026-08-30 09:00")));
        assert!(is_due(&e, &cfg("09:00"), at("2026-08-30 23:59")));
        // A custom morning time moves the due time, not the deadline.
        assert!(!is_due(&e, &cfg("08:30"), at("2026-08-30 08:00")));
        assert!(is_due(&e, &cfg("08:30"), at("2026-08-30 08:30")));
        // Next day 00:00 — the event's day has passed.
        assert!(!is_due(&e, &cfg("09:00"), at("2026-08-31 00:00")));
    }

    #[test]
    fn malformed_wire_strings_are_never_due() {
        assert!(!is_due(&ev("not-a-date", false, 30), &cfg("09:00"), at("2026-08-30 09:00")));
        assert!(reminder_due_at("garbage", false, 30, "09:00").is_none());
        assert!(reminder_deadline("garbage", false).is_none());
    }

    #[test]
    fn message_body_is_english_with_verbatim_title() {
        assert_eq!(
            message_body(&ev("2026-08-30 10:00", false, 30), at("2026-08-30 09:30")),
            "In 30 minutes: Vocabulary review"
        );
        // A late send names the truth instead of a negative count.
        assert_eq!(
            message_body(&ev("2026-08-30 10:00", false, 30), at("2026-08-30 10:00")),
            "Starts now: Vocabulary review"
        );
        assert_eq!(
            message_body(&ev("2026-08-30", true, 0), at("2026-08-30 09:00")),
            "Today: Vocabulary review"
        );
    }

    #[test]
    fn publish_url_joins_and_rejects_bad_topics() {
        assert_eq!(
            publish_url(&NtfyConfig {
                server_url: "https://ntfy.example.com/".into(),
                topic: " my-topic ".into(),
                all_day_time: String::new(),
            })
            .unwrap(),
            "https://ntfy.example.com/my-topic"
        );
        // A topic with a slash would push to a different topic, silently.
        assert!(publish_url(&NtfyConfig {
            server_url: "https://ntfy.example.com".into(),
            topic: "a/b".into(),
            all_day_time: String::new(),
        })
        .is_err());
    }

    #[test]
    fn config_parsing_tolerates_missing_quoted_and_raw() {
        assert_eq!(parse_string_setting(None), "");
        assert_eq!(parse_string_setting(Some("\"x\"".into())), "x");
        assert_eq!(parse_string_setting(Some("y".into())), "y");
    }

    #[test]
    fn enabled_requires_both_server_and_topic() {
        assert!(cfg("09:00").enabled());
        assert!(!NtfyConfig { server_url: String::new(), topic: "t".into(), all_day_time: String::new() }.enabled());
        assert!(!NtfyConfig { server_url: "https://x".into(), topic: " ".into(), all_day_time: String::new() }.enabled());
    }

    #[test]
    fn malformed_all_day_time_falls_back_to_the_default() {
        let c = NtfyConfig { server_url: String::new(), topic: String::new(), all_day_time: "25:99".into() };
        assert_eq!(c.all_day_naive_time(), parse_hhmm("09:00").unwrap());
    }

    /// Serves one canned response on an ephemeral loopback listener, returning
    /// the address and a channel with whatever the client sent (the same
    /// miniature-HTTP-server trick `tts_remote`'s tests use).
    async fn one_shot_server(
        status: &'static str,
        body: &'static str,
    ) -> (std::net::SocketAddr, tokio::sync::oneshot::Receiver<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            // One read is the whole request at loopback speed: headers plus
            // the short body arrive in the first segment (same assumption
            // tts_remote's one-shot server makes).
            let mut buf = [0u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            let _ = tx.send(request);
            let out = format!("HTTP/1.1 {status}\r\ncontent-length: {}\r\n\r\n{body}", body.len());
            let _ = socket.write_all(out.as_bytes()).await;
        });
        (addr, rx)
    }

    #[tokio::test]
    async fn send_posts_to_the_topic_with_a_title() {
        let (addr, rx) = one_shot_server("200 OK", "{}").await;
        let c = NtfyConfig {
            server_url: format!("http://{addr}"),
            topic: "my-topic".into(),
            all_day_time: String::new(),
        };
        send_raw(&c, "TanWords reminder", "hello world").await.expect("send");
        let request = rx.await.expect("server saw the request");
        assert!(request.starts_with("POST /my-topic "), "path is the topic: {request}");
        assert!(request.to_lowercase().contains("title: tanwords reminder"), "title header: {request}");
        assert!(request.ends_with("hello world"), "body: {request}");
    }

    #[tokio::test]
    async fn send_surfaces_error_status_and_body() {
        let (addr, _rx) = one_shot_server("404 Not Found", r#"{"error":"topic not found"}"#).await;
        let c = NtfyConfig {
            server_url: format!("http://{addr}"),
            topic: "ghost".into(),
            all_day_time: String::new(),
        };
        let err = send_raw(&c, "t", "b").await.expect_err("must fail");
        assert!(err.contains("404"), "status in message: {err}");
    }

    /// End to end through `tick`: an in-memory database with settings, a due
    /// event and an unsent one; a real loopback server standing in for ntfy.
    /// Verifies the whole chain — config load, due query, claim, POST — and
    /// that a second pass sends nothing (`reminder_sent_at` held).
    #[tokio::test]
    async fn tick_sends_due_reminders_exactly_once() {
        use crate::db::connection::DbKind;
        let database = crate::db::connection::open_memory().await.expect("memory db");
        let conn = database.conn();
        assert_eq!(conn.kind(), DbKind::Local);
        crate::db::init_db(&conn).await.expect("init");

        // A loopback "ntfy server" that records pushes and answers 200. It
        // must outlive both tick passes, so it counts requests rather than
        // closing after one.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let pushes = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let server = tokio::spawn({
            let pushes = pushes.clone();
            async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                loop {
                    let Ok((mut socket, _)) = listener.accept().await else { break };
                    let pushes = pushes.clone();
                    tokio::spawn(async move {
                        let mut buf = [0u8; 4096];
                        let _ = socket.read(&mut buf).await;
                        pushes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        let _ = socket
                            .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}")
                            .await;
                    });
                }
            }
        });

        // Point the config at the loopback server.
        for (key, value) in [
            ("ntfy_server_url", format!("http://{addr}")),
            ("ntfy_topic", "tanwords-test".to_string()),
        ] {
            crate::db::settings::set_setting(&conn, key, &serde_json::to_string(&value).unwrap())
                .await
                .unwrap();
        }

        // One event due right now (starts in 10 minutes, 30-minute reminder),
        // one not yet due (starts in 2 hours).
        let now = chrono::Local::now().naive_local();
        let soon = (now + chrono::Duration::minutes(10)).format("%Y-%m-%d %H:%M").to_string();
        let later = (now + chrono::Duration::minutes(120)).format("%Y-%m-%d %H:%M").to_string();
        for (title, start) in [("Due now", soon.as_str()), ("Much later", later.as_str())] {
            conn.execute(
                "INSERT INTO calendar_events (id, calendar_id, title, \"start\", \"end\", all_day, reminder_minutes)
                 VALUES (?1, 'default', ?2, ?3, ?3, 0, 30)",
                crate::db::params![title, title, start],
            )
            .await
            .unwrap();
        }

        let sent = tick(&conn).await.expect("tick");
        assert_eq!(sent, 1, "only the due event fires");
        // Give the spawned connection handler a beat to record the push.
        for _ in 0..50 {
            if pushes.load(std::sync::atomic::Ordering::SeqCst) >= 1 { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(pushes.load(std::sync::atomic::Ordering::SeqCst), 1);

        // The claim is durable: a second pass sends nothing new.
        let sent_again = tick(&conn).await.expect("second tick");
        assert_eq!(sent_again, 0);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(pushes.load(std::sync::atomic::Ordering::SeqCst), 1);

        server.abort();
    }
}
