//! Calendar feature: user-created events plus their colour-category "calendars".
//!
//! Schedule-X calls the colour categories "calendars" (a `Record<string,
//! CalendarType>`), so this module mirrors that terminology: `calendar_calendars`
//! holds the categories and `calendar_events` holds the events that belong to
//! them. Both are private to this user's database — on the web build each
//! session runs against the caller's own per-user runtime, so there is no
//! cross-user bleed.

use crate::shim::State;
use libsql::params;
use serde::Serialize;

use crate::{db, AppState};

// ── wire types ──────────────────────────────────────────────────────────────

/// One colour category. `visible` is stored as 0/1 but sent to the renderer as a
/// bool so the frontend can toggle it directly; schedule-x reads the same field
/// to decide whether a category's events render.
#[derive(Serialize)]
pub struct CalendarCategory {
    pub id: String,
    pub name: String,
    pub color_name: String,
    pub visible: bool,
    pub sort_order: i64,
}

/// A single event. `start`/`end` are Schedule-X wire strings
/// (`YYYY-MM-DD` all-day, `YYYY-MM-DD HH:mm` timed) stored verbatim so the
/// renderer round-trips them without a conversion layer. `all_day` is the
/// boundary between the two formats, not a format sniff.
#[derive(Serialize)]
pub struct CalendarEvent {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub description: String,
    pub location: String,
    pub created_at: String,
    pub updated_at: String,
    /// `None` means "inherit the parent calendar's colour"; `Some(token)` is
    /// a per-event override (see calendarColors.ts's CALENDAR_COLOR_TOKENS).
    pub color_name: Option<String>,
}

/// Validate a Schedule-X datetime string. Accepts `YYYY-MM-DD` (all-day) or
/// `YYYY-MM-DD HH:mm` (timed); rejects anything else so a malformed client
/// value can never land a row the renderer then mis-parses. Empty is allowed
/// and means "unset", which the caller turns into an error at the field level.
fn valid_schedule_x_time(raw: &str) -> bool {
    let raw = raw.trim();
    if raw.is_empty() {
        return false;
    }
    let bytes = raw.as_bytes();
    // Pure date shape (the prefix both formats share): `YYYY-MM-DD`.
    let date_shape_ok = |b: &[u8]| -> bool {
        b.len() >= 10
            && b[4] == b'-'
            && b[7] == b'-'
            && b[0..4].iter().all(|c| c.is_ascii_digit())
            && b[5..7].iter().all(|c| c.is_ascii_digit())
            && b[8..10].iter().all(|c| c.is_ascii_digit())
    };
    if bytes.len() == 10 {
        return date_shape_ok(bytes);
    }
    // `YYYY-MM-DD HH:mm` — exactly 16 chars with the time suffix.
    bytes.len() == 16
        && date_shape_ok(bytes)
        && bytes[10] == b' '
        && bytes[13] == b':'
        && bytes[11..13].iter().all(|c| c.is_ascii_digit())
        && bytes[14..16].iter().all(|c| c.is_ascii_digit())
}

/// Sanitize a calendar id: the frontend mints uuids, but a stored or hand-edited
/// value could be anything. Keep it to a conservative charset so it can never
/// form a surprising SQL identifier or break the FK chain.
fn sanitize_id(id: &str) -> String {
    id.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

// ── events: read ────────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn db_list_calendar_events(
    conn: State<'_, AppState>,
) -> Result<Vec<CalendarEvent>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT id, calendar_id, title, start, end, all_day, description, location, created_at, updated_at, color_name
         FROM calendar_events
         ORDER BY start ASC, id ASC",
        (),
        |r| {
            Ok(CalendarEvent {
                id: r.get(0)?,
                calendar_id: r.get(1)?,
                title: r.get(2)?,
                start: r.get(3)?,
                end: r.get(4)?,
                all_day: r.get::<i64>(5)? != 0,
                description: r.get(6)?,
                location: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
                color_name: r.get::<Option<String>>(10)?,
            })
        },
    )
    .await
}

// ── events: write ────────────────────────────────────────────────────────────

