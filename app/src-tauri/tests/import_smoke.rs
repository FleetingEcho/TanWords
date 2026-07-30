//! Merging one TanWords database into another: what gets added, what counts as
//! a conflict, and what an "overwrite" is allowed to touch.

use std::collections::HashMap;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

use tanwords_lib::db::{connection, DbProfile, ImportDecisions};

fn temp_db(tag: &str) -> String {
    std::env::temp_dir()
        .join(format!("tanwords-import-{tag}-{}-{}.db", std::process::id(), uuid::Uuid::new_v4()))
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

/// A source database with one word (definition + review progress), one pattern,
/// one document, and a setting that must not travel.
async fn build_source(path: &str) {
    let db = open(path).await;
    let c = db.conn();
    c.execute(
        "INSERT INTO words (word, word_type, level, word_freq, source, user_notes, enrichment_text)
         VALUES ('blacksmith', 'n', 'C1', 1, 'manual', 'source notes', 'SOURCE ENRICHMENT')",
        (),
    )
    .await
    .unwrap();
    let id = c.last_insert_rowid();
    c.execute(
        "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'n', '铁匠', 0)",
        [id],
    )
    .await
    .unwrap();
    c.execute(
        "INSERT INTO srs_records (entity_id, entity_type, srs_level, srs_ease, next_review_at)
         VALUES (?1, 'word', 9, 2.9, '2099-01-01T00:00:00Z')",
        [id],
    )
    .await
    .unwrap();
    c.execute(
        "INSERT INTO words (word, word_freq, source) VALUES ('anvil', 1, 'manual')",
        (),
    )
    .await
    .unwrap();
    c.execute(
        "INSERT INTO patterns (pattern, zh, function_tag, note) VALUES ('be shortlisted for + noun', '入围', 'other', 'source note')",
        (),
    )
    .await
    .unwrap();
    c.execute(
        "INSERT INTO documents (title, content, content_text, tags, word_count) VALUES ('Notes', 'src', 'src', '[]', 3)",
        (),
    )
    .await
    .unwrap();
    c.execute("INSERT INTO user_known_words (word, source) VALUES ('forge', 'marked')", ())
        .await
        .unwrap();
    c.execute(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('mcp_token', '\"source-secret\"')",
        (),
    )
    .await
    .unwrap();
}

async fn app_with(path: &str) -> tauri::App<tauri::test::MockRuntime> {
    let database = open(path).await;
    let app = mock_builder().build(mock_context(noop_assets())).expect("build");
    app.manage(tanwords_lib::AppState {
        db: std::sync::Mutex::new(database),
        tts: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
        document_privacy: Default::default(),
    });
    app
}

async fn scalar(state: &tauri::State<'_, tanwords_lib::AppState>, sql: &str) -> i64 {
    let conn = tanwords_lib::db::conn(state).unwrap();
    tanwords_lib::db::scalar_i64(&conn, sql, ()).await.unwrap()
}

async fn text(state: &tauri::State<'_, tanwords_lib::AppState>, sql: &str) -> Option<String> {
    let conn = tanwords_lib::db::conn(state).unwrap();
    tanwords_lib::db::fetch_optional(&conn, sql, (), |r| r.get(0)).await.unwrap()
}

#[tokio::test]
async fn importing_into_an_empty_database_brings_everything_over() {
    let (src, dest) = (temp_db("src"), temp_db("dest"));
    build_source(&src).await;
    let app = app_with(&dest).await;
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    let plan = tanwords_lib::db::db_import_analyze(src.clone(), state.clone())
        .await
        .expect("analyze");
    let words = plan.groups.iter().find(|g| g.kind == "words").expect("words group");
    assert_eq!(words.new_count, 2, "both words are new");
    assert!(words.conflicts.is_empty(), "an empty target has no conflicts");

    let result = tanwords_lib::db::db_import_apply(src.clone(), ImportDecisions::default(), state.clone())
        .await
        .expect("apply");
    assert!(result.added >= 5, "words, pattern, document and known word all land");
    assert_eq!(result.overwritten, 0);

    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM words").await, 2);
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM word_definitions").await, 1);
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM patterns").await, 1);
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM documents").await, 1);
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM user_known_words").await, 1);

    // A brand-new word keeps the review scheduling it arrived with — that is
    // what makes a first import worth doing.
    assert_eq!(
        scalar(&state, "SELECT srs_level FROM srs_records WHERE entity_type='word' AND entity_id=(SELECT id FROM words WHERE word='blacksmith')").await,
        9
    );

    // Device-scoped settings must never travel between installs.
    let token = text(&state, "SELECT value FROM user_settings WHERE key='mcp_token'").await;
    assert!(
        token.is_none() || token.as_deref() != Some("\"source-secret\""),
        "the source's MCP token must not be imported, got {token:?}"
    );

    clean(&src);
    clean(&dest);
}

#[tokio::test]
async fn conflicts_are_reported_and_skipped_by_default() {
    let (src, dest) = (temp_db("src2"), temp_db("dest2"));
    build_source(&src).await;

    // The target already knows this word, with its own content and progress.
    {
        let db = open(&dest).await;
        let c = db.conn();
        c.execute(
            "INSERT INTO words (word, word_freq, source, user_notes, enrichment_text)
             VALUES ('blacksmith', 1, 'manual', 'target notes', 'TARGET ENRICHMENT')",
            (),
        )
        .await
        .unwrap();
        let id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'word', 3, 2.1)",
            [id],
        )
        .await
        .unwrap();
    }

    let app = app_with(&dest).await;
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    let plan = tanwords_lib::db::db_import_analyze(src.clone(), state.clone())
        .await
        .expect("analyze");
    let words = plan.groups.iter().find(|g| g.kind == "words").unwrap();
    assert_eq!(words.new_count, 1, "only 'anvil' is new");
    assert_eq!(words.conflicts.len(), 1);
    let conflict = &words.conflicts[0];
    assert_eq!(conflict.key, "blacksmith");
    assert!(conflict.incoming.contains("铁匠"), "incoming side shows the source gloss");
    assert!(!conflict.existing.is_empty(), "existing side is described too");

    // Default decisions overwrite nothing.
    tanwords_lib::db::db_import_apply(src.clone(), ImportDecisions::default(), state.clone())
        .await
        .expect("apply");

    assert_eq!(
        text(&state, "SELECT user_notes FROM words WHERE word='blacksmith'").await.as_deref(),
        Some("target notes"),
        "a skipped conflict leaves the target untouched"
    );
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM words").await, 2, "the new word still lands");

    clean(&src);
    clean(&dest);
}

