//! Sticky notes — small floating colored notes modeled on macOS "Stickies!".
//!
//! A sticky's *content* is a `documents` row with `kind='sticky'`, so full-text
//! search, tags, revisions and privacy protection come for free. This module
//! owns the two things a document row cannot carry:
//!
//! * `stickies` — the shared sticky identity (color, opacity, pin, font).
//!   It travels with the database, so a Postgres user sees the same sticky on
//!   every machine.
//! * `sticky_windows` — machine-bound window state, one row per (note, device).
//!   Geometry and open-state never cross devices: a layout saved on Windows is
//!   meaningless on macOS. Every write is scoped to the calling device.
//!
//! The sweep rule: every query that serves the normal Documents surfaces must
//! filter `kind='document'` (or exclude stickies) and `deleted_at IS NULL`.
//! The call sites are documents/crud.rs, dashboard.rs, documents/folders.rs,
//! documents/links.rs, documents/assets_crud.rs (prune), mcp/tools/documents.rs
//! and the import readers (which also predate the `kind` column and therefore
//! probe for it before filtering).
//!
//! Like the rest of `db/`, the inner operations take an explicit `&Conn` (and
//! here an explicit device id) so tests can drive them without a full app
//! state; the `#[shim::command]` wrappers only resolve the live device id and
//! the privacy key.

use crate::db::params;
use crate::db::Conn;
use crate::shim::State;
use serde::{Deserialize, Serialize};

use crate::db;
use crate::document_privacy::{self, decrypt_text, encrypt_text};
use crate::AppState;

/// Settings keys holding the defaults new stickies are created with (set from
/// Settings → Stickies; mirrors tanNotes' `default.color` / `default.opacity`).
const DEFAULT_COLOR_KEY: &str = "sticky_default_color";
const DEFAULT_COLOR: &str = "yellow";
/// Product default (2026-09): new notes open fully opaque.
const DEFAULT_OPACITY: i64 = 100;

/// New-sticky window size, tanNotes parity (its `create_note` defaults).
const DEFAULT_W: i64 = 500;
const DEFAULT_H: i64 = 480;

/// The sticky title is derived state, never user-edited: the first non-empty
/// line of the plain text, trimmed to 80 chars. Empty text → empty title.
pub(crate) fn derive_title(content_text: &str) -> String {
    content_text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(80).collect::<String>())
        .unwrap_or_default()
}

fn clamp_opacity(value: i64) -> i64 {
    value.clamp(10, 100)
}

async fn read_setting(conn: &Conn, key: &str) -> Option<String> {
    db::fetch_optional(conn, "SELECT value FROM user_settings WHERE key = ?1", [key], |r| {
        r.get::<String>(0)
    })
    .await
    .ok()
    .flatten()
}

// ── Types ───────────────────────────────────────────────────────────────────

