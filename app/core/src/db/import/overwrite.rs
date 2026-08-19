//! Replacing the active database's contents wholesale with another TanWords
//! database file's contents — every table, not just the natural-keyed subset
//! [`super::apply`] merges. Unlike a merge, this is destructive: every row
//! currently in the target is deleted first, then the source's rows are
//! copied in verbatim (original ids and all, since nothing can collide once
//! the target is empty). Works against either a local database or a
//! connected remote (Turso/self-hosted sqld) target identically — the only
//! target-specific behavior is inherited from [`db::txn_conn`], same as the
//! merge-based import.

use crate::db::Conn; use crate::db::Value;
use std::collections::HashSet;

use super::source::open_source;
use crate::db;
use crate::shim::{AppHandle, State};
use crate::AppState;

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverwriteResult {
    pub tables: Vec<String>,
    pub rows_copied: i64,
    /// Rows too large for a single write-delegation message to carry (see
    /// `MAX_SINGLE_ROW_BYTES`) — left out of the copy rather than failing the
    /// whole operation. Empty against a local target, where this limit
    /// doesn't apply.
    pub skipped: Vec<String>,
}

/// Emitted on `"overwrite-progress"` as `db_import_overwrite` runs.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OverwriteProgress<'a> {
    phase: &'a str, // "clearing" | "copying" | "indexing"
    table: &'a str,
    table_index: usize,
    table_total: usize,
}

/// A remote (Turso/self-hosted sqld) target can drop the connection mid-copy
/// on a large import — observed as a Caddy-proxied `502`/"broken pipe" from a
/// reused backend connection racing sqld's own idle timeout, not anything
/// about the data itself. The whole operation always starts by wiping the
/// target, so it's naturally idempotent: retrying from scratch on a transient
/// failure is safe, unlike retrying a merge import would be.
const MAX_ATTEMPTS: u32 = 3;

#[crate::shim::command]
pub async fn db_import_overwrite(
    app: AppHandle,
    source_path: String,
    password: Option<String>,
    conn: State<'_, AppState>,
) -> Result<OverwriteResult, String> {
    let descriptor = conn.descriptor()?;
    if !descriptor.caps.writable {
        return Err("The current database is read-only and cannot import".into());
    }
    // Overwrite copies a sqlite source file's tables verbatim (original ids,
    // `sqlite_sequence` resets, FTS5 `rebuild` commands). All of that is
    // sqlite-specific and has no Postgres equivalent — a Postgres target
    // would need pg_dump/restore semantics, not a row-by-row INSERT. Refuse
    // rather than silently doing the wrong thing.
    if descriptor.kind == db::DbKind::Postgres {
        return Err("Overwrite-import is only supported on a local SQLite target".into());
    }
    // The 4MiB-ish message-size ceiling (see `MAX_SINGLE_ROW_BYTES`) is a
    // property of write-delegation to a remote primary, not of SQLite — a
    // local target has no such limit, and skipping oversized rows there
    // would only lose data for no reason.
    let is_remote = descriptor.kind == db::DbKind::Turso;
    let temp = super::extract_encrypted_backup_to_temp(
        std::path::Path::new(&source_path),
        password.as_deref(),
    )?;
    let source_path_for_open = temp
        .as_ref()
        .map(|t| t.path().to_string_lossy().into_owned())
        .unwrap_or_else(|| source_path.clone());
    let source = open_source(&source_path_for_open).await?;

    // The source is guaranteed to be a plain local SQLite file (open_source
    // always opens one), so its schema introspection (PRAGMA foreign_key_list,
    // FTS5 detection) is trustworthy regardless of what kind of connection the
    // target turns out to be. The target only ever receives DELETE/INSERT.
    let real_tables = list_real_tables(&source).await?;
    let fts_tables = list_fts5_tables(&source).await?;
    let is_fts_shadow = |name: &str| {
        fts_tables.iter().any(|f| {
            ["_data", "_idx", "_docsize", "_config", "_content"]
                .iter()
                .any(|suffix| name == format!("{f}{suffix}").as_str())
        })
    };
    let copyable: Vec<String> = real_tables
        .into_iter()
        .filter(|t| t != "schema_migrations" && !fts_tables.contains(t) && !is_fts_shadow(t))
        .collect();

    let delete_order = fk_order(&source, &copyable, true).await?;
    let insert_order = fk_order(&source, &copyable, false).await?;

    let mut last_error = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        // A fresh transaction (and, for a remote target, a fresh connection —
        // see `db::txn_conn`) each attempt, since a broken one can't be reused.
        let target = db::txn_conn(&conn).await?;
        let target_tables: HashSet<String> = list_real_tables(&target).await?.into_iter().collect();
        let delete_order: Vec<String> =
            delete_order.iter().filter(|t| target_tables.contains(*t)).cloned().collect();
        let insert_order: Vec<String> =
            insert_order.iter().filter(|t| target_tables.contains(*t)).cloned().collect();

        match run_overwrite(&app, &source, &target, &delete_order, &insert_order, &fts_tables, &target_tables, is_remote).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = e;
                if attempt < MAX_ATTEMPTS {
                    eprintln!(
                        "[import] overwrite attempt {attempt}/{MAX_ATTEMPTS} failed, retrying from scratch: {last_error}"
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
                }
            }
        }
    }
    Err(format!("{last_error} (failed after {MAX_ATTEMPTS} attempts)"))
}

