//! The devices registry — who else opens this database.
//!
//! `device_id` (see `appconfig::device_id`) is an opaque UUID that
//! deliberately does not travel with the data, which is exactly what makes
//! per-device rows safe to share a database. Its cost is that a badge like
//! "added by 8f3a…" means nothing to a human. This table gives each
//! installation a label and a platform, written once per open by
//! `build_state_for`, so Settings can say "added on Windows · OFFICE-PC"
//! and list every machine the database is shared with.
//!
//! Labels are user data living in the shared database, so any device may
//! rename any row — it is how you name your other machines from the one
//! you are sitting at. Registration never overwrites a label or platform:
//! it only creates the row on first sight and refreshes `last_seen_at`.

use serde::{Deserialize, Serialize};

use crate::db::{self, params, Conn};
use crate::shim::State;
use crate::AppState;

/// A device as the settings UI sees it. `is_current` marks the machine this
/// request came from, so the list can say "you are here" without the
/// renderer having to know its own id.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub label: String,
    pub platform: String,
    pub is_current: bool,
    pub created_at: String,
    pub last_seen_at: String,
}

/// What kind of machine this process runs on, as the registry stores it.
/// The web server build labels itself "web" — the browser is the client;
/// the server process is the thing that actually opened the database.
pub fn current_platform() -> &'static str {
    #[cfg(feature = "web")]
    {
        "web"
    }
    #[cfg(not(feature = "web"))]
    {
        std::env::consts::OS
    }
}

/// Best-effort machine name for a first registration. The user renames from
/// Settings when this comes up empty (containers, exotic shells) or wrong.
pub fn default_label() -> String {
    ["COMPUTERNAME", "HOSTNAME"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_default()
}

/// Registers *this* installation — resolving its id, platform, and default
/// label — into the registry of the given database. Called on every open
/// path: `build_state_for` (startup, and each web user's runtime spawn) and
/// each runtime database switch (a profile change points the app at a
/// different database, whose registry has never seen this machine). Any of
/// these may be the FIRST contact between the two, so all of them register.
pub async fn register_current(conn: &Conn) -> Result<(), String> {
    register(
        conn,
        &crate::appconfig::device_id(),
        current_platform(),
        &default_label(),
    )
    .await
}

/// Creates this installation's row on first sight; refreshes `last_seen_at`
/// on every open. An existing label or platform is never overwritten — a
/// rename from any device must survive every subsequent boot of the machine
/// it names.
pub async fn register(conn: &Conn, device: &str, platform: &str, label: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO devices (device_id, label, platform, last_seen_at)
         VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
         ON CONFLICT(device_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
        params![device, label, platform],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Every device known to this database, oldest first.
pub async fn list(conn: &Conn, current: &str) -> Result<Vec<DeviceInfo>, String> {
    db::fetch_all(
        conn,
        "SELECT device_id, label, platform, created_at, last_seen_at
           FROM devices ORDER BY created_at, device_id",
        (),
        |row| {
            let device_id: String = row.get(0)?;
            Ok(DeviceInfo {
                is_current: device_id == current,
                device_id,
                label: row.get(1)?,
                platform: row.get(2)?,
                created_at: row.get(3)?,
                last_seen_at: row.get(4)?,
            })
        },
    )
    .await
}

/// Sets the display name of one device. A label is metadata in the shared
/// database — naming your other machines from here is the point.
pub async fn rename(conn: &Conn, device: &str, label: &str) -> Result<(), String> {
    let label = label.trim();
    if label.chars().count() > 80 {
        return Err("Device label is too long (80 characters max)".into());
    }
    conn.execute(
        "UPDATE devices SET label = ?2 WHERE device_id = ?1",
        params![device, label],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Commands ───────────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn device_list(state: State<'_, AppState>) -> Result<Vec<DeviceInfo>, String> {
    let conn = db::conn(&state)?;
    list(&conn, &crate::appconfig::device_id()).await
}

#[crate::shim::command]
pub async fn device_rename(
    device_id: String,
    label: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = db::conn(&state)?;
    rename(&conn, &device_id, &label).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn memory_conn() -> Conn {
        let path = std::env::temp_dir()
            .join(format!("tanwords-dev-{}.db", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        db::connection::open(&db::connection::DbProfile::Local { path }, None)
            .await
            .unwrap()
            .conn()
    }

    #[tokio::test]
    async fn register_creates_once_and_only_refreshes_last_seen() {
        let conn = memory_conn().await;
        register(&conn, "dev-1", "windows", "OFFICE-PC").await.unwrap();
        register(&conn, "dev-1", "windows", "OFFICE-PC").await.unwrap();
        // A second open must not clobber a rename that happened in between.
        rename(&conn, "dev-1", "My desktop").await.unwrap();
        register(&conn, "dev-1", "windows", "OFFICE-PC").await.unwrap();

        let devices = list(&conn, "dev-1").await.unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].label, "My desktop");
        assert_eq!(devices[0].platform, "windows");
        assert!(devices[0].is_current);

        let other = list(&conn, "someone-else").await.unwrap();
        assert!(!other[0].is_current);
    }

    #[tokio::test]
    async fn list_orders_by_creation_and_marks_the_current_device() {
        let conn = memory_conn().await;
        register(&conn, "b", "macos", "").await.unwrap();
        register(&conn, "a", "linux", "").await.unwrap();
        let devices = list(&conn, "a").await.unwrap();
        // Both rows are there; same-second registrations may tie on
        // created_at, so order between them is unspecified.
        assert_eq!(
            devices.iter().map(|d| d.device_id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"],
        );
        let a = devices.iter().find(|d| d.device_id == "a").unwrap();
        assert!(a.is_current);
        // Empty label is allowed — the UI falls back to the platform name.
        assert_eq!(a.label, "");
    }

    #[tokio::test]
    async fn rename_trims_and_rejects_absurd_lengths() {
        let conn = memory_conn().await;
        register(&conn, "dev-1", "windows", "").await.unwrap();
        rename(&conn, "dev-1", "  Padded  ").await.unwrap();
        assert_eq!(list(&conn, "dev-1").await.unwrap()[0].label, "Padded");
        assert!(rename(&conn, "dev-1", &"x".repeat(81)).await.is_err());
        assert!(rename(&conn, "dev-1", &"x".repeat(80)).await.is_ok());
        // Renaming an unknown device is a silent no-op, not an error — the
        // row may have vanished through a database switch mid-edit.
        assert!(rename(&conn, "ghost", "whatever").await.is_ok());
    }

    #[test]
    fn platform_labels_the_build_kind() {
        // The web build must never report its host OS — a Linux server would
        // otherwise show up in a user's device list as a "linux" machine.
        #[cfg(feature = "web")]
        assert_eq!(current_platform(), "web");
        #[cfg(not(feature = "web"))]
        assert!(!current_platform().is_empty());
    }
}