/// One sticky as the manager list and the tray see it. No `content` — the
/// full body only travels in [`StickyDetail`] so opening the manager never
/// ships every note's document body.
#[derive(Serialize)]
pub struct StickyListItem {
    pub id: i64,
    pub title: String,
    /// True once the user renamed the note; saves then stop re-deriving.
    #[serde(default)]
    pub custom_title: bool,
    /// Plaintext preview; empty while the note is protected and locked.
    pub preview: String,
    pub word_count: i64,
    pub color: String,
    pub corner: String,
    pub opacity: i64,
    pub always_on_top: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<i64>,
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub w: i64,
    pub h: i64,
    pub collapsed: bool,
    /// Open on *this* device — the manager's Open tab and the launch-reopen
    /// path both key off this, never off another device's windows.
    pub is_open: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// A sticky with its full (decrypted) content — what a sticky window loads.
#[derive(Serialize)]
pub struct StickyDetail {
    #[serde(flatten)]
    pub item: StickyListItem,
    pub content: String,
}

/// The trash list: soft-deleted stickies awaiting restore or purge.
#[derive(Serialize)]
pub struct StickyTrashItem {
    pub id: i64,
    pub title: String,
    pub preview: String,
    pub deleted_at: String,
}

/// One note inside a sticky bundle (export file / import payload). Field set
/// mirrors tanNotes' `ImportNote` where the concepts carry over; geometry is
/// the *exporting* device's window state, applied to the importing device.
#[derive(Serialize, Deserialize)]
pub struct StickyBundleNote {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub content_text: String,
    #[serde(default)]
    pub word_count: i64,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_corner")]
    pub corner: String,
    #[serde(default = "default_opacity")]
    pub opacity: i64,
    #[serde(default = "default_true")]
    pub always_on_top: bool,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub font_size: Option<i64>,
    #[serde(default)]
    pub x: Option<i64>,
    #[serde(default)]
    pub y: Option<i64>,
    #[serde(default = "default_w")]
    pub w: i64,
    #[serde(default = "default_h")]
    pub h: i64,
    #[serde(default)]
    pub collapsed: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

fn default_color() -> String {
    DEFAULT_COLOR.to_string()
}
fn default_corner() -> String {
    "rounded".to_string()
}
fn default_opacity() -> i64 {
    DEFAULT_OPACITY
}
fn default_true() -> bool {
    true
}
fn default_w() -> i64 {
    DEFAULT_W
}
fn default_h() -> i64 {
    DEFAULT_H
}

// ── Shared SQL fragments ────────────────────────────────────────────────────

const LIST_COLUMNS: &str = "d.id, d.title, \
     CASE WHEN d.protected=1 THEN '' ELSE d.content_text END, d.word_count, \
     s.color, s.corner, s.opacity, s.always_on_top, s.font_family, s.font_size, \
     w.x, w.y, COALESCE(w.w, 500), COALESCE(w.h, 480), COALESCE(w.collapsed, 0), COALESCE(w.is_open, 0), \
     d.created_at, d.updated_at, COALESCE(s.custom_title, 0)";

fn list_item(row: &db::Row) -> Result<StickyListItem, sea_orm::DbErr> {
    Ok(StickyListItem {
        id: row.get(0)?,
        title: row.get(1)?,
        preview: row.get(2)?,
        word_count: row.get(3)?,
        color: row.get(4)?,
        corner: row.get(5)?,
        opacity: row.get(6)?,
        always_on_top: row.get::<i64>(7)? != 0,
        font_family: row.get(8)?,
        font_size: row.get(9)?,
        x: row.get(10)?,
        y: row.get(11)?,
        w: row.get(12)?,
        h: row.get(13)?,
        collapsed: row.get::<i64>(14)? != 0,
        is_open: row.get::<i64>(15)? != 0,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        custom_title: row.get::<i64>(18)? != 0,
    })
}

/// Live stickies joined with `stickies` and the given device's window state.
const LIST_FROM: &str = "FROM documents d \
     JOIN stickies s ON s.document_id = d.id \
     LEFT JOIN sticky_windows w ON w.document_id = d.id AND w.device_id = ?1 \
     WHERE d.kind = 'sticky' AND d.deleted_at IS NULL";

// ── Inner operations (device passed explicitly; testable without State) ────

pub(crate) async fn list_for_device(conn: &Conn, device_id: &str) -> Result<Vec<StickyListItem>, String> {
    db::fetch_all(
        conn,
        &format!(
            "SELECT {LIST_COLUMNS} {LIST_FROM}
             ORDER BY COALESCE(w.is_open, 0) DESC, d.updated_at DESC, d.id DESC"
        ),
        [device_id],
        list_item,
    )
    .await
}

pub(crate) async fn get_for_device(
    conn: &Conn,
    id: i64,
    device_id: &str,
) -> Result<Option<StickyListItem>, String> {
    db::fetch_optional(
        conn,
        &format!("SELECT {LIST_COLUMNS} {LIST_FROM} AND d.id = ?2"),
        params![device_id, id],
        list_item,
    )
    .await
}

/// Creates the `documents` (kind='sticky') + `stickies` + `sticky_windows`
/// rows for a new sticky and returns its id. `color` falls back to the stored
/// default; the note is born open on the calling device.
pub(crate) async fn create(
    conn: &Conn,
    device_id: &str,
    content: &str,
    content_text: &str,
    word_count: i64,
    color: Option<String>,
) -> Result<i64, String> {
    let (task_total, task_done) = crate::db::documents::count_tasks(content);
    let color = match color {
        Some(c) if !c.trim().is_empty() => c,
        _ => read_setting(conn, DEFAULT_COLOR_KEY)
            .await
            .unwrap_or_else(|| DEFAULT_COLOR.to_string()),
    };
    // No settings-key override: the panel that wrote it is gone, and the
    // default is a fixed product decision (100 = fully opaque).
    let opacity: i64 = DEFAULT_OPACITY;

    let id = db::fetch_one(
        conn,
        "INSERT INTO documents (title, content, content_text, tags, word_count, kind, task_total, task_done)
         VALUES (?1, ?2, ?3, '[]', ?4, 'sticky', ?5, ?6) RETURNING id",
        params![
            derive_title(content_text),
            content,
            content_text,
            word_count,
            task_total,
            task_done
        ],
        |r| r.get::<i64>(0),
    )
    .await?;

    conn.execute(
        "INSERT INTO stickies (document_id, color, opacity) VALUES (?1, ?2, ?3)",
        params![id, color, clamp_opacity(opacity)],
    )
    .await
    .map_err(|e| e.to_string())?;

    set_window_state(
        conn,
        id,
        device_id,
        &WindowPatch {
            w: Some(DEFAULT_W),
            h: Some(DEFAULT_H),
            collapsed: Some(false),
            is_open: Some(true),
            ..WindowPatch::default()
        },
    )
    .await?;

    Ok(id)
}

/// One sticky's window-state patch, applied to a single device's row.
#[derive(Default, Clone, Copy)]
pub(crate) struct WindowPatch {
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub w: Option<i64>,
    pub h: Option<i64>,
    pub collapsed: Option<bool>,
    pub is_open: Option<bool>,
}

pub(crate) async fn set_window_state(
    conn: &Conn,
    id: i64,
    device_id: &str,
    patch: &WindowPatch,
) -> Result<(), String> {
    // Upsert a base row first, then apply the dynamic SET list — this keeps
    // partial patches (e.g. only `is_open`) from wiping stored geometry.
    conn.execute(
        "INSERT INTO sticky_windows (document_id, device_id, w, h) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(document_id, device_id) DO NOTHING",
        params![id, device_id, DEFAULT_W, DEFAULT_H],
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut assignments: Vec<String> = Vec::with_capacity(7);
    let mut values: Vec<db::Value> = Vec::with_capacity(8);
    if let Some(x) = patch.x {
        values.push(x.into());
        assignments.push(format!("x=?{}", values.len()));
    }
    if let Some(y) = patch.y {
        values.push(y.into());
        assignments.push(format!("y=?{}", values.len()));
    }
    if let Some(w) = patch.w {
        values.push(w.into());
        assignments.push(format!("w=?{}", values.len()));
    }
    if let Some(h) = patch.h {
        values.push(h.into());
        assignments.push(format!("h=?{}", values.len()));
    }
    if let Some(collapsed) = patch.collapsed {
        values.push((collapsed as i64).into());
        assignments.push(format!("collapsed=?{}", values.len()));
    }
    if let Some(is_open) = patch.is_open {
        values.push((is_open as i64).into());
        assignments.push(format!("is_open=?{}", values.len()));
    }
    if assignments.is_empty() {
        return Ok(());
    }
    assignments.push("updated_at=datetime('now')".to_string());
    // Append the WHERE keys last so the `?N` placeholders above stay stable.
    values.push(id.into());
    values.push(device_id.into());
    let id_ph = values.len() - 1;
    let device_ph = values.len();

    conn.execute(
        &format!(
            "UPDATE sticky_windows SET {} WHERE document_id=?{id_ph} AND device_id=?{device_ph}",
            assignments.join(", "),
        ),
        values,
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Updates the shared sticky identity. `font_family` uses `Some("")` to mean
/// "clear back to inherit"; `None` leaves the column untouched.
pub(crate) async fn update_meta(
    conn: &Conn,
    id: i64,
    color: Option<&str>,
    corner: Option<&str>,
    opacity: Option<i64>,
    always_on_top: Option<bool>,
    font_family: Option<Option<String>>,
    font_size: Option<Option<i64>>,
) -> Result<(), String> {
    let mut assignments: Vec<String> = Vec::with_capacity(6);
    let mut values: Vec<db::Value> = Vec::with_capacity(6);
    if let Some(c) = color {
        values.push(c.to_string().into());
        assignments.push(format!("color=?{}", values.len()));
    }
    if let Some(c) = corner {
        values.push(c.to_string().into());
        assignments.push(format!("corner=?{}", values.len()));
    }
    if let Some(o) = opacity {
        values.push(clamp_opacity(o).into());
        assignments.push(format!("opacity=?{}", values.len()));
    }
    if let Some(a) = always_on_top {
        values.push((a as i64).into());
        assignments.push(format!("always_on_top=?{}", values.len()));
    }
    if let Some(ff) = font_family {
        values.push(ff.into());
        assignments.push(format!("font_family=?{}", values.len()));
    }
    if let Some(fs) = font_size {
        values.push(fs.into());
        assignments.push(format!("font_size=?{}", values.len()));
    }
    if assignments.is_empty() {
        return Ok(());
    }
    values.push(id.into());
    let id_ph = values.len();

    conn.execute(
        &format!(
            "UPDATE stickies SET {} WHERE document_id=?{id_ph}",
            assignments.join(", ")
        ),
        values,
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())?;
    // Meta changes reorder the manager list the same way edits do.
    conn.execute(
        "UPDATE documents SET updated_at=datetime('now') WHERE id=?1",
        params![id],
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Saves sticky content: derived title (from the *plaintext* — a protected
/// note's stored copy is ciphertext and can't be walked), task counts, and
/// the same encrypt-on-store path as `db_update_document_content`.
pub(crate) async fn save_content(
    conn: &Conn,
    id: i64,
    content: &str,
    content_text: &str,
    word_count: i64,
    cipher: Option<&[u8; 32]>,
) -> Result<(), String> {
    let title = derive_title(content_text);
    let (task_total, task_done) = crate::db::documents::count_tasks(content);
    let (content, content_text) = match cipher {
        Some(key) => (encrypt_text(key, content)?, encrypt_text(key, content_text)?),
        None => (content.to_string(), content_text.to_string()),
    };
    conn.execute(
        "UPDATE documents SET
           title = CASE WHEN COALESCE((SELECT custom_title FROM stickies WHERE document_id=?7), 0) = 1
                        THEN title ELSE ?1 END,
           content=?2, content_text=?3, word_count=?4,
         updated_at=datetime('now'), task_total=?5, task_done=?6
         WHERE id=?7 AND kind='sticky' AND deleted_at IS NULL",
        params![title, content, content_text, word_count, task_total, task_done, id],
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub(crate) async fn soft_delete(conn: &Conn, id: i64) -> Result<bool, String> {
    let n = conn
        .execute(
            "UPDATE documents SET deleted_at=datetime('now'), updated_at=datetime('now')
             WHERE id=?1 AND kind='sticky' AND deleted_at IS NULL",
            params![id],
        )
        .await
        .map_err(|e| e.to_string())?;
    if n > 0 {
        // A trashed note has no windows anywhere.
        conn.execute(
            "UPDATE sticky_windows SET is_open=0, updated_at=datetime('now') WHERE document_id=?1",
            params![id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(n > 0)
}

pub(crate) async fn restore(conn: &Conn, id: i64) -> Result<bool, String> {
    let n = conn
        .execute(
            "UPDATE documents SET deleted_at=NULL, updated_at=datetime('now')
             WHERE id=?1 AND kind='sticky' AND deleted_at IS NOT NULL",
            params![id],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// Hard-deletes a *trashed* sticky: asset rows, window state, the `stickies`
/// row, then the document. Explicit deletes (not FK CASCADE) so the cleanup
/// reads the same on both backends.
pub(crate) async fn purge(conn: &Conn, id: i64) -> Result<bool, String> {
    let n = conn
        .execute(
            "DELETE FROM documents WHERE id=?1 AND kind='sticky' AND deleted_at IS NOT NULL",
            params![id],
        )
        .await
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Ok(false);
    }
    conn.execute(
        "DELETE FROM document_assets WHERE document_id=?1",
        params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sticky_windows WHERE document_id=?1",
        params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM stickies WHERE document_id=?1",
        params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(true)
}

pub(crate) async fn trash_list(conn: &Conn) -> Result<Vec<StickyTrashItem>, String> {
    db::fetch_all(
        conn,
        "SELECT d.id, d.title,
                CASE WHEN d.protected=1 THEN '' ELSE d.content_text END, d.deleted_at
         FROM documents d
         JOIN stickies s ON s.document_id = d.id
         WHERE d.kind='sticky' AND d.deleted_at IS NOT NULL
         ORDER BY d.deleted_at DESC, d.id DESC",
        (),
        |row| {
            Ok(StickyTrashItem {
                id: row.get(0)?,
                title: row.get(1)?,
                preview: row.get(2)?,
                deleted_at: row.get(3)?,
            })
        },
    )
    .await
}

pub(crate) async fn search(conn: &Conn, device_id: &str, query: &str) -> Result<Vec<StickyListItem>, String> {
    let query = query.trim();
    if query.is_empty() {
        return list_for_device(conn, device_id).await;
    }
    // FTS5 is SQLite-only (no `documents_fts` on Postgres — see
    // schema_postgres.sql's header note); there it degrades straight to LIKE.
    if conn.kind() == db::DbKind::Local {
        let terms = db::fts_match_query(query);
        if !terms.is_empty() {
            // Its own FROM: the FTS virtual table joins on rowid here, which
            // LIST_FROM (the non-FTS shape) deliberately doesn't include.
            return db::fetch_all(
                conn,
                &format!(
                    "SELECT {LIST_COLUMNS}
                     FROM documents d
                     JOIN stickies s ON s.document_id = d.id
                     LEFT JOIN sticky_windows w ON w.document_id = d.id AND w.device_id = ?1
                     JOIN documents_fts f ON f.rowid = d.id
                     WHERE documents_fts MATCH ?2 AND d.kind='sticky' AND d.deleted_at IS NULL
                     ORDER BY bm25(documents_fts), d.updated_at DESC, d.id DESC"
                ),
                params![device_id, terms],
                list_item,
            )
            .await;
        }
    }
    let pattern = format!("%{}%", db::escape_like(query));
    db::fetch_all(
        conn,
        &format!(
            "SELECT {LIST_COLUMNS} {LIST_FROM}
             AND (d.title LIKE ?2 ESCAPE '\\' OR (d.protected=0 AND d.content_text LIKE ?2 ESCAPE '\\'))
             ORDER BY d.updated_at DESC, d.id DESC"
        ),
        params![device_id, pattern],
        list_item,
    )
    .await
}

pub(crate) async fn bundle_export(conn: &Conn, device_id: &str) -> Result<Vec<StickyBundleNote>, String> {
    db::fetch_all(
        conn,
        "SELECT d.id, d.title, d.content, d.content_text, COALESCE(d.word_count,0), \
                s.color, s.corner, s.opacity, s.always_on_top, s.font_family, s.font_size, \
                w.x, w.y, COALESCE(w.w, 500), COALESCE(w.h, 480), COALESCE(w.collapsed, 0), \
                d.created_at, d.updated_at, d.deleted_at
         FROM documents d
         JOIN stickies s ON s.document_id = d.id
         LEFT JOIN sticky_windows w ON w.document_id = d.id AND w.device_id = ?1
         ORDER BY d.id",
        [device_id],
        |row| {
            Ok(StickyBundleNote {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                content_text: row.get(3)?,
                word_count: row.get(4)?,
                color: row.get(5)?,
                corner: row.get(6)?,
                opacity: row.get(7)?,
                always_on_top: row.get::<i64>(8)? != 0,
                font_family: row.get(9)?,
                font_size: row.get(10)?,
                x: row.get(11)?,
                y: row.get(12)?,
                w: row.get(13)?,
                h: row.get(14)?,
                collapsed: row.get::<i64>(15)? != 0,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
                deleted_at: row.get(18)?,
            })
        },
    )
    .await
}

/// Imports bundle notes as *new* rows (fresh ids on both backends — Postgres
/// `GENERATED ALWAYS AS IDENTITY` cannot take an explicit id without
/// `OVERRIDING SYSTEM VALUE`, and merge-by-title is the documents importer's
/// existing convention). Geometry attaches to the importing device; imported
/// notes start closed everywhere.
pub(crate) async fn bundle_import(
    conn: &Conn,
    device_id: &str,
    notes: &[StickyBundleNote],
) -> Result<usize, String> {
    let mut count = 0;
    for note in notes {
        let (task_total, task_done) = crate::db::documents::count_tasks(&note.content);
        let title = if note.title.trim().is_empty() {
            derive_title(&note.content_text)
        } else {
            note.title.clone()
        };
        let id = db::fetch_one(
            conn,
            "INSERT INTO documents (title, content, content_text, tags, word_count, kind, task_total, task_done, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, '[]', ?4, 'sticky', ?5, ?6, ?7, ?8, ?9) RETURNING id",
            params![
                title,
                note.content.clone(),
                note.content_text.clone(),
                note.word_count,
                task_total,
                task_done,
                note.created_at.clone(),
                note.updated_at.clone(),
                note.deleted_at.clone()
            ],
            |r| r.get::<i64>(0),
        )
        .await?;
        conn.execute(
            "INSERT INTO stickies (document_id, color, corner, opacity, always_on_top, font_family, font_size)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                note.color.clone(),
                note.corner.clone(),
                clamp_opacity(note.opacity),
                note.always_on_top as i64,
                note.font_family.clone(),
                note.font_size
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
        set_window_state(
            conn,
            id,
            device_id,
            &WindowPatch {
                x: note.x,
                y: note.y,
                w: Some(note.w),
                h: Some(note.h),
                collapsed: Some(note.collapsed),
                is_open: Some(false),
                ..WindowPatch::default()
            },
        )
        .await?;
        count += 1;
    }
    Ok(count)
}

// ── Commands ────────────────────────────────────────────────────────────────
// Every command re-derives the calling device from `appconfig` so window
// state can never leak across devices. Content commands ride the same
// privacy-key path as the document commands so a protected sticky stays
// sealed.

#[crate::shim::command]
pub async fn sticky_create(
    content: Option<String>,
    content_text: Option<String>,
    color: Option<String>,
    word_count: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<StickyDetail, String> {
    let db = db::conn(&conn)?;
    let device = crate::appconfig::device_id();
    let id = create(
        &db,
        &device,
        content.as_deref().unwrap_or("{}"),
        content_text.as_deref().unwrap_or(""),
        word_count.unwrap_or(0),
        color,
    )
    .await?;
    sticky_detail(&db, &conn, id)
        .await?
        .ok_or_else(|| "sticky vanished after create".to_string())
}

#[crate::shim::command]
pub async fn sticky_list(conn: State<'_, AppState>) -> Result<Vec<StickyListItem>, String> {
    let db = db::conn(&conn)?;
    list_for_device(&db, &crate::appconfig::device_id()).await
}

#[crate::shim::command]
pub async fn sticky_get(id: i64, conn: State<'_, AppState>) -> Result<Option<StickyDetail>, String> {
    let db = db::conn(&conn)?;
    sticky_detail(&db, &conn, id).await
}

/// Full sticky, decrypting the body when the note is protected and unlocked.
/// Mirrors `db_get_document`'s privacy handling.
async fn sticky_detail(
    db: &Conn,
    state: &State<'_, AppState>,
    id: i64,
) -> Result<Option<StickyDetail>, String> {
    let device = crate::appconfig::device_id();
    let Some(item) = get_for_device(db, id, &device).await? else {
        return Ok(None);
    };
    let stored = db::fetch_one(
        db,
        "SELECT content, content_text FROM documents WHERE id = ?1",
        params![id],
        |row| Ok((row.get::<String>(0)?, row.get::<String>(1)?)),
    )
    .await?;
    let key = document_privacy::require_key(db, &state.document_privacy, id).await?;
    let (content, content_text) = match key {
        Some(key) => (decrypt_text(&key, &stored.0)?, decrypt_text(&key, &stored.1)?),
        None => stored,
    };
    // `item.preview` is '' for protected rows by the SQL; here we are
    // decrypted (or never encrypted), so show the real preview.
    Ok(Some(StickyDetail {
        item: StickyListItem { preview: content_text, ..item },
        content,
    }))
}

#[crate::shim::command]
pub async fn sticky_save_content(
    id: i64,
    content: String,
    content_text: String,
    word_count: i64,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, id).await?;
    save_content(&db, id, &content, &content_text, word_count, key.as_ref()).await
}

/// Inner rename, testable without State. `Some(t)` with a non-empty trimmed
/// value marks the note custom-titled (saves stop re-deriving); `None` or a
/// blank string clears the rename and re-derives from the current body.
/// `cipher` is the note's privacy key (may be absent).
pub(crate) async fn set_title(
    conn: &Conn,
    id: i64,
    title: Option<String>,
    cipher: Option<&[u8; 32]>,
) -> Result<(), String> {
    let trimmed = title.as_deref().map(str::trim).unwrap_or("");
    if !trimmed.is_empty() {
        // Cap at 200 — generous beyond the 80-char derived default, sane
        // against pathological pastes.
        let custom: String = trimmed.chars().take(200).collect();
        conn.execute(
            "UPDATE documents SET title=?1,
               updated_at=datetime('now')
             WHERE id=?2 AND kind='sticky' AND deleted_at IS NULL",
            params![custom, id],
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE stickies SET custom_title=1 WHERE document_id=?1",
            params![id],
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())?;
    } else {
        // Back to derived: rebuild from the (possibly encrypted) body.
        let stored = db::fetch_one(
            conn,
            "SELECT content_text FROM documents WHERE id = ?1",
            params![id],
            |row| Ok(row.get::<String>(0)?),
        )
        .await?;
        let content_text = match cipher {
            Some(key) => decrypt_text(key, &stored)?,
            None => stored,
        };
        conn.execute(
            "UPDATE documents SET title=?1,
               updated_at=datetime('now')
             WHERE id=?2 AND kind='sticky' AND deleted_at IS NULL",
            params![derive_title(&content_text), id],
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE stickies SET custom_title=0 WHERE document_id=?1",
            params![id],
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[crate::shim::command]
pub async fn sticky_set_title(
    id: i64,
    title: Option<String>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let key = document_privacy::require_key(&db, &conn.document_privacy, id).await?;
    set_title(&db, id, title, key.as_ref()).await
}

/// Updates the shared sticky identity. `font_family` of `Some("")` clears the
/// per-note font (back to inherit); `None` leaves it untouched — same for
/// `font_size` via `Some(0)`.
#[crate::shim::command]
pub async fn sticky_update_meta(
    id: i64,
    color: Option<String>,
    corner: Option<String>,
    opacity: Option<i64>,
    always_on_top: Option<bool>,
    font_family: Option<String>,
    font_size: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let font_family = match font_family {
        Some(ref f) if f.is_empty() => Some(None),
        Some(f) => Some(Some(f)),
        None => None,
    };
    let font_size = match font_size {
        Some(0) => Some(None),
        Some(n) => Some(Some(n)),
        None => None,
    };
    update_meta(
        &db,
        id,
        color.as_deref(),
        corner.as_deref(),
        opacity,
        always_on_top,
        font_family,
        font_size,
    )
    .await
}

#[crate::shim::command]
pub async fn sticky_update_window_state(
    id: i64,
    x: Option<i64>,
    y: Option<i64>,
    w: Option<i64>,
    h: Option<i64>,
    collapsed: Option<bool>,
    is_open: Option<bool>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    set_window_state(
        &db,
        id,
        &crate::appconfig::device_id(),
        &WindowPatch { x, y, w, h, collapsed, is_open },
    )
    .await
}

#[crate::shim::command]
pub async fn sticky_delete(id: i64, conn: State<'_, AppState>) -> Result<bool, String> {
    let db = db::conn(&conn)?;
    document_privacy::require_key(&db, &conn.document_privacy, id).await?;
    let deleted = soft_delete(&db, id).await?;
    if deleted {
        conn.document_privacy.lock(id)?;
    }
    Ok(deleted)
}

#[crate::shim::command]
pub async fn sticky_restore(id: i64, conn: State<'_, AppState>) -> Result<bool, String> {
    let db = db::conn(&conn)?;
    restore(&db, id).await
}

#[crate::shim::command]
pub async fn sticky_purge(id: i64, conn: State<'_, AppState>) -> Result<bool, String> {
    let db = db::conn(&conn)?;
    document_privacy::require_key(&db, &conn.document_privacy, id).await?;
    let purged = purge(&db, id).await?;
    if purged {
        conn.document_privacy.lock(id)?;
    }
    Ok(purged)
}

#[crate::shim::command]
pub async fn sticky_trash_list(conn: State<'_, AppState>) -> Result<Vec<StickyTrashItem>, String> {
    let db = db::conn(&conn)?;
    trash_list(&db).await
}

#[crate::shim::command]
pub async fn sticky_search(query: String, conn: State<'_, AppState>) -> Result<Vec<StickyListItem>, String> {
    let db = db::conn(&conn)?;
    search(&db, &crate::appconfig::device_id(), &query).await
}

#[crate::shim::command]
pub async fn sticky_bundle_export(conn: State<'_, AppState>) -> Result<Vec<StickyBundleNote>, String> {
    let db = db::conn(&conn)?;
    bundle_export(&db, &crate::appconfig::device_id()).await
}

#[crate::shim::command]
pub async fn sticky_bundle_import(
    notes: Vec<StickyBundleNote>,
    conn: State<'_, AppState>,
) -> Result<usize, String> {
    let db = db::conn(&conn)?;
    bundle_import(&db, &crate::appconfig::device_id(), &notes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Wire-contract guard for EVERY consumer of the sticky HTTP API (the
    /// Electron main process and all three renderer surfaces): `StickyDetail`
    /// must serde-flatten its item — top-level `id`, NO `item` wrapper key.
    /// A wrapper regression surfaces at runtime as "Cannot read properties
    /// of undefined (reading 'id')" in createAndOpenSticky (2026-09 bug).
    #[test]
    fn sticky_detail_serializes_flat_without_item_wrapper() {
        use serde_json::json;
        let item = StickyListItem {
            id: 7,
            title: "t".into(),
            preview: "p".into(),
            word_count: 1,
            color: "yellow".into(),
            corner: "rounded".into(),
            opacity: 80,
            always_on_top: true,
            font_family: None,
            font_size: None,
            x: Some(1),
            y: Some(2),
            w: 260,
            h: 480,
            collapsed: false,
            is_open: false,
            created_at: "2026-01-01 00:00:00".into(),
            updated_at: "2026-01-01 00:00:00".into(),
            custom_title: false,
        };
        let value = serde_json::to_value(StickyDetail { item, content: "[]".into() }).unwrap();
        assert_eq!(value["id"], json!(7), "id must be top-level");
        assert!(value.get("item").is_none(), "no item wrapper key");
        assert_eq!(value["content"], json!("[]"));
    }

    async fn memory_db() -> Conn {
        // `open_memory` hands back the app-state `Db`; tests want a plain `Conn`.
        let db = crate::db::connection::open_memory().await.unwrap();
        db.conn()
    }

    const DEV_A: &str = "device-a";
    const DEV_B: &str = "device-b";

    #[tokio::test]
    async fn create_list_and_title_derivation() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "hello world\nsecond line", 2, None)
            .await
            .unwrap();
        let list = list_for_device(&db, DEV_A).await.unwrap();
        assert_eq!(list.len(), 1);
        let item = &list[0];
        assert_eq!(item.id, id);
        assert_eq!(item.title, "hello world");
        assert_eq!(item.color, DEFAULT_COLOR);
        // Literal on purpose: the defaults are product decisions (2026-09 user
        // request) — new notes open fully opaque and always rounded. A stored
        // `sticky_default_opacity` override no longer exists.
        assert_eq!(item.opacity, 100);
        assert_eq!(item.corner, "rounded");
        assert!(item.is_open);
        assert_eq!(item.w, DEFAULT_W);
        // A second device sees the same sticky but not its window state.
        let other = list_for_device(&db, DEV_B).await.unwrap();
        assert_eq!(other.len(), 1);
        assert!(!other[0].is_open);
        assert_eq!(other[0].w, DEFAULT_W);
    }

    #[tokio::test]
    async fn window_state_is_per_device() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "note", 1, None).await.unwrap();
        set_window_state(
            &db,
            id,
            DEV_A,
            &WindowPatch { x: Some(100), y: Some(50), w: Some(300), h: Some(200), ..Default::default() },
        )
        .await
        .unwrap();
        set_window_state(&db, id, DEV_B, &WindowPatch { x: Some(10), y: Some(20), ..Default::default() })
            .await
            .unwrap();

        let a = get_for_device(&db, id, DEV_A).await.unwrap().unwrap();
        assert_eq!(a.x, Some(100));
        assert_eq!(a.w, 300); // A's resize preserved
        let b = get_for_device(&db, id, DEV_B).await.unwrap().unwrap();
        assert_eq!(b.x, Some(10));
        assert_eq!(b.w, DEFAULT_W); // B only moved, never resized
    }

    #[tokio::test]
    async fn save_content_derives_title_and_counts() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "", 0, None).await.unwrap();
        save_content(&db, id, "{\"blocks\":[]}", "new first line\nrest", 3, None)
            .await
            .unwrap();
        let item = get_for_device(&db, id, DEV_A).await.unwrap().unwrap();
        assert_eq!(item.title, "new first line");
        assert_eq!(item.word_count, 3);
        assert_eq!(item.preview, "new first line\nrest");
    }

    #[tokio::test]
    async fn rename_marks_custom_and_survives_save() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "", 0, None).await.unwrap();
        set_title(&db, id, Some("  QA list  ".into()), None).await.unwrap();
        let item = get_for_device(&db, id, DEV_A).await.unwrap().unwrap();
        assert_eq!(item.title, "QA list", "renamed title is trimmed, not derived");
        assert!(item.custom_title, "rename sets the flag");
        // A later save must NOT clobber the custom title.
        save_content(&db, id, "{}", "typed first line", 3, None)
            .await
            .unwrap();
        let item = get_for_device(&db, id, DEV_A).await.unwrap().unwrap();
        assert_eq!(item.title, "QA list");
        assert!(item.custom_title);
    }

    #[tokio::test]
    async fn clearing_rename_rederives_from_body() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "", 0, None).await.unwrap();
        save_content(&db, id, "{}", "first body line\nmore", 2, None)
            .await
            .unwrap();
        set_title(&db, id, Some("custom".into()), None).await.unwrap();
        set_title(&db, id, None, None).await.unwrap();
        let item = get_for_device(&db, id, DEV_A).await.unwrap().unwrap();
        assert_eq!(item.title, "first body line", "back to derived");
        assert!(!item.custom_title);
    }

    #[tokio::test]
    async fn rename_flag_round_trips_through_the_list() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "body", 1, None).await.unwrap();
        set_title(&db, id, Some("renamed".into()), None).await.unwrap();
        let rows = list_for_device(&db, DEV_A).await.unwrap();
        let row = rows.iter().find(|r| r.id == id).unwrap();
        assert!(row.custom_title);
        assert_eq!(row.title, "renamed");
    }

    #[tokio::test]
    async fn trash_round_trip_and_purge() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "trash me", 2, None).await.unwrap();

        assert!(soft_delete(&db, id).await.unwrap());
        assert!(list_for_device(&db, DEV_A).await.unwrap().is_empty());
        let trash = trash_list(&db).await.unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].id, id);
        // A trashed note is invisible to the live list/get paths everywhere.
        assert!(get_for_device(&db, id, DEV_A).await.unwrap().is_none());

        assert!(restore(&db, id).await.unwrap());
        assert_eq!(list_for_device(&db, DEV_A).await.unwrap().len(), 1);
        assert!(trash_list(&db).await.unwrap().is_empty());

        assert!(soft_delete(&db, id).await.unwrap());
        assert!(purge(&db, id).await.unwrap());
        assert!(get_for_device(&db, id, DEV_A).await.unwrap().is_none());
        assert!(trash_list(&db).await.unwrap().is_empty());
        // Purge is only for trashed notes.
        let id2 = create(&db, DEV_A, "{}", "live", 1, None).await.unwrap();
        assert!(!purge(&db, id2).await.unwrap());
    }

    #[tokio::test]
    async fn meta_update_clamps_opacity_and_supports_font_reset() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "meta", 1, None).await.unwrap();
        update_meta(&db, id, Some("blue"), Some("square"), Some(500), Some(false), None, None)
            .await
            .unwrap();
        let item = get_for_device(&db, id, DEV_A).await.unwrap().unwrap();
        assert_eq!(item.color, "blue");
        assert_eq!(item.corner, "square");
        assert_eq!(item.opacity, 100); // clamped from 500
        assert!(!item.always_on_top);

        update_meta(&db, id, None, None, None, None, Some(Some("JetBrains Mono".into())), Some(Some(14)))
            .await
            .unwrap();
        let item = get_for_device(&db, id, DEV_A).await.unwrap().unwrap();
        assert_eq!(item.font_family.as_deref(), Some("JetBrains Mono"));
        assert_eq!(item.font_size, Some(14));

        update_meta(&db, id, None, None, None, None, Some(None), Some(None)).await.unwrap();
        let item = get_for_device(&db, id, DEV_A).await.unwrap().unwrap();
        assert!(item.font_family.is_none());
        assert!(item.font_size.is_none());
    }

    #[tokio::test]
    async fn search_matches_content_and_skips_other_devices_state() {
        let db = memory_db().await;
        let _a = create(&db, DEV_A, "{}", "the quick brown fox", 4, None).await.unwrap();
        let _b = create(&db, DEV_A, "{}", "lazy dog naps", 3, Some("blue".into())).await
            .unwrap();

        let hits = search(&db, DEV_A, "fox").await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].preview, "the quick brown fox");
        assert!(search(&db, DEV_A, "").await.unwrap().len() == 2);
        assert!(search(&db, DEV_A, "zebra").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn bundle_round_trip() {
        let db = memory_db().await;
        let id = create(&db, DEV_A, "{}", "bundled note", 2, Some("pink".into()))
            .await
            .unwrap();
        set_window_state(&db, id, DEV_A, &WindowPatch { x: Some(42), w: Some(320), ..Default::default() })
            .await
            .unwrap();

        let bundle = bundle_export(&db, DEV_A).await.unwrap();
        assert_eq!(bundle.len(), 1);
        assert_eq!(bundle[0].color, "pink");
        assert_eq!(bundle[0].x, Some(42));

        // Import into a fresh database: new row, geometry carried to DEV_B.
        let target = memory_db().await;
        let count = bundle_import(&target, DEV_B, &bundle).await.unwrap();
        assert_eq!(count, 1);
        let imported = list_for_device(&target, DEV_B).await.unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].title, "bundled note"); // content traveled
        assert_eq!(imported[0].color, "pink");
        assert_eq!(imported[0].x, Some(42));
        assert_eq!(imported[0].w, 320);
        assert!(!imported[0].is_open); // imports start closed
    }

    #[tokio::test]
    async fn derive_title_takes_first_non_empty_line() {
        assert_eq!(derive_title("  \n\n  third is first  \nrest"), "third is first");
        assert_eq!(derive_title(""), "");
        let long = "x".repeat(200);
        assert_eq!(derive_title(&long).chars().count(), 80);
    }
}
