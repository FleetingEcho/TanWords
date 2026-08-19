//! Per-table mechanics of `super::db_import_overwrite`: discovering which
//! tables exist on each side (`list_real_tables`, `list_fts5_tables`),
//! ordering them by foreign-key dependencies for a safe delete/insert
//! sequence (`fk_order`), and copying rows in multi-row INSERT batches
//! (`copy_table`) — skipping any single row too large for a remote
//! write-delegation message. These are the helpers the overwrite driver
//! orchestrates; the driver itself and the result/progress types stay in
//! the parent module.

use crate::db::Conn; use crate::db::Value;
use crate::db;
use std::collections::HashSet;

// ── Schema introspection ─────────────────────────────────────────────────
// `source` is always a plain local SQLite file (`open_source` guarantees
// it), so its introspection is always the SQLite branch below. `target`
// (used only for `list_real_tables`, to know which tables actually exist to
// delete/copy into) can be either backend.

pub(super) async fn list_real_tables(conn: &Conn) -> Result<Vec<String>, String> {
    if conn.backend() == sea_orm::DbBackend::Postgres {
        return db::fetch_all(
            conn,
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
            (),
            |r| r.get(0),
        )
        .await;
    }
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
pub(super) async fn list_fts5_tables(conn: &Conn) -> Result<Vec<String>, String> {
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
pub(super) async fn fk_order(
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

pub(super) async fn copy_table(
    source: &Conn,
    target: &Conn,
    table: &str,
    is_remote: bool,
    skipped: &mut Vec<String>,
) -> Result<i64, String> {
    use crate::db::pg_copy::{json_cell_to_bind, postgres_dest_column_types, resync_postgres_identity_sequence};
    use sea_orm::FromQueryResult;

    // Only meaningful (and only fetched) when `target` is Postgres — see
    // `db::pg_copy`'s module doc for why a NULL bind needs it there.
    let dest_col_types = postgres_dest_column_types(target, table).await;

    // Read every source row as a JSON object. SeaORM's `JsonValue`
    // `FromQueryResult` impl probes each column's declared type and decodes
    // it into the matching json scalar, so this works on both sqlite and
    // postgres sources without us hand-mapping column types. `json_cell_to_bind`
    // (not the raw JSON value) handles this schema's few BLOB columns, which
    // decode as a JSON array of byte values through this probe.
    let rows = source
        .query_all(&format!("SELECT * FROM \"{table}\""), ())
        .await
        .map_err(|e| format!("Failed to read {table}: {e}"))?;

    // Decode every row up front into its JSON object, and derive the column
    // list from that same decode's keys — NOT from `column_names()`. Those
    // two used to be different orderings: `column_names()` returns the
    // physical/schema column order, but `serde_json::Map` (used to hold a
    // decoded row) is a `BTreeMap` — alphabetical by key — unless the crate's
    // `preserve_order` feature is on, which it isn't here. Building the
    // column list from one ordering and each row's bound values from the
    // other silently bound every value into the wrong column position.
    // SQLite's weak per-column typing let that corrupt data with no error;
    // Postgres's strict typing is what actually surfaced it (as a "column X
    // is of type Y but expression is of type Z" error) — it was already
    // wrong for a SQLite target too. Below, `map.get(col)` for each column in
    // `column_list`'s own order makes the two impossible to desync, rather
    // than relying on two separate derivations staying aligned.
    let mut decoded_rows: Vec<serde_json::Map<String, serde_json::Value>> = Vec::with_capacity(rows.len());
    for row in &rows {
        let obj = sea_orm::JsonValue::from_query_result(row, "")
            .map_err(|e| format!("Failed to decode row from {table}: {e}"))?;
        match obj {
            serde_json::Value::Object(m) => decoded_rows.push(m),
            _ => return Err(format!("Unexpected row shape from {table}")),
        }
    }

    let column_names: Vec<String> = if let Some(first) = decoded_rows.first() {
        first.keys().cloned().collect()
    } else {
        // No rows: the INSERT skeleton this builds is never actually
        // executed (`flush` no-ops on an empty batch), so an empty/
        // best-effort list is fine — just needs to not panic below.
        match source.backend() {
            sea_orm::DbBackend::Sqlite => db::fetch_all(
                source,
                "SELECT name FROM pragma_table_info(?) ORDER BY cid",
                [table],
                |r| r.get::<String>(0),
            )
            .await
            .unwrap_or_default(),
            _ => Vec::new(),
        }
    };
    let column_count = column_names.len() as i32;
    let column_list = column_names.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", ");

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
        let overriding = crate::db::pg_copy::postgres_overriding_clause(target);
        let mut sql = format!("INSERT INTO \"{table}\" ({column_list}){overriding} VALUES ");
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

    for map in decoded_rows {
        // Look up by name in `column_names`'s order — see the comment above
        // on why this must not rely on `map`'s own iteration order matching.
        let values: Vec<Value> = column_names
            .iter()
            .map(|col| {
                let v = map.get(col).unwrap_or(&serde_json::Value::Null);
                json_cell_to_bind(table, col, v, dest_col_types.get(col.as_str()).map(|s| s.as_str()))
            })
            .collect();
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
    // `OVERRIDING SYSTEM VALUE` (in `flush`) preserves the source's original
    // ids on a Postgres target but doesn't advance the identity sequence —
    // without this, the very next ordinary insert (the app itself, adding a
    // word) would collide with an id this copy just took. No-op elsewhere.
    resync_postgres_identity_sequence(target, table, &dest_col_types).await;
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use crate::db::connection::DbProfile;

    /// Regression test for a column-misalignment bug that predates Postgres
    /// support entirely: the column list used to come from `column_names()`
    /// (physical/schema order) while each row's bound values came from
    /// `serde_json::Map::iter()` — a `BTreeMap`, alphabetical by key, since
    /// this crate doesn't enable serde_json's `preserve_order` feature. For
    /// a table whose alphabetical and physical column orders differ (most of
    /// them), every value silently bound into the wrong column position.
    /// SQLite's weak per-column typing let that through with no error —
    /// wrong data, not a crash — which is exactly why it went unnoticed
    /// until Postgres's strict typing turned the same bug into a visible
    /// error. This pins the fix: a table where alphabetical order really
    /// does differ from physical order, checked field-by-field.
    #[tokio::test]
    async fn overwrite_import_keeps_columns_aligned_against_a_sqlite_target() {
        let source_path = std::env::temp_dir()
            .join(format!("tanwords-overwrite-sqlite-src-{}.db", uuid::Uuid::new_v4()));
        {
            let seed = crate::db::connection::open(
                &DbProfile::Local { path: source_path.to_string_lossy().into_owned() },
                None,
            )
            .await
            .unwrap()
            .conn();
            // `words`' physical column order starts (id, word, word_type,
            // level, word_freq, ...) — alphabetically, `created_at` and
            // `enrichment_json` sort before `id`, so a column-order mixup
            // here reliably produces visibly wrong data instead of an
            // accidental pass.
            seed.execute(
                "INSERT INTO words (word, word_type, level, word_freq, mnemonic) VALUES ('alignmentword', 'noun', 'B2', 7, 'remember this')",
                (),
            )
            .await
            .unwrap();
        }

        let target_path = std::env::temp_dir()
            .join(format!("tanwords-overwrite-sqlite-tgt-{}.db", uuid::Uuid::new_v4()));
        let database = crate::db::connection::open(
            &DbProfile::Local { path: target_path.to_string_lossy().into_owned() },
            None,
        )
        .await
        .unwrap();

        let (registry, app) = crate::build_state_for(database, None).await;
        let ctx = crate::rpc::Ctx::new(registry, app);

        crate::rpc::dispatch::dispatch(
            &ctx,
            "db_import_overwrite",
            crate::rpc::Args::new(serde_json::json!({
                "sourcePath": source_path.to_string_lossy(),
                "password": null,
            })),
        )
        .await
        .expect("overwrite-import should succeed against a SQLite target");

        let target_conn = crate::db::connection::open(
            &DbProfile::Local { path: target_path.to_string_lossy().into_owned() },
            None,
        )
        .await
        .unwrap()
        .conn();
        let (word, word_type, level, word_freq, mnemonic): (String, String, String, i64, String) = crate::db::fetch_one(
            &target_conn,
            "SELECT word, word_type, level, word_freq, mnemonic FROM words WHERE word = 'alignmentword'",
            (),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .await
        .unwrap();
        assert_eq!(word, "alignmentword");
        assert_eq!(word_type, "noun");
        assert_eq!(level, "B2");
        assert_eq!(word_freq, 7);
        assert_eq!(mnemonic, "remember this");

        let _ = std::fs::remove_file(&source_path);
        let _ = std::fs::remove_file(&target_path);
    }
}
