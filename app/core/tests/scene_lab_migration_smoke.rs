#[tokio::test]
async fn scene_lab_schema_is_created_and_repeatable() {
    let database = tanwords_lib::db::connection::open_memory()
        .await
        .expect("first init failed");
    let conn = database.conn();
    // init_db is idempotent — opening applied it once; run it again directly.
    tanwords_lib::db::init_db(&conn).await.expect("second init failed");

    for table in [
        "scenes",
        "scene_objects",
        "scene_lessons",
        "scene_vocabulary",
        "scene_examples",
        "scene_relations",
        "scene_tasks",
        "scene_sessions",
        "scene_attempts",
        "knowledge_maps",
        "knowledge_nodes",
        "knowledge_edges",
    ] {
        let found = tanwords_lib::db::scalar_i64(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
        )
        .await
        .unwrap();
        assert_eq!(found, 1, "missing table {table}");
    }

    // Compared against the migration list rather than a literal, so adding a
    // migration doesn't silently leave this asserting an old version.
    let version = tanwords_lib::db::scalar_i64(
        &conn,
        "SELECT MAX(version) FROM schema_migrations",
        (),
    )
    .await
    .unwrap();
    assert_eq!(version, tanwords_lib::db::migrations::latest_version());
}
