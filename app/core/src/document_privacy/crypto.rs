use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::{rngs::OsRng, RngCore};

/// Crate-visible (not just `pub(super)`) because `secrets::device_key` mints
/// the AI-provider master key with it.
pub fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0_u8; N];
    OsRng.fill_bytes(&mut bytes);
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

pub fn encrypt_bytes(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let nonce = random::<12>();
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
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
        .decrypt(Nonce::from_slice(&encrypted[..12]), &encrypted[12..])
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
}