async fn run_overwrite(
    app: &AppHandle,
    source: &Conn,
    target: &Conn,
    delete_order: &[String],
    insert_order: &[String],
    fts_tables: &[String],
    target_tables: &HashSet<String>,
    is_remote: bool,
) -> Result<OverwriteResult, String> {
    let tx = target.transaction().await.map_err(|e| e.to_string())?;

    for (i, table) in delete_order.iter().enumerate() {
        let _ = app.emit(
            "overwrite-progress",
            OverwriteProgress { phase: "clearing", table, table_index: i + 1, table_total: delete_order.len() },
        );
        tx.execute(&format!("DELETE FROM \"{table}\""), ())
            .await
            .map_err(|e| format!("Failed to clear {table}: {e}"))?;
    }
    // Best-effort: restarts autoincrement counters so the freshly copied
    // rows' original ids don't collide with a stale high-water mark. Not
    // every schema has used AUTOINCREMENT anywhere, so a missing
    // sqlite_sequence table is not an error.
    let _ = tx.execute("DELETE FROM sqlite_sequence", ()).await;

    let mut rows_copied = 0i64;
    let mut skipped = Vec::new();
    for (i, table) in insert_order.iter().enumerate() {
        let _ = app.emit(
            "overwrite-progress",
            OverwriteProgress { phase: "copying", table, table_index: i + 1, table_total: insert_order.len() },
        );
        rows_copied += copy_table(source, &tx, table, is_remote, &mut skipped).await?;
    }

    for (i, fts) in fts_tables.iter().enumerate() {
        if !target_tables.contains(fts) {
            continue;
        }
        let _ = app.emit(
            "overwrite-progress",
            OverwriteProgress { phase: "indexing", table: fts, table_index: i + 1, table_total: fts_tables.len() },
        );
        tx.execute(&format!("INSERT INTO \"{fts}\"(\"{fts}\") VALUES('rebuild')"), ())
            .await
            .map_err(|e| format!("Failed to rebuild search index {fts}: {e}"))?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(OverwriteResult { tables: insert_order.to_vec(), rows_copied, skipped })
}

// ── Schema introspection (always run against the local source file) ────────

async fn list_real_tables(conn: &Conn) -> Result<Vec<String>, String> {
    db::fetch_all(
        conn,
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        (),
        |r| r.get(0),
    )
    .await
}

/// FTS5 virtual tables show up as `type='table'` in `sqlite_master` too, with
/// their `USING fts5(...)` definition in `sql` — distinguished from ordinary
/// tables that way.
async fn list_fts5_tables(conn: &Conn) -> Result<Vec<String>, String> {
    db::fetch_all(
        conn,
        "SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%USING fts5%'",
        (),
        |r| r.get(0),
    )
    .await
}

/// Topological order over `tables` restricted to their mutual foreign keys.
/// `children_first`: true for a safe delete order (a row can be deleted once
/// nothing referencing it remains), false for a safe insert order (a row can
/// be inserted once everything it references already exists).
async fn fk_order(
    conn: &Conn,
    tables: &[String],
    children_first: bool,
) -> Result<Vec<String>, String> {
    let table_set: HashSet<&str> = tables.iter().map(String::as_str).collect();
    // referenced_by[parent] = { children that have an FK pointing at parent }
    let mut referenced_by: std::collections::HashMap<String, HashSet<String>> =
        tables.iter().map(|t| (t.clone(), HashSet::new())).collect();
    for table in tables {
        let refs: Vec<String> = db::fetch_all(
            conn,
            &format!("SELECT \"table\" FROM pragma_foreign_key_list(\"{table}\")"),
            (),
            |r| r.get(0),
        )
        .await
        .unwrap_or_default();
        for parent in refs {
            if table_set.contains(parent.as_str()) && parent != *table {
                referenced_by.get_mut(&parent).unwrap().insert(table.clone());
            }
        }
    }

    let mut order = Vec::with_capacity(tables.len());
    let mut done: HashSet<String> = HashSet::new();
    while order.len() < tables.len() {
        let ready: Vec<String> = tables
            .iter()
            .filter(|t| !done.contains(*t))
            .filter(|t| referenced_by[*t].iter().all(|child| done.contains(child)))
            .cloned()
            .collect();
        let batch = if ready.is_empty() {
            // A cycle (e.g. a self-referencing table) - take whatever remains
            // rather than looping forever; FK checks aren't strict about
            // sibling ordering within a cycle for this use case.
            tables.iter().filter(|t| !done.contains(*t)).cloned().collect()
        } else {
            ready
        };
        for t in &batch {
            done.insert(t.clone());
        }
        order.extend(batch);
    }
    if !children_first {
        order.reverse();
    }
    Ok(order)
}

// ── Row copying ──────────────────────────────────────────────────────────

/// Rows per multi-row INSERT batch, capped by count and by an approximate
/// byte budget together: `word_definitions`-shaped tables (thousands of small
/// rows) hit the count cap; `user_settings`-shaped tables (a handful of rows,
/// some holding multi-megabyte base64 images) hit the byte cap instead,
/// naturally falling back toward one huge row per request rather than
/// building one enormous batch. Multi-row inserts over one-row-per-request
/// is what actually matters here: a full-database overwrite was observed to
/// make sqld itself stop accepting connections under the sustained request
/// volume of thousands of individual writes (each one a network round trip
/// against a remote target) — cutting that count by ~200x is the fix, not
/// any particular chunk size tuning.
const BATCH_MAX_ROWS: usize = 200;
const BATCH_MAX_BYTES: usize = 2 * 1024 * 1024;

/// gRPC's default max message size is 4MiB, and sqld's write-delegation path
/// (a Turso/self-hosted target forwards writes to the primary over gRPC-Web)
/// hits it: a single row this big or bigger fails outright — observed as
/// `Unavailable: grpc-status header missing, mapped from HTTP status code
/// 502` on a real ~4.26MB `user_settings` value (a base64 background image)
/// — and retrying changes nothing, since the row's size doesn't change.
/// Comfortably under 4MiB rather than exactly at it, since the row also
/// carries its other columns and INSERT syntax overhead.
const MAX_SINGLE_ROW_BYTES: usize = 3 * 1024 * 1024;

fn value_len(v: &Value) -> usize {
    match v {
        Value::String(Some(s)) => s.len(),
        Value::Bytes(Some(b)) => b.len(),
        _ => 8,
    }
}

fn describe_value(v: &Value) -> String {
    match v {
        Value::BigInt(Some(i)) => i.to_string(),
        Value::Int(Some(i)) => i.to_string(),
        Value::String(Some(s)) => s.chars().take(60).collect(),
        Value::Double(Some(f)) => f.to_string(),
        Value::Float(Some(f)) => f.to_string(),
        Value::Bytes(_) => "<blob>".to_string(),
        _ => "<null>".to_string(),
    }
}

/// Converts a decoded JSON cell back into a bindable SeaORM `Value` for the
/// copy INSERT. The schema has no BLOB columns (verified against schema.sql),
/// so the json-representable scalar set is exhaustive here. Numbers split
/// into integers vs floats so SeaORM binds `BIGINT`/`DOUBLE PRECISION`
/// correctly on Postgres (a json `1` must not be sent as a float).
fn json_to_bind(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::String(None),
        serde_json::Value::Bool(b) => Value::Bool(Some(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::BigInt(Some(i))
            } else if let Some(u) = n.as_u64() {
                Value::BigUnsigned(Some(u))
            } else if let Some(f) = n.as_f64() {
                Value::Double(Some(f))
            } else {
                Value::String(None)
            }
        }
        serde_json::Value::String(s) => Value::String(Some(s.clone())),
        // Arrays/objects (json columns) round-trip as their serialized text.
        other => Value::String(Some(other.to_string())),
    }
}

