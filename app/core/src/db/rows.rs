//! Row-fetching helpers.
//!
//! libsql's cursor is async (`rows.next().await`), so it has no direct
//! equivalent of rusqlite's `query_row` / `query_map` closures. Rather than
//! open-code the same `while let Some(row)` loop at ~60 call sites, these keep
//! the original shape — a SQL string, params, and a `|row|` mapper — so the
//! query modules stay about as readable as they were.

use libsql::{params::IntoParams, Connection, Row};

/// First row only, mapped. `None` when the query matched nothing — the
/// `query_row(..).optional()` pattern.
pub async fn fetch_optional<T, F>(
    conn: &Connection,
    sql: &str,
    params: impl IntoParams,
    map: F,
) -> Result<Option<T>, String>
where
    F: FnOnce(&Row) -> Result<T, libsql::Error>,
{
    let mut rows = conn.query(sql, params).await.map_err(|e| e.to_string())?;
    match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => map(&row).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

/// First row only, mapped, erroring when there is none — plain `query_row`.
pub async fn fetch_one<T, F>(
    conn: &Connection,
    sql: &str,
    params: impl IntoParams,
    map: F,
) -> Result<T, String>
where
    F: FnOnce(&Row) -> Result<T, libsql::Error>,
{
    fetch_optional(conn, sql, params, map)
        .await?
        .ok_or_else(|| "no rows returned".to_string())
}

/// Every row, mapped — `query_map(..).collect()`.
pub async fn fetch_all<T, F>(
    conn: &Connection,
    sql: &str,
    params: impl IntoParams,
    mut map: F,
) -> Result<Vec<T>, String>
where
    F: FnMut(&Row) -> Result<T, libsql::Error>,
{
    let mut rows = conn.query(sql, params).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        out.push(map(&row).map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// `SELECT COUNT(*)`-shaped queries, which are common enough to be worth their
/// own helper. Missing rows count as 0, matching the old `.unwrap_or(0)` use.
pub async fn scalar_i64(
    conn: &Connection,
    sql: &str,
    params: impl IntoParams,
) -> Result<i64, String> {
    Ok(fetch_optional(conn, sql, params, |row| row.get(0))
        .await?
        .unwrap_or(0))
}

/// Number of rows the statement changed — rusqlite's `execute` return value.
pub async fn execute(
    conn: &Connection,
    sql: &str,
    params: impl IntoParams,
) -> Result<u64, String> {
    conn.execute(sql, params).await.map_err(|e| e.to_string())
}
