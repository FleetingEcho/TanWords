//! One-time migration from tanNotes (`com.tannotes.app`) into stickies.
//!
//! Three commands, mirroring the db-import shape: `sticky_tannotes_preview`
//! opens the source read-only and reports counts + found settings;
//! `sticky_tannotes_raw` hands the raw note rows to the renderer (which owns
//! the Tiptap-PM-JSON → Block[] conversion via `tanNotesImport.ts` — the
//! adapter lives on the renderer side, so core never re-implements the block
//! format); `sticky_tannotes_apply` writes the converted notes back in ONE
//! transaction, after the caller has had its backup shot (`db_export_backup`).
//!
//! Geometry rides to the CURRENT device (sticky_windows is per-device by
//! design); content/color/opacity/font/trash state are shared. Old imports
//! keep their tanNotes ids only as `source_id` — new ids are always minted
//! (Postgres IDENTITY can't take explicit ids; same rule as bundle_import).

use crate::db::connection::DbKind;
use crate::db::documents::count_tasks;
use crate::db::params;
use crate::db::{self, Conn};
use crate::shim::State;
use serde::{Deserialize, Serialize};

/// Opens the tanNotes database read-only. Same URL trick as
/// `import/source.rs`'s open_source — any SQLite file works.
async fn open_tannotes(path: &str) -> Result<Conn, String> {
    if !std::path::Path::new(path).exists() {
        return Err(format!("File not found: {path}"));
    }
    // Same read-only single-connection pattern as import/source.rs's
    // open_source — tanNotes.db is just another SQLite file.
    let mut opts = sea_orm::ConnectOptions::new(format!("sqlite://{path}?mode=ro"));
    opts.max_connections(1);
    let db = sea_orm::Database::connect(opts)
        .await
        .map_err(|e| format!("could not open tanNotes database: {e}"))?;
    Ok(Conn::new_db(db, DbKind::Local, None))
}

#[derive(Serialize)]
pub struct TanNotesPreview {
    pub live: i64,
    pub trashed: i64,
    /// tanNotes settings rows (`default.color`, `autostart`, …), verbatim.
    pub settings: Vec<(String, String)>,
}

#[crate::shim::command]
pub async fn sticky_tannotes_preview(path: String) -> Result<TanNotesPreview, String> {
    let source = open_tannotes(&path).await?;
    if db::scalar_i64(
        &source,
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='notes'",
        (),
    )
    .await
        .unwrap_or(0)
        == 0
    {
        return Err("This file has no `notes` table — is it really a tanNotes database?".into());
    }
    let live = db::scalar_i64(&source, "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL", ()).await;
    let trashed = db::scalar_i64(&source, "SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL", ()).await;
    let settings = db::fetch_all(
        &source,
        "SELECT key, value FROM settings ORDER BY key",
        (),
        |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
    )
    .await
    .unwrap_or_default();
    Ok(TanNotesPreview {
        live: live.unwrap_or(0),
        trashed: trashed.unwrap_or(0),
        settings,
    })
}