async fn copy_table(
    source: &Conn,
    target: &Conn,
    table: &str,
    is_remote: bool,
    skipped: &mut Vec<String>,
) -> Result<i64, String> {
    use sea_orm::FromQueryResult;

    // Read every source row as a JSON object. SeaORM's `JsonValue`
    // `FromQueryResult` impl probes each column's declared type and decodes
    // it into the matching json scalar, so this works on both sqlite and
    // postgres sources without us hand-mapping column types. The schema has
    // no BLOB columns, so the json-representable set is complete here.
    let rows = source
        .query_all(&format!("SELECT * FROM \"{table}\""), ())
        .await
        .map_err(|e| format!("Failed to read {table}: {e}"))?;

    let column_list = if rows.is_empty() {
        // No rows: derive the column list from the empty result's metadata so
        // the INSERT skeleton still type-checks against the target (though we
        // won't actually bind anything). `column_names()` on an empty result
        // is backend-defined, so fall back to a PRAGMA-driven list on sqlite.
        match source.backend() {
            sea_orm::DbBackend::Sqlite => {
                let cols: Vec<String> = db::fetch_all(
                    source,
                    "SELECT name FROM pragma_table_info(?) ORDER BY cid",
                    [table],
                    |r| r.get::<String>(0),
                )
                .await
                .unwrap_or_default();
                cols
            }
            _ => rows
                .first()
                .map(|r| r.column_names())
                .unwrap_or_default(),
        }
    } else {
        rows[0].column_names()
    };
    let column_list = column_list
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let column_count = if rows.is_empty() {
        // Re-derive from the column_list we just built (comma-separated quoted names).
        column_list.matches('"').count() / 2
    } else {
        rows[0].column_names().len()
    } as i32;

    let mut copied = 0i64;
    let mut batch: Vec<Vec<Value>> = Vec::new();
    let mut batch_bytes = 0usize;

    async fn flush(
        target: &Conn,
        table: &str,
        column_list: &str,
        column_count: i32,
        batch: &mut Vec<Vec<Value>>,
    ) -> Result<(), String> {
        if batch.is_empty() {
            return Ok(());
        }
        let mut sql = format!("INSERT INTO \"{table}\" ({column_list}) VALUES ");
        let mut values: Vec<Value> = Vec::with_capacity(batch.len() * column_count as usize);
        for (i, row) in batch.iter().enumerate() {
            if i > 0 {
                sql.push(',');
            }
            let base = i * column_count as usize;
            sql.push('(');
            sql.push_str(&(1..=column_count as usize).map(|c| format!("?{}", base + c)).collect::<Vec<_>>().join(","));
            sql.push(')');
            values.extend(row.iter().cloned());
        }
        target.execute(&sql, values).await.map_err(|e| format!("Failed to copy into {table}: {e}"))?;
        batch.clear();
        Ok(())
    }

    for row in rows {
        let obj = sea_orm::JsonValue::from_query_result(&row, "")
            .map_err(|e| format!("Failed to decode row from {table}: {e}"))?;
        let map = match obj {
            serde_json::Value::Object(m) => m,
            _ => return Err(format!("Unexpected row shape from {table}")),
        };
        // Bind in column order (map iteration is insertion-ordered in
        // serde_json, which matches the SELECT order SeaORM used).
        let values: Vec<Value> = map.iter().map(|(_, v)| json_to_bind(v)).collect();
        let row_bytes: usize = values.iter().map(value_len).sum();

        if is_remote && row_bytes > MAX_SINGLE_ROW_BYTES {
            // Can't be split across multiple statements (it's one column's
            // value), and no amount of retrying fixes a fixed message-size
            // limit — so this row is left out of the automated copy rather
            // than failing the whole operation. Identified by its first
            // column, which is `id` or a natural key (`key`, ...) on every
            // table this touches.
            let identifier = values.first().map(describe_value).unwrap_or_default();
            skipped.push(format!("{table}.{identifier} ({} bytes)", row_bytes));
            continue;
        }

        if !batch.is_empty() && (batch.len() >= BATCH_MAX_ROWS || batch_bytes + row_bytes > BATCH_MAX_BYTES) {
            flush(target, table, &column_list, column_count, &mut batch).await?;
            batch_bytes = 0;
        }
        copied += 1;
        batch_bytes += row_bytes;
        batch.push(values);
    }
    flush(target, table, &column_list, column_count, &mut batch).await?;
    Ok(copied)
}
