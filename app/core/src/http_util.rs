//! Shared outbound-HTTP plumbing: a hard body cap, and — in server builds —
//! the SSRF guard every user-supplied URL goes through.
//!
//! The fetch sites (RSS feeds, article reader) all carry a 15s *duration*
//! timeout, but duration caps don't cap bytes: a fast or hostile server —
//! feed and article URLs are remote-controlled strings — could otherwise
//! stream unbounded data into memory within those 15 seconds, and the parser
//! (XML / full HTML DOM) then amplifies it further.

use std::time::Duration;

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

/// How many hops a guarded fetch will follow before giving up. reqwest's own
/// default is 10; the lower number here is deliberate — every hop costs a DNS
/// round trip and a fresh client under the guard.
#[cfg(feature = "web")]
const MAX_REDIRECTS: usize = 5;

/// Fetches a user-supplied URL.
///
/// On desktop this is an ordinary request: the process runs on the user's own
/// machine, where "can reach 127.0.0.1" describes the user's own browser and
/// is not a privilege worth defending against.
///
/// In the server build (`web` feature) the same call is a different act. The
/// process sits on a host with private neighbours — a cloud metadata endpoint
/// handing out IAM credentials to anything that asks, other services on the
/// LAN, the server's own loopback ports — and the URL is chosen by whoever is
/// logged in. So under that feature this resolves the host first, refuses any
/// answer that lands in private address space, **pins** the connection to the
/// address it validated (`ClientBuilder::resolve`, so the name cannot resolve
/// to something else between the check and the connect), and repeats the whole
/// procedure for every redirect hop rather than letting reqwest follow a 302
/// somewhere unchecked.
pub(crate) async fn fetch_guarded(
    url: &str,
    user_agent: &str,
    timeout: Duration,
    decorate: impl Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    #[cfg(not(feature = "web"))]
    {
        // One shared client: connection pooling across feeds/reader fetches
        // (a per-call `Client::new()` threw the pool away every time). UA and
        // the duration stay per-request.
        static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
        let client = CLIENT.get_or_init(|| {
            reqwest::Client::builder()
                .build()
                .expect("static reqwest client config is valid")
        });
        decorate(
            client
                .get(url)
                .timeout(timeout)
                .header(reqwest::header::USER_AGENT, user_agent),
        )
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))
    }

    #[cfg(feature = "web")]
    {
        let mut current = url.to_string();
        for _ in 0..=MAX_REDIRECTS {
            let (host, addr) = guard::resolve_public(&current).await?;
            let client = reqwest::Client::builder()
                .user_agent(user_agent)
                .timeout(timeout)
                // Redirects are followed by this loop, not by reqwest: the
                // whole point is that the next hop gets checked too.
                .redirect(reqwest::redirect::Policy::none())
                // Pins the name to the address just validated. Without it the
                // check and the connection are two separate lookups, and a
                // hostile DNS server only has to answer the second one with
                // 169.254.169.254.
                .resolve(&host, addr)
                .build()
                .map_err(|e| e.to_string())?;
            let response = decorate(client.get(&current))
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;

            if !response.status().is_redirection() {
                return Ok(response);
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "Server sent a redirect with no destination".to_string())?;
            // Relative Locations are legal and common; resolve against the URL
            // that produced them before the next hop is checked.
            let base = reqwest::Url::parse(&current).map_err(|e| e.to_string())?;
            current = base
                .join(location)
                .map_err(|_| "Server redirected to an unusable address".to_string())?
                .to_string();
        }
        Err("Too many redirects".to_string())
    }
}

/// Sends an arbitrary server-dialed request to a user-supplied URL, guarded
/// hop by hop.
///
/// This is `fetch_guarded` generalized past GET for the web server's two
/// proxies (browser proxy, AI provider proxy): they forward a caller-chosen
/// method, headers and body, and both must not let a redirect or a second
/// DNS lookup escape the check. `build` receives a fresh no-redirect client
/// pinned to the validated address and the current URL, and returns the
/// request to send; redirects are followed by this loop, each hop re-guarded.
/// No total timeout is applied here — the proxy routes legitimately stream
/// long bodies — only connection setup is capped.
#[cfg(feature = "web")]
pub async fn send_guarded(
    url: &str,
    build: impl Fn(reqwest::Client, &str) -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let mut current = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let (host, addr) = guard::resolve_public(&current).await?;
        let client = reqwest::Client::builder()
            // Redirects are followed by this loop, not by reqwest: the whole
            // point is that the next hop gets checked too.
            .redirect(reqwest::redirect::Policy::none())
            // Pins the name to the address just validated. Without it the
            // check and the connection are two separate lookups, and a
            // hostile DNS server only has to answer the second one with
            // 169.254.169.254.
            .resolve(&host, addr)
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let response = build(client, &current)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !response.status().is_redirection() {
            return Ok(response);
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| "Server sent a redirect with no destination".to_string())?;
        let base = reqwest::Url::parse(&current).map_err(|e| e.to_string())?;
        current = base
            .join(location)
            .map_err(|_| "Server redirected to an unusable address".to_string())?
            .to_string();
    }
    Err("Too many redirects".to_string())
}

#[cfg(feature = "web")]
pub mod guard {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

