//! Shared row-copy helpers for moving TanWords data into or out of Postgres —
//! used by both `settings::export_postgres_snapshot` (Postgres → local SQLite
//! backup) and `import::overwrite` (SQLite source → whichever target,
//! including Postgres). Kept in one place because getting these right against
//! a *Postgres destination* specifically has three sharp edges a naive
//! generic row copy misses (each cost a real failed run to find):
//!
//! 1. **Blobs**: SeaORM's generic per-row JSON decode represents a `BYTEA`
//!    column as a JSON array of byte values, not a byte string — bind that
//!    array back verbatim (as a stringified array) and the column silently
//!    corrupts. [`json_cell_to_bind`] converts the known blob columns back to
//!    real bytes explicitly.
//! 2. **Typed NULLs**: a NULL cell carries no type of its own once decoded
//!    through that same generic JSON probe. SQLite accepts a NULL bind of any
//!    declared type into any column (dynamically typed), but Postgres does
//!    not — `Value::String(None)` sent for a `BIGINT` column is a type
//!    mismatch it rejects outright. [`postgres_dest_column_types`] plus
//!    [`json_cell_to_bind`]'s `dest_col_type` fixes that by asking Postgres
//!    what type the destination column actually is.
//! 3. **Identity sequences**: preserving the source's original ids into a
//!    Postgres `GENERATED ALWAYS AS IDENTITY` column requires `OVERRIDING
//!    SYSTEM VALUE` on the INSERT (see [`postgres_overriding_clause`]), and
//!    doing so does *not* advance the column's sequence — left alone, the
//!    very next ordinary INSERT (the app itself, adding a word) would try to
//!    reuse an id already taken by a just-copied row and fail.
//!    [`resync_postgres_identity_sequence`] fixes that up after the copy.

use crate::db::{Conn, Value};
use crate::db::params;
use std::collections::HashMap;

/// Columns that store raw binary data in this schema (`BYTEA` on Postgres,
/// `BLOB` on SQLite) — see the module doc's point 1.
pub(crate) const BLOB_COLUMNS: &[(&str, &str)] = &[
    ("document_assets", "data"),
    ("standalone_assets", "data"),
    ("documents", "protection_salt"),
    ("documents", "wrapped_key"),
];

/// Converts one decoded JSON cell back into a bindable SeaORM `Value`.
/// `dest_col_type` is the destination column's `information_schema.columns`
/// `data_type` — pass `None` for a non-Postgres destination, where it's not
/// needed (see the module doc's point 2).
pub(crate) fn json_cell_to_bind(table: &str, col: &str, v: &serde_json::Value, dest_col_type: Option<&str>) -> Value {
    if BLOB_COLUMNS.contains(&(table, col)) {
        return match v {
            serde_json::Value::Array(items) => {
                let bytes: Vec<u8> = items.iter().filter_map(|n| n.as_u64()).map(|n| n as u8).collect();
                Value::Bytes(Some(bytes))
            }
            _ => Value::Bytes(None),
        };
    }
    match v {
        serde_json::Value::Null => match dest_col_type {
            Some("bigint") | Some("integer") | Some("smallint") => Value::BigInt(None),
            Some("double precision") | Some("real") | Some("numeric") => Value::Double(None),
            Some("bytea") => Value::Bytes(None),
            Some("boolean") => Value::Bool(None),
            _ => Value::String(None),
        },
        serde_json::Value::Bool(b) => Value::Bool(Some(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::BigInt(Some(i))
            } else if let Some(f) = n.as_f64() {
                Value::Double(Some(f))
            } else {
                Value::String(None)
            }
        }
        serde_json::Value::String(s) => Value::String(Some(s.clone())),
        // Arrays/objects other than the known blob columns above don't occur
        // in this schema, but round-trip as their serialized text rather
        // than silently dropping data if one ever does.
        other => Value::String(Some(other.to_string())),
    }
}

/// `column_name -> data_type` for every column of `table` on `dest`. Empty
/// (not an error) when `dest` isn't Postgres — callers only need this there.
pub(crate) async fn postgres_dest_column_types(dest: &Conn, table: &str) -> HashMap<String, String> {
    if dest.backend() != sea_orm::DbBackend::Postgres {
        return HashMap::new();
    }
    crate::db::fetch_all(
        dest,
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?1",
        params![table],
        |r| Ok((r.get::<String>(0)?, r.get::<String>(1)?)),
    )
    .await
    .unwrap_or_default()
    .into_iter()
    .collect()
}

/// The `OVERRIDING SYSTEM VALUE` clause an INSERT into `dest` needs to accept
/// an explicit value for a `GENERATED ALWAYS AS IDENTITY` column — empty for
/// a non-Postgres destination. Safe to include unconditionally on a Postgres
/// destination even for a table with no identity column (natural TEXT
/// primary key): it's a no-op there.
pub(crate) fn postgres_overriding_clause(dest: &Conn) -> &'static str {
    if dest.backend() == sea_orm::DbBackend::Postgres { " OVERRIDING SYSTEM VALUE" } else { "" }
}

/// Resyncs `table`'s identity sequence on `dest` to `MAX(id) + 1`, undoing
/// the effect of `postgres_overriding_clause`'s `OVERRIDING SYSTEM VALUE` on
/// future ordinary inserts. `dest_col_types` is the same map
/// [`postgres_dest_column_types`] already gave the caller — reused here
/// (rather than re-querying) specifically to check whether `table` even has
/// an `id` column *before* calling `pg_get_serial_sequence` at all.
///
/// That check matters more than it looks: `pg_get_serial_sequence` *raises
/// an error* (not NULL) when the column doesn't exist, and this runs inside
/// the same shared transaction as the rest of the copy. Unlike SQLite, a
/// failed statement on Postgres poisons that whole transaction — every
/// statement after it fails with "current transaction is aborted" — so
/// catching the error in Rust with `.ok()` does not undo the damage already
/// done to the transaction. No-op on a table with no `id` column, or when
/// `dest` isn't Postgres.
pub(crate) async fn resync_postgres_identity_sequence(
    dest: &Conn,
    table: &str,
    dest_col_types: &HashMap<String, String>,
) {
    if dest.backend() != sea_orm::DbBackend::Postgres || !dest_col_types.contains_key("id") {
        return;
    }
    let seq: Option<String> = crate::db::fetch_one(
        dest,
        "SELECT pg_get_serial_sequence(?1, 'id')",
        params![table],
        |r| r.get::<Option<String>>(0),
    )
    .await
    .ok()
    .flatten();
    if let Some(seq) = seq {
        let _ = dest
            .execute(
                &format!("SELECT setval(?1, COALESCE((SELECT MAX(id) FROM \"{table}\"), 0) + 1, false)"),
                params![seq],
            )
            .await;
    }
}
