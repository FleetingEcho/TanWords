//! Calendar colour-category CRUD — the `calendar_calendars` table.
//!
//! Split out of `calendar/mod.rs` so neither file exceeds 600 lines. The
//! event-side commands, the shared wire types (`CalendarCategory` /
//! `CalendarEvent`) and the shared helpers (`sanitize_id`, `uuid_id`,
//! `valid_schedule_x_time`) stay in the parent module; this file holds only
//! the four `calendar_calendars` CRUD commands, re-exported by the parent
//! (`pub use calendars::*;`) so the public `calendar::…` / `db::…` paths and
//! the generated dispatch call `db::calendar::db_list_calendar_calendars`
//! are unchanged.

use crate::shim::State;
use crate::db::params;
use crate::{db, AppState};

// `sanitize_id` / `uuid_id` are private helpers in the parent module and
// `CalendarCategory` is the shared wire type defined there. A child module
// can name its parent's private items, so these `use super::` imports bring
// them in without widening their visibility — the command bodies below are
// verbatim copies of the originals.
use super::{sanitize_id, uuid_id, CalendarCategory};

// ── calendars (colour categories): read ─────────────────────────────────────

#[crate::shim::command]
pub async fn db_list_calendar_calendars(
    conn: State<'_, AppState>,
) -> Result<Vec<CalendarCategory>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT id, name, color_name, visible, sort_order
         FROM calendar_calendars
         ORDER BY sort_order ASC, id ASC",
        (),
        |r| {
            Ok(CalendarCategory {
                id: r.get(0)?,
                name: r.get(1)?,
                color_name: r.get(2)?,
                visible: r.get::<i64>(3)? != 0,
                sort_order: r.get(4)?,
            })
        },
    )
    .await
}

// ── calendars (colour categories): write ────────────────────────────────────

#[crate::shim::command]
pub async fn db_create_calendar_calendar(
    name: String,
    conn: State<'_, AppState>,
    color_name: Option<String>,
    visible: Option<bool>,
    sort_order: Option<i64>,
    id: Option<String>,
) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("name is required".into());
    }
    let id = sanitize_id(&id.unwrap_or_else(uuid_id));
    if id.is_empty() {
        return Err("id is required".into());
    }
    let color_name = color_name.unwrap_or_else(|| "blue".to_string());
    let visible = visible.unwrap_or(true);
    let sort_order = sort_order.unwrap_or(0);

    let db = db::conn(&conn)?;
    let out_id = id.clone();
    db::await_write(&conn, async {
        db.execute(
            "INSERT INTO calendar_calendars (id, name, color_name, visible, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, color_name, visible as i64, sort_order],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await?;
    Ok(out_id)
}

#[crate::shim::command]
pub async fn db_update_calendar_calendar(
    id: String,
    conn: State<'_, AppState>,
    name: Option<String>,
    color_name: Option<String>,
    visible: Option<bool>,
    sort_order: Option<i64>,
) -> Result<(), String> {
    let id = sanitize_id(&id);
    if id.is_empty() {
        return Err("id is required".into());
    }
    let db = db::conn(&conn)?;
    db::await_write(&conn, async {
        db.execute(
            "UPDATE calendar_calendars SET
                name       = COALESCE(NULLIF(?2, ''), name),
                color_name = COALESCE(NULLIF(?3, ''), color_name),
                visible    = COALESCE(?4, visible),
                sort_order = COALESCE(?5, sort_order)
             WHERE id = ?1",
            params![
                id,
                name.unwrap_or_default(),
                color_name.unwrap_or_default(),
                visible.map(|b| b as i64),
                sort_order,
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
}

#[crate::shim::command]
pub async fn db_delete_calendar_calendar(
    calendar_id: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let id = sanitize_id(&calendar_id);
    if id.is_empty() {
        return Err("id is required".into());
    }
    // The FK is ON DELETE SET NULL, so deleting a category leaves its events
    // orphaned under a null calendar_id rather than dropping them — the user's
    // data survives a miscategorisation mistake. The frontend re-assigns those
    // orphans to "default" on load (see useDB.calendar.ts).
    let db = db::conn(&conn)?;
    db::await_write(&conn, async {
        db.execute("DELETE FROM calendar_calendars WHERE id = ?1", params![id])
            .await
            .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
}