    /// Refused because reaching it means reaching something that is not the
    /// public internet: the host itself, the LAN it sits on, or the cloud
    /// metadata service (169.254.169.254 — link-local, covered below).
    pub fn is_private(ip: IpAddr) -> bool {
        match ip {
            IpAddr::V4(v4) => is_private_v4(v4),
            IpAddr::V6(v6) => is_private_v6(v6),
        }
    }

    fn is_private_v4(ip: Ipv4Addr) -> bool {
        let [a, b, ..] = ip.octets();
        ip.is_private()            // 10/8, 172.16/12, 192.168/16
            || ip.is_loopback()    // 127/8
            || ip.is_link_local()  // 169.254/16 — the metadata endpoint
            || ip.is_broadcast()
            || ip.is_documentation()
            || ip.is_unspecified()
            || a == 0              // "this network"
            || (a == 100 && (b & 0xc0) == 64) // 100.64/10 carrier-grade NAT
            || a >= 224            // multicast (224/4) and reserved (240/4)
    }

    fn is_private_v6(ip: Ipv6Addr) -> bool {
        // An IPv4 address wearing an IPv6 hat is still that IPv4 address —
        // ::ffff:127.0.0.1 must not be a way around the table above.
        if let Some(v4) = ip.to_ipv4_mapped() {
            return is_private_v4(v4);
        }
        if let Some(v4) = ip.to_ipv4() {
            return is_private_v4(v4);
        }
        ip.is_loopback()
            || ip.is_unspecified()
            || ip.is_multicast()
            || (ip.segments()[0] & 0xfe00) == 0xfc00 // fc00::/7 unique local
            || (ip.segments()[0] & 0xffc0) == 0xfe80 // fe80::/10 link local
    }

    /// Validates scheme and host, resolves the name, and returns the host plus
    /// one address that passed — the caller pins the connection to it.
    ///
    /// Every answer must pass, not merely one: a name that resolves to both a
    /// public address and 127.0.0.1 is a name trying to get somewhere it
    /// should not, and picking the "good" one would reward the attempt.
    pub async fn resolve_public(url: &str) -> Result<(String, SocketAddr), String> {
        let parsed = reqwest::Url::parse(url).map_err(|_| "Not a valid URL".to_string())?;
        match parsed.scheme() {
            "http" | "https" => {}
            other => return Err(format!("Unsupported URL scheme `{other}`")),
        }
        let host = parsed
            .host_str()
            .ok_or_else(|| "URL has no host".to_string())?
            .to_string();
        let port = parsed
            .port_or_known_default()
            .ok_or_else(|| "URL has no port".to_string())?;

        // A literal address skips DNS but not the check.
        if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
            if is_private(ip) {
                return Err(refusal());
            }
            return Ok((host, SocketAddr::new(ip, port)));
        }

        let resolved: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|e| format!("Could not resolve `{host}`: {e}"))?
            .collect();
        if resolved.is_empty() {
            return Err(format!("Could not resolve `{host}`"));
        }
        if resolved.iter().any(|addr| is_private(addr.ip())) {
            return Err(refusal());
        }
        Ok((host, resolved[0]))
    }

    /// One message for every rejection: which of the private ranges was hit is
    /// information the caller does not need and a prober would enjoy.
    fn refusal() -> String {
        "That address is not reachable from this server".to_string()
    }
}

#[cfg(all(test, feature = "web"))]
mod tests {
    use super::guard::is_private;
    use std::net::IpAddr;

    fn ip(s: &str) -> IpAddr {
        s.parse().expect("test address parses")
    }

    #[test]
    fn blocks_the_places_an_ssrf_wants_to_go() {
        // The cloud metadata endpoint is the whole reason this exists.
        assert!(is_private(ip("169.254.169.254")));
        assert!(is_private(ip("127.0.0.1")));
        assert!(is_private(ip("10.0.0.5")));
        assert!(is_private(ip("172.16.0.1")));
        assert!(is_private(ip("192.168.1.1")));
        assert!(is_private(ip("100.64.0.1"))); // carrier-grade NAT
        assert!(is_private(ip("0.0.0.0")));
        assert!(is_private(ip("::1")));
        assert!(is_private(ip("fd00::1"))); // unique local
        assert!(is_private(ip("fe80::1"))); // link local
    }

    #[test]
    fn an_ipv4_address_in_an_ipv6_hat_is_still_that_address() {
        assert!(is_private(ip("::ffff:127.0.0.1")));
        assert!(is_private(ip("::ffff:169.254.169.254")));
    }

    #[test]
    fn lets_the_public_internet_through() {
        assert!(!is_private(ip("1.1.1.1")));
        assert!(!is_private(ip("140.82.121.4"))); // github
        assert!(!is_private(ip("2606:4700:4700::1111")));
    }

    #[tokio::test]
    async fn refuses_non_http_schemes_and_private_literals() {
        assert!(super::guard::resolve_public("file:///etc/passwd").await.is_err());
        assert!(super::guard::resolve_public("http://127.0.0.1:8740/").await.is_err());
        assert!(super::guard::resolve_public("http://169.254.169.254/latest/meta-data/").await.is_err());
        assert!(super::guard::resolve_public("http://[::1]/").await.is_err());
    }
}
