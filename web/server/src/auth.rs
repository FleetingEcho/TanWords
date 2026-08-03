//! Bearer-token plumbing and a naive per-(bucket, IP) failure limiter.
//! Credentials and sessions themselves live in users.rs.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Beyond this many tracked (bucket, IP) pairs the limiter sweeps, and if that
/// does not free anything it refuses to grow. The map is keyed by an address
/// the caller effectively chooses — an IPv6 /64 is 18 quintillion of them —
/// so an unbounded map is a memory-exhaustion primitive handed to anyone who
/// can reach the login form.
const MAX_TRACKED: usize = 8_192;

/// Longest window any caller passes to `limited`. Entries older than this are
/// dead weight and can be swept regardless of which bucket they belong to.
const MAX_WINDOW: Duration = Duration::from_secs(600);

/// Sliding-window failure counter. Login and the key-gated routes share it
/// with different limits — key guessing gets a much tighter budget than
/// ordinary password typos.
pub struct RateLimiter {
    windows: Mutex<HashMap<(String, IpAddr), VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self { windows: Mutex::new(HashMap::new()) }
    }

    /// True when the caller has hit `max` failures within the trailing window.
    ///
    /// Read-only: a check must not create an entry. It used to `entry().or_default()`,
    /// which meant every request — including the successful ones, and including
    /// the first from an address that never fails — left a row behind forever.
    pub fn limited(&self, bucket: &str, ip: IpAddr, max: usize, window: Duration) -> bool {
        let mut windows = match self.windows.lock() {
            Ok(w) => w,
            Err(e) => e.into_inner(), // a poisoned limiter must never lock users in or out
        };
        let key = (bucket.to_string(), ip);
        let Some(entries) = windows.get_mut(&key) else {
            return false;
        };
        let cutoff = Instant::now().checked_sub(window).unwrap_or_else(Instant::now);
        while entries.front().is_some_and(|t| *t < cutoff) {
            entries.pop_front();
        }
        if entries.is_empty() {
            windows.remove(&key);
            return false;
        }
        entries.len() >= max
    }

    pub fn record_failure(&self, bucket: &str, ip: IpAddr) {
        let Ok(mut windows) = self.windows.lock() else {
            return;
        };
        let key = (bucket.to_string(), ip);
        if !windows.contains_key(&key) && windows.len() >= MAX_TRACKED {
            Self::sweep(&mut windows);
            if windows.len() >= MAX_TRACKED {
                // Full of live entries: we are already under a distributed
                // attack, and growing the map is the one thing that would
                // turn it into an outage. Existing entries keep limiting.
                return;
            }
        }
        let entries = windows.entry(key).or_default();
        // Per-key cap too: `max` is never anywhere near this, so anything past
        // it only feeds memory.
        if entries.len() < 64 {
            entries.push_back(Instant::now());
        }
    }

    pub fn clear(&self, bucket: &str, ip: IpAddr) {
        if let Ok(mut windows) = self.windows.lock() {
            windows.remove(&(bucket.to_string(), ip));
        }
    }

    /// Drops every entry whose failures have all aged out.
    fn sweep(windows: &mut HashMap<(String, IpAddr), VecDeque<Instant>>) {
        let cutoff = Instant::now().checked_sub(MAX_WINDOW).unwrap_or_else(Instant::now);
        windows.retain(|_, entries| entries.back().is_some_and(|t| *t >= cutoff));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip(n: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, n))
    }
    const WINDOW: Duration = Duration::from_secs(600);

    #[test]
    fn checking_does_not_create_an_entry() {
        let limiter = RateLimiter::new();
        for n in 0..50 {
            assert!(!limiter.limited("login", ip(n), 3, WINDOW));
        }
        // The bug this replaced: 50 clean checks used to leave 50 rows behind,
        // which is what made the map unbounded on ordinary traffic.
        assert_eq!(limiter.windows.lock().unwrap().len(), 0);
    }

    #[test]
    fn limits_after_the_budget_is_spent() {
        let limiter = RateLimiter::new();
        assert!(!limiter.limited("login", ip(1), 3, WINDOW));
        for _ in 0..3 {
            limiter.record_failure("login", ip(1));
        }
        assert!(limiter.limited("login", ip(1), 3, WINDOW));
        // Another address is unaffected — the point of keying by IP.
        assert!(!limiter.limited("login", ip(2), 3, WINDOW));
    }

    #[test]
    fn buckets_do_not_share_a_budget() {
        let limiter = RateLimiter::new();
        for _ in 0..5 {
            limiter.record_failure("invite", ip(1));
        }
        assert!(limiter.limited("invite", ip(1), 5, WINDOW));
        // Guessing at the invite key must not spend the admin allowance.
        assert!(!limiter.limited("admin", ip(1), 5, WINDOW));
    }

    #[test]
    fn success_clears_the_record() {
        let limiter = RateLimiter::new();
        limiter.record_failure("login", ip(1));
        limiter.clear("login", ip(1));
        assert_eq!(limiter.windows.lock().unwrap().len(), 0);
    }

    #[test]
    fn refuses_to_grow_without_bound() {
        let limiter = RateLimiter::new();
        // Every address distinct, as an attacker rotating through a /64 would.
        for n in 0..(MAX_TRACKED + 500) {
            let addr = IpAddr::V4(Ipv4Addr::from((n as u32).to_be_bytes()));
            limiter.record_failure("login", addr);
        }
        assert!(limiter.windows.lock().unwrap().len() <= MAX_TRACKED);
    }
}
