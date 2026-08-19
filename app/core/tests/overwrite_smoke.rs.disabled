//! Full-overwrite import: the active database's tables are wiped and
//! replaced with another TanWords database file's contents, verbatim.

use tanwords_lib::db::connection;
use tanwords_lib::db::DbProfile;

fn temp_db(tag: &str) -> String {
    std::env::temp_dir()
        .join(format!("tanwords-overwrite-{tag}-{}-{}.db", std::process::id(), uuid::Uuid::new_v4()))
        .to_string_lossy()
        .into_owned()
}

fn clean(path: &str) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{path}{suffix}"));
    }
}

async fn open(path: &str) -> connection::Db {
    connection::open(&DbProfile::Local { path: path.to_string() }, None)
        .await
        .expect("open")
}

fn mock_handle() -> tanwords_lib::shim::AppHandle {
    let (tx, _rx) = tokio::sync::broadcast::channel(16);
    tanwords_lib::shim::AppHandle::new(std::sync::Arc::new(tanwords_lib::shim::Registry::default()), tx)
}

async fn app_with(path: &str) -> tanwords_lib::AppState {
    let database = open(path).await;
    tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
        document_privacy: Default::default(),
    }
}

async fn scalar(state: &tanwords_lib::shim::State<'_, tanwords_lib::AppState>, sql: &str) -> i64 {
    let conn = tanwords_lib::db::conn(state).unwrap();
    tanwords_lib::db::scalar_i64(&conn, sql, ()).await.unwrap()
}

async fn text(state: &tanwords_lib::shim::State<'_, tanwords_lib::AppState>, sql: &str) -> Option<String> {
    let conn = tanwords_lib::db::conn(state).unwrap();
    tanwords_lib::db::fetch_optional(&conn, sql, (), |r| r.get(0)).await.unwrap()
}

/// A source with a word, a setting (the thing regular import refuses to
/// carry), a document (whose FTS index must come back populated), and a
/// pattern + a dependent pattern_example (to exercise FK-ordered copying).
async fn build_source(path: &str) {
    let db = open(path).await;
    let c = db.conn();
    c.execute(
        "INSERT INTO words (word, word_type, level, word_freq, source) VALUES ('anvil', 'n', 'B2', 1, 'manual')",
        (),
    )
    .await
    .unwrap();
    c.execute(
        "INSERT INTO user_settings (key, value) VALUES ('user_avatar', 'source-avatar-bytes')",
        (),
    )
    .await
    .unwrap();
    c.execute(
        "INSERT INTO documents (title, content, content_text) VALUES ('Forge Notes', '{}', 'a blacksmith forges an anvil')",
        (),
    )
    .await
    .unwrap();
    c.execute(
        "INSERT INTO patterns (pattern, zh, function_tag, note) VALUES ('be shortlisted for + noun', '入围', 'other', '')",
        (),
    )
    .await
    .unwrap();
    let pattern_id = c.last_insert_rowid();
    c.execute(
        "INSERT INTO pattern_examples (pattern_id, sentence, source) VALUES (?1, 'She was shortlisted for the award.', 'manual')",
        [pattern_id],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn overwriting_replaces_target_entirely() {
    let (src, dest) = (temp_db("src"), temp_db("dest"));
    build_source(&src).await;

    // The target starts with its own, unrelated data that must not survive.
    {
        let db = open(&dest).await;
        let c = db.conn();
        c.execute(
            "INSERT INTO words (word, word_freq, source) VALUES ('leftover', 1, 'manual')",
            (),
        )
        .await
        .unwrap();
        c.execute(
            "INSERT INTO user_settings (key, value) VALUES ('user_avatar', 'target-avatar-bytes')",
            (),
        )
        .await
        .unwrap();
    }

    let app_state = app_with(&dest).await;
    let state = tanwords_lib::shim::State::from_ref(&app_state);

    let result = tanwords_lib::db::db_import_overwrite(mock_handle(), src.clone(), None, state.clone())
        .await
        .expect("overwrite");
    assert!(result.rows_copied >= 5, "words, setting, document, pattern, example all copied");
    assert!(result.tables.contains(&"words".to_string()));
    assert!(result.tables.contains(&"user_settings".to_string()));

    // Only the source's data is present now.
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM words").await, 1);
    assert_eq!(
        text(&state, "SELECT word FROM words").await.as_deref(),
        Some("anvil"),
        "the target's own word is gone, replaced by the source's"
    );
    assert_eq!(
        text(&state, "SELECT value FROM user_settings WHERE key='user_avatar'").await.as_deref(),
        Some("source-avatar-bytes"),
        "settings — deliberately excluded from the regular merge import — are overwritten too"
    );

    // FK-dependent rows (pattern_examples -> patterns) landed correctly.
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM patterns").await, 1);
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM pattern_examples").await, 1);
    assert_eq!(
        scalar(
            &state,
            "SELECT COUNT(*) FROM pattern_examples pe JOIN patterns p ON p.id = pe.pattern_id"
        )
        .await,
        1,
        "the copied example still points at the copied pattern"
    );

    // The FTS5 index was rebuilt from the copied documents table.
    assert_eq!(
        scalar(&state, "SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH 'blacksmith'").await,
        1,
        "full-text search over the copied document works"
    );

    clean(&src);
    clean(&dest);
}

#[tokio::test]
async fn overwriting_an_empty_target_works() {
    let (src, dest) = (temp_db("src2"), temp_db("dest2"));
    build_source(&src).await;

    let app_state = app_with(&dest).await;
    let state = tanwords_lib::shim::State::from_ref(&app_state);

    tanwords_lib::db::db_import_overwrite(mock_handle(), src.clone(), None, state.clone())
        .await
        .expect("overwrite");

    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM words").await, 1);
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM documents").await, 1);

    clean(&src);
    clean(&dest);
}
