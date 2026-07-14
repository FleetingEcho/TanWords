use rusqlite::Connection;

#[test]
fn scene_lab_schema_is_created_and_repeatable() {
    let conn = Connection::open_in_memory().unwrap();
    tanwords_lib::db::init_db(&conn).expect("first init failed");
    tanwords_lib::db::init_db(&conn).expect("second init failed");
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
        let found: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(found, 1, "missing table {table}");
    }
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(version, 13);
}