/// One raw tanNotes row, verbatim — the renderer converts `doc` (Tiptap PM
/// JSON) into TanWords blocks. Epoch-millisecond timestamps travel as-is.
#[derive(Serialize)]
pub struct TanNotesRawNote {
    pub id: String,
    pub doc: String,
    pub plain_text: String,
    pub color: String,
    pub corner: String,
    pub opacity: i64,
    pub always_on_top: bool,
    pub font_family: Option<String>,
    pub font_size: Option<i64>,
    pub collapsed: bool,
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub w: i64,
    pub h: i64,
    pub is_open: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[crate::shim::command]
pub async fn sticky_tannotes_raw(path: String) -> Result<Vec<TanNotesRawNote>, String> {
    let source = open_tannotes(&path).await?;
    db::fetch_all(
        &source,
        "SELECT id, doc, plain_text, color, corner, opacity, always_on_top, font_family,
                font_size, collapsed, x, y, w, h, is_open, created_at, updated_at, deleted_at
         FROM notes ORDER BY created_at",
        (),
        |r| {
            Ok(TanNotesRawNote {
                id: r.get(0)?,
                doc: r.get(1)?,
                plain_text: r.get(2)?,
                color: r.get(3)?,
                corner: r.get(4)?,
                opacity: r.get::<String>(5)?.parse().unwrap_or(100),
                always_on_top: r.get::<i64>(6)? != 0,
                font_family: r.get(7)?,
                font_size: r.get(8)?,
                collapsed: r.get::<i64>(9)? != 0,
                x: r.get(10)?,
                y: r.get(11)?,
                w: r.get(12)?,
                h: r.get(13)?,
                is_open: r.get::<i64>(14)? != 0,
                created_at: r.get(15)?,
                updated_at: r.get(16)?,
                deleted_at: r.get(17)?,
            })
        },
    )
    .await
}

/// One CONVERTED note, ready for `sticky_tannotes_apply`. The renderer did
/// the PM→blocks conversion (and derived the title from `plain_text`).
#[derive(Deserialize)]
pub struct TanNotesImportNote {
    pub source_id: String,
    pub title: String,
    pub content: String,
    pub content_text: String,
    pub word_count: i64,
    pub color: String,
    pub corner: String,
    pub opacity: i64,
    pub always_on_top: bool,
    pub font_family: Option<String>,
    pub font_size: Option<i64>,
    pub collapsed: bool,
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub w: i64,
    pub h: i64,
    pub is_open: bool,
    /// "YYYY-MM-DD HH:MM:SS" (the renderer converts tanNotes epoch millis).
    pub created_at: String,
    pub updated_at: String,
    pub deleted: bool,
}

#[derive(Serialize)]
pub struct TanNotesImportMapping {
    pub source_id: String,
    pub new_id: i64,
}

#[derive(Serialize)]
pub struct TanNotesApplyReport {
    pub imported: usize,
    pub failed: Vec<(String, String)>,
    pub mappings: Vec<TanNotesImportMapping>,
}

/// Applies converted notes in one transaction. Backup is the CALLER's job
/// (Settings flow runs `db_export_backup` first) — by the time this runs the
/// user has already confirmed twice.
#[crate::shim::command]
pub async fn sticky_tannotes_apply(
    notes: Vec<TanNotesImportNote>,
    conn: State<'_, crate::AppState>,
) -> Result<TanNotesApplyReport, String> {
    let device = crate::appconfig::device_id();
    let target = db::txn_conn(&conn).await?;
    let tx = target.transaction().await.map_err(|e| e.to_string())?;
    let report = apply_notes(&tx, &device, &notes).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(report)
}

/// The transaction body — split out so tests can drive it against an
/// in-memory database without the app-state plumbing.
pub(crate) async fn apply_notes(
    tx: &Conn,
    device: &str,
    notes: &[TanNotesImportNote],
) -> Result<TanNotesApplyReport, String> {
    let mut report = TanNotesApplyReport { imported: 0, failed: Vec::new(), mappings: Vec::new() };
    for note in notes {
        let (task_total, task_done) = count_tasks(&note.content);
        let result = db::fetch_one(
            &tx,
            "INSERT INTO documents (title, content, content_text, tags, word_count, kind,
                                   task_total, task_done, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, '[]', ?4, 'sticky', ?5, ?6, ?7, ?8, ?9) RETURNING id",
            params![
                note.title.clone(),
                note.content.clone(),
                note.content_text.clone(),
                note.word_count,
                task_total,
                task_done,
                note.created_at.clone(),
                note.updated_at.clone(),
                if note.deleted {
                    Some(note.updated_at.clone())
                } else {
                    None
                }
            ],
            |r| r.get::<i64>(0),
        )
        .await;
        let id = match result {
            Ok(id) => id,
            Err(e) => {
                report.failed.push((note.source_id.clone(), e.to_string()));
                continue;
            }
        };
        if let Err(e) = tx
            .execute(
                "INSERT INTO stickies (document_id, color, corner, opacity, always_on_top, font_family, font_size)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id,
                    note.color.clone(),
                    note.corner.clone(),
                    note.opacity.clamp(10, 100),
                    note.always_on_top as i64,
                    note.font_family.clone(),
                    note.font_size
                ],
            )
            .await
        {
            report.failed.push((note.source_id.clone(), e.to_string()));
            continue;
        }
        // Geometry to THIS device only — another device's windows are its own.
        if let Err(e) = tx
            .execute(
                "INSERT INTO sticky_windows (document_id, device_id, x, y, w, h, collapsed, is_open)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT (document_id, device_id) DO UPDATE SET
                   x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
                   collapsed = excluded.collapsed, is_open = excluded.is_open",
                params![id, device, note.x, note.y, note.w, note.h, note.collapsed, note.is_open],
            )
            .await
        {
            report.failed.push((note.source_id.clone(), e.to_string()));
            continue;
        }
        report.mappings.push(TanNotesImportMapping { source_id: note.source_id.clone(), new_id: id });
        report.imported += 1;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(source_id: &str, title: &str, deleted: bool, is_open: bool) -> TanNotesImportNote {
        TanNotesImportNote {
            source_id: source_id.into(),
            title: title.into(),
            content: r#"[{"type":"paragraph","props":{},"content":[{"type":"text","text":"hello","styles":{}}]}]"#.into(),
            content_text: "hello".into(),
            word_count: 1,
            color: "green".into(),
            corner: "square".into(),
            opacity: 65,
            always_on_top: true,
            font_family: None,
            font_size: Some(18),
            collapsed: false,
            x: Some(1486),
            y: Some(1242),
            w: 392,
            h: 517,
            is_open,
            created_at: "2026-01-20 10:00:00".into(),
            updated_at: "2026-01-20 11:00:00".into(),
            deleted,
        }
    }

