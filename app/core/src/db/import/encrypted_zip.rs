//! Password-protected zip backup helpers.
//!
//! The database file inside the archive is a normal SQLite snapshot; the zip
//! itself is AES-256 encrypted. Keeping the DB entry plaintext inside an
//! encrypted archive keeps the export format simple and lets standard zip
//! tools open it when the user has the password.

use std::fs::File;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{AesMode, ZipArchive, ZipWriter};

/// Entry name used for the SQLite snapshot inside encrypted backups.
pub const BACKUP_DB_ENTRY: &str = "tanwords.db";

pub fn is_encrypted_backup(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
}

pub fn create_encrypted_backup(plain_db: &Path, dest: &Path, password: &str) -> Result<(), String> {
    let output = File::create(dest).map_err(|e| format!("Could not create backup zip: {e}"))?;
    let mut writer = ZipWriter::new(output);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .with_aes_encryption(AesMode::Aes256, password);
    writer
        .start_file(BACKUP_DB_ENTRY, options)
        .map_err(|e| format!("Could not start backup entry: {e}"))?;

    let mut db = File::open(plain_db).map_err(|e| format!("Could not open snapshot: {e}"))?;
    std::io::copy(&mut db, &mut writer)
        .map_err(|e| format!("Could not write backup zip: {e}"))?;
    writer
        .finish()
        .map_err(|e| format!("Could not finalize backup zip: {e}"))?;
    Ok(())
}

/// Extracts `tanwords.db` from a password-protected zip to a temp file.
/// Returns `None` for a normal SQLite file, so callers can treat the original
/// path as the source unchanged.
pub fn extract_encrypted_backup_to_temp(
    source: &Path,
    password: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    if !is_encrypted_backup(source) {
        return Ok(None);
    }

    let file = File::open(source).map_err(|e| format!("Could not open backup zip: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid backup zip: {e}"))?;
    let mut entry = match password {
        Some(password) => archive
            .by_name_decrypt(BACKUP_DB_ENTRY, password.as_bytes())
            .map_err(|e| map_zip_password_error(e))?,
        None => archive
            .by_name(BACKUP_DB_ENTRY)
            .map_err(|e| match e {
                zip::result::ZipError::UnsupportedArchive(
                    zip::result::ZipError::PASSWORD_REQUIRED,
                ) => "This backup is encrypted. Enter the password to import it.".into(),
                other => format!("Backup does not contain {BACKUP_DB_ENTRY}: {other}"),
            })?,
    };

    let temp = std::env::temp_dir().join(format!("tanwords-import-{}.db", uuid::Uuid::new_v4()));
    let mut output = File::create(&temp).map_err(|e| format!("Could not write temp database: {e}"))?;
    std::io::copy(&mut entry, &mut output)
        .map_err(|e| format!("Could not decrypt backup database: {e}"))?;
    Ok(Some(temp))
}

fn map_zip_password_error(error: zip::result::ZipError) -> String {
    match error {
        zip::result::ZipError::InvalidPassword => "Invalid backup password".into(),
        other => format!("Could not open backup database: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_zip_round_trips_with_password() {
        let dir = std::env::temp_dir().join(format!("tanwords-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let plain = dir.join("plain.db");
        let zip = dir.join("backup.zip");
        std::fs::write(&plain, b"sqlite-snapshot-bytes").unwrap();

        create_encrypted_backup(&plain, &zip, "secret").unwrap();
        let extracted = extract_encrypted_backup_to_temp(&zip, Some("secret"))
            .unwrap()
            .unwrap();
        assert_eq!(std::fs::read(&extracted).unwrap(), b"sqlite-snapshot-bytes");

        let wrong = extract_encrypted_backup_to_temp(&zip, Some("wrong"));
        assert!(wrong.is_err());
        let missing = extract_encrypted_backup_to_temp(&zip, None);
        assert!(missing.is_err());

        let _ = std::fs::remove_dir_all(dir);
    }
}
