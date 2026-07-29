//! The offline fallback for a Turso profile: when it should serve the local
//! replica, and when serving it would be a lie.

use tanwords_lib::db::{connection, DbProfile};

fn temp_path(tag: &str) -> String {
    std::env::temp_dir()
        .join(format!("tanwords-{tag}-{}.db", uuid::Uuid::new_v4()))
        .to_string_lossy()
        .into_owned()
}

/// `Builder::new_remote_replica` creates the replica file *before* it reaches the
/// primary, so a connect that fails on its first attempt leaves an empty file
/// behind. That file used to make every later attempt take the "we have a replica
/// to fall back on" branch, which returned a perfectly successful-looking database
/// that had no schema and refused every write — the user saw "connected", then
/// couldn't save a word. An unprovisioned replica must surface the real failure.
// libsql's replica calls `block_in_place`, which requires the multi-thread flavor.
#[tokio::test(flavor = "multi_thread")]
async fn empty_replica_is_not_served_as_an_offline_fallback() {
    let path = temp_path("empty-replica");
    std::fs::write(&path, b"").expect("leave an empty replica file behind");

    // Nothing is listening here, so `build()` fails the way an unreachable
    // primary does.
    let profile = DbProfile::Turso {
        path: path.clone(),
        url: "libsql://127.0.0.1:1".to_string(),
    };

    // `Db` isn't Debug, so match rather than `expect_err`.
    let error = match connection::open(&profile, Some("irrelevant-token")).await {
        Err(error) => error,
        Ok(_) => panic!("an empty replica must not stand in for the primary"),
    };
    assert!(
        error.contains("Failed to connect to Turso"),
        "expected the underlying connection failure, got: {error}"
    );

    let _ = std::fs::remove_file(&path);
}