#[tokio::test]
async fn overwriting_replaces_content_but_never_review_progress() {
    let (src, dest) = (temp_db("src3"), temp_db("dest3"));
    build_source(&src).await;
    {
        let db = open(&dest).await;
        let c = db.conn();
        c.execute(
            "INSERT INTO words (word, word_freq, source, user_notes, enrichment_text)
             VALUES ('blacksmith', 1, 'manual', 'target notes', 'TARGET ENRICHMENT')",
            (),
        )
        .await
        .unwrap();
        let id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'n', '旧释义', 0)",
            [id],
        )
        .await
        .unwrap();
        c.execute(
            "INSERT INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'word', 3, 2.1)",
            [id],
        )
        .await
        .unwrap();
    }

    let app = app_with(&dest).await;
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    let mut overwrite = HashMap::new();
    overwrite.insert("words".to_string(), vec!["blacksmith".to_string()]);
    let result = tanwords_lib::db::db_import_apply(
        src.clone(),
        ImportDecisions { overwrite, include_new: true },
        state.clone(),
    )
    .await
    .expect("apply");
    assert_eq!(result.overwritten, 1);

    assert_eq!(
        text(&state, "SELECT user_notes FROM words WHERE word='blacksmith'").await.as_deref(),
        Some("source notes"),
        "content is replaced"
    );
    assert_eq!(
        text(&state, "SELECT enrichment_text FROM words WHERE word='blacksmith'").await.as_deref(),
        Some("SOURCE ENRICHMENT")
    );
    // Definitions are replaced wholesale rather than appended.
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM word_definitions").await, 1);
    assert_eq!(
        text(&state, "SELECT zh FROM word_definitions LIMIT 1").await.as_deref(),
        Some("铁匠")
    );
    // The one thing an overwrite must not take: this device's review history.
    assert_eq!(
        scalar(&state, "SELECT srs_level FROM srs_records WHERE entity_type='word'").await,
        3,
        "review progress belongs to the device that earned it"
    );

    clean(&src);
    clean(&dest);
}

#[tokio::test]
async fn importing_the_same_file_twice_is_a_no_op() {
    let (src, dest) = (temp_db("src4"), temp_db("dest4"));
    build_source(&src).await;
    let app = app_with(&dest).await;
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    tanwords_lib::db::db_import_apply(src.clone(), ImportDecisions::default(), state.clone())
        .await
        .unwrap();
    let after_first = scalar(&state, "SELECT COUNT(*) FROM words").await;
    let defs_first = scalar(&state, "SELECT COUNT(*) FROM word_definitions").await;
    let examples_first = scalar(&state, "SELECT COUNT(*) FROM pattern_examples").await;

    let second = tanwords_lib::db::db_import_apply(src.clone(), ImportDecisions::default(), state.clone())
        .await
        .unwrap();
    assert_eq!(second.added, 0, "nothing new the second time");
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM words").await, after_first);
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM word_definitions").await, defs_first);
    assert_eq!(scalar(&state, "SELECT COUNT(*) FROM pattern_examples").await, examples_first);

    clean(&src);
    clean(&dest);
}

#[tokio::test]
async fn a_non_tanwords_file_is_rejected() {
    let stray = temp_db("stray");
    {
        let db = libsql::Builder::new_local(&stray).build().await.unwrap();
        db.connect()
            .unwrap()
            .execute("CREATE TABLE unrelated (id INTEGER)", ())
            .await
            .unwrap();
    }
    let dest = temp_db("dest5");
    let app = app_with(&dest).await;
    let state: tauri::State<tanwords_lib::AppState> = app.state();

    let err = tanwords_lib::db::db_import_analyze(stray.clone(), state)
        .await
        .expect_err("a stray SQLite file must be refused");
    assert!(err.contains("TanWords"), "error should say what's wrong, got: {err}");

    clean(&stray);
    clean(&dest);
}
