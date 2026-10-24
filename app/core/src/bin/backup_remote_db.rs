// One-shot: dump the currently-connected remote Postgres database to a local
// SQLite file. Headless twin of the App's `db_export_postgres_backup` — same
// shape (fresh SQLite via connection::open, children-first clear, parents-
// first copy), minus the progress events and the optional zip wrapper.
//
// Run:
//   cargo run --release --bin backup_remote_db -- /path/to/backup.db
//
// Reads the active profile from app_config.json, so it backs up whatever the
// app is currently pointed at (the remote Postgres today).

use tanwords_lib::db::connection::{open, DbProfile};
use tanwords_lib::db::rows::Value;

fn postgres_table_order() -> Vec<String> {
    static SCHEMA: &str = include_str!("../../sql/schema_postgres.sql");
    let re = regex::Regex::new(r"(?m)^CREATE TABLE IF NOT EXISTS (\w+)").unwrap();
    re.captures_iter(SCHEMA).map(|c| c[1].to_string()).collect()
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let dest_path = std::env::args()
        .nth(1)
        .ok_or("usage: backup_remote_db <dest.db>")?;
    if std::path::Path::new(&dest_path).exists() {
        return Err(format!("{dest_path} already exists — refusing to overwrite"));
    }

    let cfg_path = tanwords_lib::app_data_dir().join("app_config.json");
    let cfg: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&cfg_path).map_err(|e| format!("read {cfg_path:?}: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    let profile: DbProfile =
        serde_json::from_value(cfg["db_profile"].clone()).map_err(|e| e.to_string())?;
    println!("source: {profile:?}");

    // 1. create the destination SQLite file (schema + seed rows)
    let dest_db = open(&DbProfile::Local { path: dest_path.clone() }, None)
        .await
        .map_err(|e| format!("create snapshot file: {e}"))?;
    let dest = dest_db.conn();
    // the pooled connection may carry an open tx; PRAGMA needs the exact
    // session. Disable FK checks for the bulk copy below.
    let _ = dest.execute_batch("PRAGMA foreign_keys=OFF;").await;

    // 2. connect the source
    let source_db = open(&profile, None).await?;
    let source = source_db.conn();
    println!("source backend: {:?}", source_db.backend());

    let tables = postgres_table_order();
    let tx = dest.transaction().await.map_err(|e| e.to_string())?;

    // children-first clear of seed rows
    for table in tables.iter().rev() {
        tx.execute(&format!("DELETE FROM \"{table}\""), ())
            .await
            .map_err(|e| format!("clear {table}: {e}"))?;
    }
    // parents-first copy
    use sea_orm::FromQueryResult;
    for table in tables.iter() {
        let rows = source
            .query_all(&format!("SELECT * FROM \"{table}\""), ())
            .await
            .map_err(|e| format!("read {table}: {e}"))?;
        let mut n = 0usize;
        for row in &rows {
            let decoded = sea_orm::JsonValue::from_query_result(row, "")
                .map_err(|e| format!("decode row from {table}: {e}"))?;
            let map = match decoded {
                serde_json::Value::Object(m) => m,
                _ => return Err(format!("unexpected row shape from {table}")),
            };
            let columns: Vec<&String> = map.keys().collect();
            let quoted = columns.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", ");
            let placeholders = (1..=columns.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
            let sql = format!("INSERT INTO \"{table}\" ({quoted}) VALUES ({placeholders})");
            let values: Vec<Value> = map.iter().map(|(_, v)| json_to_sqlite_bind(v)).collect();
            tx.execute(&sql, values)
                .await
                .map_err(|e| format!("copy into {table}: {e}"))?;
            n += 1;
        }
        println!("  {table}: {n} rows");
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    let _ = dest.execute_batch("PRAGMA foreign_keys=ON;").await;

    // integrity report on the copy
    let words: Option<i64> = tanwords_lib::db::fetch_optional(
        &dest, "SELECT COUNT(*) FROM words", (), |r| {
            let v: Result<i64, _> = r.try_get("", "COUNT(*)");
            v
        },
    )
    .await
    .ok()
    .flatten();
    println!("\nbackup written to {dest_path} (words: {words:?})");
    Ok(())
}

/// JSON cell → SQLite bind value. Mirrors `db::pg_copy::json_cell_to_bind`
/// for the SQLite destination (JSON arrays/objects stay as serialized JSON
/// strings, matching how the app stores them locally).
fn json_to_sqlite_bind(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::from(Option::<String>::None),
        serde_json::Value::Bool(b) => Value::from(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::from(i)
            } else if let Some(f) = n.as_f64() {
                Value::from(f)
            } else {
                Value::from(n.to_string())
            }
        }
        serde_json::Value::String(s) => Value::from(s.clone()),
        // arrays (words.tags etc.) and objects land as JSON text
        other => Value::from(other.to_string()),
    }
}