    #[tokio::test]
    async fn apply_writes_documents_stickies_and_window_state() {
        let db = crate::db::connection::open_memory().await.unwrap();
        let conn = db.conn();
        let report = apply_notes(
            &conn,
            "test-device",
            &[note("t-1", "one", false, true), note("t-2", "two", true, false)],
        )
        .await
        .unwrap();
        assert_eq!(report.imported, 2);
        assert!(report.failed.is_empty());
        let ids: Vec<i64> = report.mappings.iter().map(|m| m.new_id).collect();
        assert_eq!(ids.len(), 2);

        // Documents: kind=sticky, trash flag on the deleted one, timestamps carried.
        let rows: Vec<(String, Option<String>)> = db::fetch_all(
            &conn,
            "SELECT title, deleted_at FROM documents WHERE kind='sticky' ORDER BY title",
            (),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .await
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], ("one".into(), None));
        assert_eq!(rows[1].0, "two");
        assert!(rows[1].1.is_some(), "deleted note lands in the trash");

        // stickies: tanNotes meta carried over (opacity clamped stays 65).
        let sticky: (String, String, i64, Option<i64>) = db::fetch_one(
            &conn,
            "SELECT s.color, s.corner, s.opacity, s.font_size FROM stickies s
             JOIN documents d ON d.id = s.document_id WHERE d.title = 'one'",
            (),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .await
        .unwrap();
        assert_eq!(sticky.0, "green");
        assert_eq!(sticky.1, "square");
        assert_eq!(sticky.2, 65);
        assert_eq!(sticky.3, Some(18));

        // sticky_windows: per-device geometry, is_open honored per note.
        let wins: Vec<(i64, bool)> = db::fetch_all(
            &conn,
            "SELECT w.x, w.is_open FROM sticky_windows w
             JOIN documents d ON d.id = w.document_id
             WHERE w.device_id = 'test-device' ORDER BY d.title",
            (),
            |r| Ok((r.get(0)?, r.get::<i64>(1)? != 0)),
        )
        .await
        .unwrap();
        assert_eq!(wins.len(), 2);
        assert_eq!(wins[0], (1486, true));
        assert_eq!(wins[1], (1486, false));
    }
}