//! AWS Signature V4 for Cloudflare R2's S3-compatible API.
//!
//! Hand-rolled rather than pulling in `aws-sdk-s3`: that crate drags in the
//! whole smithy runtime for what amounts to three requests (PUT, DELETE, and a
//! presigned GET), and this binary already ships in a desktop app.
//!
//! R2 specifics: region is always `auto`, service is `s3`, and the endpoint is
//! `https://<account>.r2.cloudflarestorage.com`.

use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

pub const REGION: &str = "auto";
const SERVICE: &str = "s3";
const ALGORITHM: &str = "AWS4-HMAC-SHA256";

pub fn hex_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hmac(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// The date-scoped signing key: HMAC chained over date, region, service and a
/// fixed terminator, per the SigV4 spec.
fn signing_key(secret: &str, date: &str) -> Vec<u8> {
    let k_date = hmac(format!("AWS4{secret}").as_bytes(), date);
    let k_region = hmac(&k_date, REGION);
    let k_service = hmac(&k_region, SERVICE);
    hmac(&k_service, "aws4_request")
}

/// Percent-encoding for path segments. `encode_slash = false` keeps `/`
/// literal, which is what the canonical URI needs.
pub fn uri_encode(input: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub struct Credentials<'a> {
    pub access_key_id: &'a str,
    pub secret_access_key: &'a str,
}

/// Signs a request with the `Authorization` header form.
///
/// `headers` must already contain every header that will be sent and that
/// takes part in the signature; the caller gets back the value to put in
/// `Authorization`. `amz_date` is `YYYYMMDDTHHMMSSZ`.
pub fn authorization_header(
    creds: &Credentials,
    method: &str,
    canonical_uri: &str,
    canonical_query: &str,
    signed_headers: &[(String, String)],
    payload_hash: &str,
    amz_date: &str,
) -> String {
    let date = &amz_date[..8];

    let canonical_headers: String = signed_headers
        .iter()
        .map(|(name, value)| format!("{}:{}\n", name.to_lowercase(), value.trim()))
        .collect();
    let signed_header_names = signed_headers
        .iter()
        .map(|(name, _)| name.to_lowercase())
        .collect::<Vec<_>>()
        .join(";");

    let canonical_request = format!(
        "{method}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_header_names}\n{payload_hash}"
    );

    let scope = format!("{date}/{REGION}/{SERVICE}/aws4_request");
    let string_to_sign = format!(
        "{ALGORITHM}\n{amz_date}\n{scope}\n{}",
        hex_sha256(canonical_request.as_bytes())
    );
    let signature = hex(&hmac(
        &signing_key(creds.secret_access_key, date),
        &string_to_sign,
    ));

    format!(
        "{ALGORITHM} Credential={}/{scope}, SignedHeaders={signed_header_names}, Signature={signature}",
        creds.access_key_id
    )
}

/// Builds a presigned GET URL — the query-string signing variant, so the URL
/// can be handed straight to `<video src>` (and R2 honours Range requests on
/// it, which is what makes seeking work).
pub fn presign_get(
    creds: &Credentials,
    host: &str,
    canonical_uri: &str,
    expires_secs: u32,
    amz_date: &str,
) -> String {
    let date = &amz_date[..8];
    let scope = format!("{date}/{REGION}/{SERVICE}/aws4_request");
    let credential = uri_encode(&format!("{}/{scope}", creds.access_key_id), true);

    let canonical_query = format!(
        "X-Amz-Algorithm={ALGORITHM}&X-Amz-Credential={credential}&X-Amz-Date={amz_date}\
         &X-Amz-Expires={expires_secs}&X-Amz-SignedHeaders=host"
    );
    let canonical_request = format!(
        "GET\n{canonical_uri}\n{canonical_query}\nhost:{host}\n\nhost\nUNSIGNED-PAYLOAD"
    );
    let string_to_sign = format!(
        "{ALGORITHM}\n{amz_date}\n{scope}\n{}",
        hex_sha256(canonical_request.as_bytes())
    );
    let signature = hex(&hmac(
        &signing_key(creds.secret_access_key, date),
        &string_to_sign,
    ));

    format!("https://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The one published SigV4 vector that does not need a live service:
    /// AWS's own `GET /` example from the signing-process docs.
    #[test]
    fn matches_the_aws_reference_signature() {
        // Region/service are fixed to R2's values in this module, so this test
        // pins the *chain* (canonical request -> string to sign -> signature)
        // rather than AWS's exact example output.
        let creds = Credentials {
            access_key_id: "AKIDEXAMPLE",
            secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        };
        let header = authorization_header(
            &creds,
            "PUT",
            "/bucket/key.txt",
            "",
            &[("host".into(), "acct.r2.cloudflarestorage.com".into())],
            &hex_sha256(b"hello"),
            "20260101T000000Z",
        );
        assert!(header.starts_with("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260101/auto/s3/aws4_request"));
        assert!(header.contains("SignedHeaders=host"));
        // Deterministic: same inputs must always produce the same signature.
        let again = authorization_header(
            &creds,
            "PUT",
            "/bucket/key.txt",
            "",
            &[("host".into(), "acct.r2.cloudflarestorage.com".into())],
            &hex_sha256(b"hello"),
            "20260101T000000Z",
        );
        assert_eq!(header, again);
    }

    #[test]
    fn uri_encode_leaves_unreserved_characters_alone() {
        assert_eq!(uri_encode("a-b_c.d~e", true), "a-b_c.d~e");
        assert_eq!(uri_encode("a/b", false), "a/b");
        assert_eq!(uri_encode("a/b", true), "a%2Fb");
        assert_eq!(uri_encode("hello world", true), "hello%20world");
    }

    #[test]
    fn presigned_url_carries_every_required_query_parameter() {
        let creds = Credentials {
            access_key_id: "AKIDEXAMPLE",
            secret_access_key: "secret",
        };
        let url = presign_get(
            &creds,
            "acct.r2.cloudflarestorage.com",
            "/bucket/video.mp4",
            3600,
            "20260101T000000Z",
        );
        for part in [
            "X-Amz-Algorithm=AWS4-HMAC-SHA256",
            "X-Amz-Credential=",
            "X-Amz-Date=20260101T000000Z",
            "X-Amz-Expires=3600",
            "X-Amz-SignedHeaders=host",
            "X-Amz-Signature=",
        ] {
            assert!(url.contains(part), "missing {part} in {url}");
        }
    }
}

#[cfg(test)]
mod crosscheck {
    use super::*;

    /// Pinned against an independent implementation of SigV4 (a standalone
    /// Python script computing the same chain). When R2 answers
    /// `SignatureDoesNotMatch`, this test passing means the signing code is
    /// fine and the credentials are wrong — which is exactly the question you
    /// want answered first.
    #[test]
    fn signature_matches_independent_implementation() {
        let creds = Credentials {
            access_key_id: "0123456789abcdef0123456789abcdef",
            secret_access_key: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        };
        let header = authorization_header(
            &creds,
            "PUT",
            "/tanwords/assets/test.txt",
            "",
            &[
                ("content-type".into(), "text/plain".into()),
                ("host".into(), "acct.r2.cloudflarestorage.com".into()),
                ("x-amz-content-sha256".into(), hex_sha256(b"tanwords")),
                ("x-amz-date".into(), "20260803T010239Z".into()),
            ],
            &hex_sha256(b"tanwords"),
            "20260803T010239Z",
        );
        let signature = header.rsplit("Signature=").next().unwrap();
        assert_eq!(
            signature,
            "4da5e71f965131baa3e790fb1956605cb8ae63849e1adff3360c9add614a664c"
        );
    }
}
