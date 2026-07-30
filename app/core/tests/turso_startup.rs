//! The startup path specifically: `run()` opens the database with
//! `tauri::async_runtime::block_on`, and libsql's replica code uses
//! `block_in_place` internally, which panics outside a multi-threaded runtime.
//! A saved Turso profile must therefore survive being opened exactly that way.
//!
//!   TURSO_DB_URL=… TURSO_DB_TOKEN=… cargo test --test turso_startup -- --nocapture

use tanwords_lib::db::{connection, DbProfile};

#[test]
fn turso_profile_opens_through_tauri_block_on() {
    let (Ok(url), Ok(token)) = (std::env::var("TURSO_DB_URL"), std::env::var("TURSO_DB_TOKEN"))
    else {
        eprintln!("TURSO_DB_URL / TURSO_DB_TOKEN not set — skipping");
        return;
    };
    let path = std::env::temp_dir()
        .join(format!("tanwords-startup-{}.db", std::process::id()))
        .to_string_lossy()
        .into_owned();
    for s in ["", "-wal", "-shm", "-client_wal_index", "-info"] {
        let _ = std::fs::remove_file(format!("{path}{s}"));
    }

    // Deliberately a sync `#[test]` with no runtime of its own — the same
    // position `run()` is in when it calls this.
    let database = tauri::async_runtime::block_on(connection::open(
        &DbProfile::Turso { path: path.clone(), url },
        Some(&token),
    ))
    .expect("a saved Turso profile must open on the startup path");

    let count = tauri::async_runtime::block_on(tanwords_lib::db::scalar_i64(
        &database.conn(),
        "SELECT COUNT(*) FROM words",
        (),
    ))
    .expect("reads must work right after startup");
    println!("PASS  startup open + first read, words={count}");

    drop(database);
    for s in ["", "-wal", "-shm", "-client_wal_index", "-info"] {
        let _ = std::fs::remove_file(format!("{path}{s}"));
    }
}