#[crate::shim::command]
pub async fn db_create_calendar_event(
    title: String,
    start: String,
    end: String,
    conn: State<'_, AppState>,
    all_day: Option<bool>,
    calendar_id: Option<String>,
    description: Option<String>,
    location: Option<String>,
    color_name: Option<String>,
    id: Option<String>,
) -> Result<String, String> {
    let title = title.trim().to_string();
    let start = start.trim().to_string();
    let end = end.trim().to_string();
    if title.is_empty() {
        return Err("title is required".into());
    }
    if !valid_schedule_x_time(&start) || !valid_schedule_x_time(&end) {
        return Err("start and end must be YYYY-MM-DD or YYYY-MM-DD HH:mm".into());
    }
    let all_day = all_day.unwrap_or(false);
    let calendar_id = sanitize_id(&calendar_id.unwrap_or_else(|| "default".to_string()));
    let id = sanitize_id(&id.unwrap_or_else(uuid_id));
    // An empty string (the picker's "use calendar colour" option) stores as
    // NULL, same as never having set one.
    let color_name = color_name.filter(|c| !c.trim().is_empty());

    let db = db::conn(&conn)?;
    let out_id = id.clone();
    db::await_write(&conn, async {
        db.execute(
            "INSERT INTO calendar_events (id, calendar_id, title, start, end, all_day, description, location, color_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                calendar_id,
                title,
                start,
                end,
                all_day,
                description.unwrap_or_default(),
                location.unwrap_or_default(),
                color_name,
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await?;
    Ok(out_id)
}

#[crate::shim::command]
pub async fn db_update_calendar_event(
    id: String,
    conn: State<'_, AppState>,
    calendar_id: Option<String>,
    title: Option<String>,
    start: Option<String>,
    end: Option<String>,
    all_day: Option<bool>,
    description: Option<String>,
    location: Option<String>,
    color_name: Option<String>,
) -> Result<(), String> {
    let id = sanitize_id(&id);
    if id.is_empty() {
        return Err("id is required".into());
    }
    let start_raw = start.unwrap_or_default();
    let end_raw = end.unwrap_or_default();
    if !start_raw.is_empty() && !valid_schedule_x_time(&start_raw) {
        return Err("start must be YYYY-MM-DD or YYYY-MM-DD HH:mm".into());
    }
    if !end_raw.is_empty() && !valid_schedule_x_time(&end_raw) {
        return Err("end must be YYYY-MM-DD or YYYY-MM-DD HH:mm".into());
    }

    let db = db::conn(&conn)?;
    db::await_write(&conn, async {
        // COALESCE keeps omitted fields at their current value: drag-to-move
        // sends only start/end, the modal sends only title/description, and a
        // calendar switch sends only calendar_id. One command serves all three
        // without the frontend having to read-then-write the whole row.
        // NULLIF turns an empty string back into NULL so an empty optional
        // field doesn't overwrite a real value with "".
        db.execute(
            "UPDATE calendar_events SET
                calendar_id = COALESCE(NULLIF(?2, ''), calendar_id),
                title       = COALESCE(NULLIF(?3, ''), title),
                start       = COALESCE(NULLIF(?4, ''), start),
                end         = COALESCE(NULLIF(?5, ''), end),
                all_day     = COALESCE(?6, all_day),
                description = COALESCE(?7, description),
                location    = COALESCE(?8, location),
                updated_at  = datetime('now')
             WHERE id = ?1",
            params![
                id.clone(),
                calendar_id.unwrap_or_default(),
                title.unwrap_or_default(),
                start_raw,
                end_raw,
                all_day,
                description.unwrap_or_default(),
                location.unwrap_or_default(),
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
        // color_name gets its own statement rather than folding into the
        // COALESCE above: unlike the other fields, "" here is a meaningful
        // value (clear the override, revert to the calendar's colour), not a
        // no-op — COALESCE(NULLIF(?, ''), color_name) would silently keep
        // the old override instead of clearing it. `None` (the field wasn't
        // sent at all — drag/resize never touches colour) skips this
        // entirely, leaving color_name untouched.
        if let Some(raw) = color_name {
            let value = raw.trim().to_string();
            let value = if value.is_empty() { None } else { Some(value) };
            db.execute(
                "UPDATE calendar_events SET color_name = ?2, updated_at = datetime('now') WHERE id = ?1",
                params![id, value],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        Ok::<(), String>(())
    })
    .await?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_delete_calendar_event(
    event_id: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let id = sanitize_id(&event_id);
    let db = db::conn(&conn)?;
    db::await_write(&conn, async {
        db.execute("DELETE FROM calendar_events WHERE id = ?1", params![id])
            .await
            .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
}

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
            params![id, name, color_name, visible, sort_order],
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
                visible,
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

// ── helpers ─────────────────────────────────────────────────────────────────

/// A v4 uuid, generated in Rust so the id is unique even on a local (offline)
/// profile where the database isn't doing the minting. Matches the string key
/// shape schedule-x uses for its `Record<string, CalendarType>`. The crate
/// already depends on `uuid` (v4) and `rand`, so this is a one-liner.
fn uuid_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_schedule_x_time_formats() {
        assert!(valid_schedule_x_time("2024-01-31"));
        assert!(valid_schedule_x_time("2024-01-31 09:30"));
        assert!(!valid_schedule_x_time(""));
        assert!(!valid_schedule_x_time("2024-1-1"));
        assert!(!valid_schedule_x_time("2024-01-31 9:30"));
        assert!(!valid_schedule_x_time("not a date"));
        assert!(!valid_schedule_x_time("2024/01/31"));
    }

    #[test]
    fn sanitizes_ids_to_a_safe_charset() {
        assert_eq!(sanitize_id("abc-123_def"), "abc-123_def");
        assert_eq!(sanitize_id("  spaced  "), "spaced");
        assert_eq!(sanitize_id("a'b;c--"), "abc--");
        assert_eq!(sanitize_id(""), "");
    }

    #[test]
    fn uuid_id_is_well_formed_and_unique_enough() {
        let a = uuid_id();
        let b = uuid_id();
        assert!(a.len() == 36, "uuid length: {a}");
        assert_eq!(a.chars().nth(8), Some('-'));
        assert_eq!(a.chars().nth(13), Some('-'));
        assert_eq!(a.chars().nth(18), Some('-'));
        assert_eq!(a.chars().nth(23), Some('-'));
        assert_eq!(a.chars().nth(14), Some('4'), "version 4 nibble");
        assert!(a != b, "two ids must differ");
    }

    /// Full create → list → update → delete cycle through the generated
    /// dispatcher, the same path the renderer hits. Catches the two things a
    /// unit test of the command fn can't: the camelCase→snake_case arg
    /// conversion in `rpc::Args`, and the partial-update COALESCE behaviour.
    #[tokio::test]
    async fn calendar_crud_round_trips_through_the_dispatcher() {
        let database = crate::db::connection::open_memory().await.unwrap();
        let (registry, app) = crate::build_state_for(database, None).await;
        let ctx = crate::rpc::Ctx::new(registry, app);

        // The two default calendars are seeded by init_db.
        let calendars = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_calendars",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list calendars");
        let cal_arr = calendars.as_array().expect("calendars is an array");
        assert!(cal_arr.len() >= 2, "default calendars seeded");
        assert_eq!(cal_arr[0]["id"], "default");
        assert_eq!(cal_arr[0]["name"], "Personal");

        // Create an event — camelCase keys, matching what the frontend sends.
        let id = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_create_calendar_event",
            crate::rpc::Args::new(serde_json::json!({
                "title": "Standup",
                "start": "2024-06-01 09:00",
                "end": "2024-06-01 09:30",
                "allDay": false,
                "calendarId": "default",
                "description": "Daily sync",
                "location": "Zoom"
            })),
        )
        .await
        .expect("create event")
        .as_str()
        .expect("create returns id string")
        .to_string();
        assert!(!id.is_empty());

        // List reflects the new event with the bool `allDay` the renderer reads.
        let events = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_events",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list events");
        let arr = events.as_array().expect("events is an array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"], id);
        assert_eq!(arr[0]["title"], "Standup");
        assert_eq!(arr[0]["start"], "2024-06-01 09:00");
        assert_eq!(arr[0]["end"], "2024-06-01 09:30");
        assert_eq!(arr[0]["all_day"], false);
        assert_eq!(arr[0]["calendar_id"], "default");

        // Partial update: drag-to-move sends only start/end (COALESCE keeps the
        // rest). The all-day toggle sends only allDay.
        crate::rpc::dispatch::dispatch(
            &ctx,
            "db_update_calendar_event",
            crate::rpc::Args::new(serde_json::json!({
                "id": id,
                "start": "2024-06-01 10:00",
                "end": "2024-06-01 10:30"
            })),
        )
        .await
        .expect("move event");
        crate::rpc::dispatch::dispatch(
            &ctx,
            "db_update_calendar_event",
            crate::rpc::Args::new(serde_json::json!({ "id": id, "allDay": true })),
        )
        .await
        .expect("toggle all-day");

        let moved = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_events",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list after move");
        let row = &moved.as_array().unwrap()[0];
        assert_eq!(row["start"], "2024-06-01 10:00", "start updated by move");
        assert_eq!(row["end"], "2024-06-01 10:30", "end updated by move");
        assert_eq!(row["all_day"], true, "all_day toggled separately");
        assert_eq!(row["title"], "Standup", "title untouched by partial update");

        // Reject a malformed time so a bad client value never lands.
        let bad = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_create_calendar_event",
            crate::rpc::Args::new(serde_json::json!({
                "title": "Bad",
                "start": "2024/06/01",
                "end": "2024-06-02"
            })),
        )
        .await;
        assert!(bad.is_err(), "malformed start must be rejected");

        // Delete and confirm the list is empty again.
        crate::rpc::dispatch::dispatch(
            &ctx,
            "db_delete_calendar_event",
            crate::rpc::Args::new(serde_json::json!({ "eventId": id })),
        )
        .await
        .expect("delete event");
        let after = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_events",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list after delete");
        assert!(after.as_array().unwrap().is_empty(), "event deleted");
    }

    /// A per-event `color_name` override: unset by default (inherits the
    /// calendar's colour), settable on create, overridable on update, and
    /// clearable back to "inherit" via an explicit empty string — the one
    /// field update.rs gives real meaning to `""` for (see the comment on
    /// its own UPDATE statement in `db_update_calendar_event`).
    #[tokio::test]
    async fn calendar_event_color_override_round_trips_and_clears() {
        let database = crate::db::connection::open_memory().await.unwrap();
        let (registry, app) = crate::build_state_for(database, None).await;
        let ctx = crate::rpc::Ctx::new(registry, app);

        // Create without a color: inherits (null).
        let id = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_create_calendar_event",
            crate::rpc::Args::new(serde_json::json!({
                "title": "Plain",
                "start": "2024-06-01 09:00",
                "end": "2024-06-01 09:30"
            })),
        )
        .await
        .expect("create event")
        .as_str()
        .expect("create returns id string")
        .to_string();

        let listed = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_events",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list events");
        assert!(listed.as_array().unwrap()[0]["color_name"].is_null(), "no override by default");

        // Create WITH a color override.
        let id2 = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_create_calendar_event",
            crate::rpc::Args::new(serde_json::json!({
                "title": "Colored",
                "start": "2024-06-02 09:00",
                "end": "2024-06-02 09:30",
                "colorName": "red"
            })),
        )
        .await
        .expect("create colored event")
        .as_str()
        .expect("create returns id string")
        .to_string();
        let listed = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_events",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list events");
        let row2 = listed.as_array().unwrap().iter().find(|r| r["id"] == id2).unwrap();
        assert_eq!(row2["color_name"], "red");

        // Update: set an override on the plain event.
        crate::rpc::dispatch::dispatch(
            &ctx,
            "db_update_calendar_event",
            crate::rpc::Args::new(serde_json::json!({ "id": id, "colorName": "purple" })),
        )
        .await
        .expect("set override");
        let listed = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_events",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list events");
        let row = listed.as_array().unwrap().iter().find(|r| r["id"] == id).unwrap();
        assert_eq!(row["color_name"], "purple");

        // Update WITHOUT colorName (e.g. a drag-move): the override survives.
        crate::rpc::dispatch::dispatch(
            &ctx,
            "db_update_calendar_event",
            crate::rpc::Args::new(serde_json::json!({ "id": id, "start": "2024-06-01 10:00", "end": "2024-06-01 10:30" })),
        )
        .await
        .expect("move event");
        let listed = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_events",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list events");
        let row = listed.as_array().unwrap().iter().find(|r| r["id"] == id).unwrap();
        assert_eq!(row["color_name"], "purple", "move must not touch color");

        // Update with an explicit empty string: clears the override back to inherit.
        crate::rpc::dispatch::dispatch(
            &ctx,
            "db_update_calendar_event",
            crate::rpc::Args::new(serde_json::json!({ "id": id, "colorName": "" })),
        )
        .await
        .expect("clear override");
        let listed = crate::rpc::dispatch::dispatch(
            &ctx,
            "db_list_calendar_events",
            crate::rpc::Args::new(serde_json::Value::Null),
        )
        .await
        .expect("list events");
        let row = listed.as_array().unwrap().iter().find(|r| r["id"] == id).unwrap();
        assert!(row["color_name"].is_null(), "empty string clears back to inherit");
    }
}
