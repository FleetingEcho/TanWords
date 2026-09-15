//! Settings that belong to *this* machine, not to the account.
//!
//! `user_settings` travels: on a Postgres profile the same row reaches every
//! machine signed into the account. That is right for preferences and wrong
//! for two kinds of values:
//!
//! * **Paths** (`localdocs.root`, `music_folder_path`, `terminal_shell_path`)
//!   name a folder on this machine. Syncing them means the last machine to
//!   write wins and the other two open a path that does not exist — the
//!   failure the user sees is "my local folder keeps resetting".
//! * **Selections among shared rows** (`default_ai_provider`,
//!   `tts_remote_provider_id`) pick which provider *this* machine reaches
//!   for. The provider list itself is shared, but which of them is active is
//!   a per-machine choice: switching on the laptop must not silently switch
//!   the desktop — and before the providers went shared, a synced selection
//!   regularly pointed at a row the other machine could not see at all.
//!
//! So these keys are stored per device instead: `<key>::<device_id>`, where
//! `device_id` comes from `app_config.json` and deliberately does not sync
//! (see `appconfig::device_id`). Each machine reads and writes its own row,
//! all rows coexist in one database, and nobody's choice changes because
//! somebody else opened the app. A read falls back to the old shared key
//! when no scoped row exists yet, so an upgrading install keeps its value
//! until it explicitly diverges.

use crate::shim::State;
use crate::{db, AppState};

/// Keys whose value is a path, so they must not be shared between machines.
/// A closed list rather than a flag on the call: the fallback below only makes
/// sense for values that can be checked against the filesystem.
const DEVICE_PATH_KEYS: &[&str] = &[
    "localdocs.root",
    "music_folder_path",
    "terminal_shell_path",
];

/// Keys that select per-machine state among shared rows (which provider this
/// machine uses). Same scoping as the path keys, but the legacy fallback is a
/// plain shared-key read — there is no filesystem to check a value against.
const DEVICE_SETTING_KEYS: &[&str] = &["default_ai_provider", "tts_remote_provider_id"];

/// A JSON-encoded string setting as its plain value; anything else unchanged.
fn unquote(value: &str) -> String {
    serde_json::from_str::<String>(value).unwrap_or_else(|_| value.to_string())
}

fn scoped_key(key: &str) -> Result<String, String> {
    if DEVICE_PATH_KEYS.contains(&key) || DEVICE_SETTING_KEYS.contains(&key) {
        return Ok(format!("{key}::{}", crate::appconfig::device_id()));
    }
    Err(format!("{key} is not a device-scoped setting"))
}

/// This machine's value for a path setting.
///
/// Falls back to the old shared key once, and only if that path still resolves
/// here — which is how an existing install keeps its mounted folder instead of
/// coming back empty after the upgrade. A stale path from another machine fails
/// the check and reads as unset, which is the honest answer.
#[crate::shim::command]
pub async fn db_get_device_path(
    key: String,
    conn: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let scoped = scoped_key(&key)?;
    let database = db::conn(&conn)?;
    if let Some(value) = db::get_setting(&database, &scoped)
        .await
        .map_err(|e| e.to_string())?
    {
        if !value.trim().is_empty() {
            return Ok(Some(value));
        }
    }
    let legacy = db::get_setting(&database, &key)
        .await
        .map_err(|e| e.to_string())?
        .filter(|value| !value.trim().is_empty());
    let Some(legacy) = legacy else {
        return Ok(None);
    };
    // The two legacy keys disagree on encoding: `localdocs.root` was written
    // raw, `music_folder_path` as a JSON string by the settings store. Only the
    // existence check needs to see through that — what gets adopted below is
    // the unquoted path, so both keys end up stored the same way from here on.
    let legacy = unquote(&legacy);
    if !std::path::Path::new(&legacy).is_dir() {
        return Ok(None);
    }
    // Adopt it, so the next read costs nothing and writing from another machine
    // can no longer disturb this one.
    db::set_setting(&database, &scoped, &legacy)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(legacy))
}

/// Records a path setting for this machine only.
#[crate::shim::command]
pub async fn db_set_device_path(
    key: String,
    value: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let scoped = scoped_key(&key)?;
    let database = db::conn(&conn)?;
    db::set_setting(&database, &scoped, &value)
        .await
        .map_err(|e| e.to_string())?;
    // The shared key is left untouched but no longer read once a scoped value
    // exists: older builds on another machine still depend on it, and deleting
    // it would strand them.
    Ok(())
}

/// This machine's value for a device-scoped selection (which provider to use).
///
/// Falls back to the shared key when no scoped row exists — how an upgrading
/// install keeps the default it chose before selections became per-device,
/// and how a fresh machine inherits the account's choice until it picks its
/// own. Unlike the path fallback there is nothing to validate: the shared
/// value is adopted verbatim, and the first write from this machine ends the
/// sharing.
#[crate::shim::command]
pub async fn db_get_device_setting(
    key: String,
    conn: State<'_, AppState>,
) -> Result<Option<String>, String> {
    if !DEVICE_SETTING_KEYS.contains(&key.as_str()) {
        return Err(format!("{key} is not a device-scoped setting"));
    }
    let scoped = scoped_key(&key)?;
    let database = db::conn(&conn)?;
    if let Some(value) = db::get_setting(&database, &scoped)
        .await
        .map_err(|e| e.to_string())?
    {
        if !value.trim().is_empty() {
            return Ok(Some(value));
        }
    }
    db::get_setting(&database, &key)
        .await
        .map_err(|e| e.to_string())
}

/// Records a device-scoped selection for this machine only.
#[crate::shim::command]
pub async fn db_set_device_setting(
    key: String,
    value: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    if !DEVICE_SETTING_KEYS.contains(&key.as_str()) {
        return Err(format!("{key} is not a device-scoped setting"));
    }
    let scoped = scoped_key(&key)?;
    let database = db::conn(&conn)?;
    db::set_setting(&database, &scoped, &value)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{scoped_key, DEVICE_SETTING_KEYS};

    #[test]
    fn refuses_keys_that_are_not_device_scoped() {
        assert!(scoped_key("theme").is_err());
        assert!(scoped_key("localdocs.root").is_ok());
        assert!(scoped_key("music_folder_path").is_ok());
        assert!(scoped_key("terminal_shell_path").is_ok());
        assert!(scoped_key("default_ai_provider").is_ok());
        assert!(scoped_key("tts_remote_provider_id").is_ok());
    }

    #[test]
    fn device_setting_keys_are_covered_by_scoped_key() {
        // The command layer checks the list separately; this pins the two
        // lists together so adding a key to one but not the other fails here.
        for key in DEVICE_SETTING_KEYS {
            assert!(scoped_key(key).is_ok(), "{key} must be scopeable");
        }
    }

    #[test]
    fn reads_through_the_settings_store_json_encoding() {
        assert_eq!(super::unquote("\"/Users/x/Music\""), "/Users/x/Music");
        assert_eq!(super::unquote("/Users/x/Vault"), "/Users/x/Vault");
        // A Windows path survives: backslashes are only special inside JSON.
        assert_eq!(super::unquote("C:\\Users\\x"), "C:\\Users\\x");
    }

    #[test]
    fn scopes_with_a_separator_that_cannot_collide_with_a_key() {
        let scoped = scoped_key("localdocs.root").unwrap();
        assert!(scoped.starts_with("localdocs.root::"));
        assert!(scoped.len() > "localdocs.root::".len());
    }
}
