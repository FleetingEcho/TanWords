use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use hkdf::Hkdf;
use rand::Rng;
use sha2::Sha256;

/// Crate-visible (not just `pub(super)`) because `secrets::device_key` mints
/// the AI-provider master key with it.
pub fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0_u8; N];
    rand::rng().fill_bytes(&mut bytes);
    bytes
}

/// The app-lock verifier. Same primitive as document keys, separate entry
/// point so it is obvious this one is only ever compared, never used to
/// encrypt anything.
pub fn derive_app_lock_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    derive_password_key(password, salt)
}

pub(super) fn derive_password_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Password derivation failed: {e}"))?;
    Ok(key)
}

/// HKDF-SHA256. Used to turn a *structured credential* (the Postgres
/// connection password) into a 32-byte key that unlocks the shared vault
/// key — see `secrets::vault_key`. Distinct from `derive_password_key`
/// (Argon2): Argon2 is the right tool for a slow human-typed password, but
/// the vault unlock input is already a machine-generated secret, so the
/// fast, deterministic HKDF is the correct choice. `info` binds the derived
/// key to its purpose so the same password can't be replayed into another
/// derivation.
pub fn derive_vault_unlock_key(password: &str, salt: &[u8], info: &[u8]) -> [u8; 32] {
    let mut key = [0_u8; 32];
    let hkdf = Hkdf::<Sha256>::new(Some(salt), password.as_bytes());
    // HKDF's expand is infallible for a 32-byte output (well under the
    // 255*HashLen ceiling); a non-Ok here is a programming error.
    hkdf.expand(info, &mut key)
        .expect("HKDF-SHA256 expand to 32 bytes cannot fail");
    key
}

pub fn encrypt_bytes(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let nonce = random::<12>();
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(&Nonce::from(nonce), plaintext)
        .map_err(|_| "Document encryption failed")?;
    let mut out = nonce.to_vec();
    out.extend(ciphertext);
    Ok(out)
}

pub fn decrypt_bytes(key: &[u8; 32], encrypted: &[u8]) -> Result<Vec<u8>, String> {
    if encrypted.len() < 12 {
        return Err("Invalid encrypted document data".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(
            // TryFrom keeps the length check — a malformed blob is an error
            // rather than a panic, and hybrid-array deprecated from_slice.
            Nonce::try_from(&encrypted[..12]).map_err(|_| "Invalid encrypted document data")?.as_ref(),
            &encrypted[12..],
        )
        .map_err(|_| "Document decryption failed".into())
}

pub fn encrypt_text(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    Ok(STANDARD.encode(encrypt_bytes(key, plaintext.as_bytes())?))
}

pub fn decrypt_text(key: &[u8; 32], encrypted: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(encrypted)
        .map_err(|_| "Invalid encrypted document text")?;
    String::from_utf8(decrypt_bytes(key, &bytes)?)
        .map_err(|_| "Invalid decrypted document text".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_bytes_round_trip_and_reject_wrong_key() {
        let key = random::<32>();
        let encrypted = encrypt_bytes(&key, b"private text").unwrap();
        assert_ne!(&encrypted[12..], b"private text");
        assert_eq!(decrypt_bytes(&key, &encrypted).unwrap(), b"private text");
        assert!(decrypt_bytes(&random::<32>(), &encrypted).is_err());
    }

    #[test]
    fn password_key_is_stable_for_the_same_salt() {
        let salt = random::<16>();
        assert_eq!(
            derive_password_key("secret", &salt).unwrap(),
            derive_password_key("secret", &salt).unwrap()
        );
        assert_ne!(
            derive_password_key("secret", &salt).unwrap(),
            derive_password_key("other", &salt).unwrap()
        );
    }

    #[test]
    fn vault_unlock_key_is_stable_and_distinct() {
        let salt = random::<16>();
        let info = b"tanwords-vault";
        // Same inputs → same key (so every device sharing one Postgres
        // password derives the same unlock key and opens the same vault key).
        assert_eq!(
            derive_vault_unlock_key("db-password", &salt, info),
            derive_vault_unlock_key("db-password", &salt, info)
        );
        // Different password, or different salt, or different info → different key.
        assert_ne!(
            derive_vault_unlock_key("db-password", &salt, info),
            derive_vault_unlock_key("other-password", &salt, info)
        );
        assert_ne!(
            derive_vault_unlock_key("db-password", &salt, info),
            derive_vault_unlock_key("db-password", &random::<16>(), info)
        );
        assert_ne!(
            derive_vault_unlock_key("db-password", &salt, info),
            derive_vault_unlock_key("db-password", &salt, b"other-purpose")
        );
    }
}
