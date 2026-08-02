//! Bearer-token plumbing and a naive per-(bucket, IP) failure limiter.
//! Credentials and sessions themselves live in users.rs.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Sliding-window failure counter. Login and the invite-key-gated routes share
/// it with different limits — invite guessing gets a much tighter budget than
/// ordinary password typos.
pub struct RateLimiter {
    windows: Mutex<HashMap<(String, IpAddr), VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self { windows: Mutex::new(HashMap::new()) }
    }

    /// True when the caller has hit `max` failures within the trailing window.
    pub fn limited(&self, bucket: &str, ip: IpAddr, max: usize, window: Duration) -> bool {
        let mut windows = match self.windows.lock() {
            Ok(w) => w,
            Err(e) => e.into_inner(), // a poisoned limiter must never lock users in or out
        };
        let entries = windows.entry((bucket.to_string(), ip)).or_default();
        let cutoff = Instant::now().checked_sub(window).unwrap_or_else(Instant::now);
        while entries.front().is_some_and(|t| *t < cutoff) {
            entries.pop_front();
        }
        entries.len() >= max
    }

    pub fn record_failure(&self, bucket: &str, ip: IpAddr) {
        if let Ok(mut windows) = self.windows.lock() {
            windows
                .entry((bucket.to_string(), ip))
                .or_default()
                .push_back(Instant::now());
        }
    }

    pub fn clear(&self, bucket: &str, ip: IpAddr) {
        if let Ok(mut windows) = self.windows.lock() {
            windows.remove(&(bucket.to_string(), ip));
        }
    }
}

/// `Authorization: Bearer <token>` — tolerates any header case the way
/// HeaderMap already normalizes, nothing fancier.
pub fn bearer_token(request: &axum::http::Request<axum::body::Body>) -> Option<String> {
    request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Length-checked byte-wise compare — used for the invite key, where a timing
/// side channel is the only thing protecting the registration door.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
