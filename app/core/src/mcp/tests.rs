use std::sync::Arc;

use rmcp::handler::server::wrapper::Parameters;
use serde_json::Value;

use super::config::{load_config, mcp_generate_token, save_config, McpConfig};
use super::controller::McpController;
use super::tools::TanWordsMcp;
use super::types::{
    AddArticle, AddArticleComment, AddSentence, AddVocabulary, AppendDocument, CreateDocument, GetDocument, SearchDocuments,
    ListArticles, ListDocuments, ListKnownWords, ListSentences, SearchSentences, SearchVocabulary, UpdateVocabulary,
};

/// Change notifications and the DB handle both go through callbacks, so tests
/// need no Tauri runtime and no managed state.
fn test_server(database: Arc<crate::db::connection::Db>) -> TanWordsMcp {
    let provider: super::tools::ConnProvider = {
        let database = database.clone();
        Arc::new(move || Ok(database.conn()))
    };
    TanWordsMcp::new(provider, Arc::new(|_| {}))
}

/// A throwaway on-disk database. On disk rather than in memory because the
/// server resolves a fresh connection per call, and every connection has to
/// see the same data.
async fn test_database() -> (Arc<crate::db::connection::Db>, String) {
    let path = std::env::temp_dir()
        .join(format!("tanwords-mcp-{}.db", mcp_generate_token()))
        .to_string_lossy()
        .into_owned();
    let database = crate::db::connection::open(
        &crate::db::DbProfile::Local { path: path.clone() },
        None,
    )
    .await
    .unwrap();
    (Arc::new(database), path)
}

#[tokio::test]
async fn vocabulary_and_document_tools_round_trip() {
    let (database, path) = test_database().await;
    let server = test_server(database);

    let added = server
        .vocabulary_add(Parameters(AddVocabulary {
            word: "Serendipity".into(),
            zh: "意外发现美好事物的运气".into(),
            word_type: Some("noun".into()),
            level: Some("C1".into()),
            context: Some("A happy accident.".into()),
        }))
        .await;
    assert!(added.contains("serendipity"));

    let found = server
        .vocabulary_search(Parameters(SearchVocabulary {
            query: "意外发现".into(),
            limit: 20,
        }))
        .await;
    assert!(found.contains("serendipity"));

    let created = server
        .documents_create(Parameters(CreateDocument {
            title: "Same title".into(),
            content: "# First note\nUseful phrase".into(),
            tags: vec!["mcp".into()],
        }))
        .await;
    let id = serde_json::from_str::<Value>(&created).unwrap()["id"]
        .as_i64()
        .unwrap();
    let duplicate = server
        .documents_create(Parameters(CreateDocument {
            title: "Same title".into(),
            content: "Second note".into(),
            tags: vec![],
        }))
        .await;
    assert_ne!(
        id,
        serde_json::from_str::<Value>(&duplicate).unwrap()["id"]
            .as_i64()
            .unwrap()
    );

    let appended = server
        .documents_append(Parameters(AppendDocument {
            id,
            content: "More context".into(),
        }))
        .await;
    assert!(appended.contains("updated"));
    let document = server.documents_get(Parameters(GetDocument { id })).await;
    assert!(document.contains("More context"));

    drop(server);
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn server_can_restart_on_the_same_custom_port() {
    let (database, path) = test_database().await;
    let provider: super::tools::ConnProvider = Arc::new(move || Ok(database.conn()));
    let probe = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let controller = McpController::default();
    let config = McpConfig { enabled: true, port, token: mcp_generate_token() };

    let (events, _rx) = tokio::sync::broadcast::channel(16);
    let handle = crate::shim::AppHandle::new(Arc::new(crate::shim::Registry::default()), events);
    assert!(controller.restart(config.clone(), provider.clone(), handle.clone()).await.unwrap().running);
    assert!(controller.restart(config, provider, handle).await.unwrap().running);
    controller.stop().await;
    assert!(!controller.status().running);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn config_round_trip_and_token_strength() {
    let database = crate::db::connection::open_memory().await.unwrap();
    let conn = database.conn();
    let config = McpConfig {
        enabled: true,
        port: 49152,
        token: mcp_generate_token(),
    };
    assert!(config.token.len() >= 40);
    save_config(&conn, &config).await.unwrap();
    let loaded = load_config(&conn).await;
    assert!(loaded.enabled);
    assert_eq!(loaded.port, 49152);
    assert_eq!(loaded.token, config.token);
}

#[tokio::test]
async fn document_search_ranks_by_relevance_instead_of_matching_everything() {
    let (database, path) = test_database().await;
    let server = test_server(database);

    server.documents_create(Parameters(CreateDocument {
        title: "Rate limiting the API".into(),
        content: "Token buckets and leaky buckets for API traffic.".into(),
        tags: vec![],
    })).await;
    server.documents_create(Parameters(CreateDocument {
        title: "Apricot jam".into(),
        // Contains a, p, i in order — the old character-interleaved LIKE
        // matched this for the query "api"; full-text search must not.
        content: "A recipe with apricots, pectin and simmering.".into(),
        tags: vec![],
    })).await;

    let found = server.documents_search(Parameters(SearchDocuments {
        query: "api".into(),
        tag: None,
        limit: 20,
    })).await;
    assert!(found.contains("Rate limiting the API"));
    assert!(!found.contains("Apricot jam"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn vocabulary_can_be_corrected_and_removed() {
    let (database, path) = test_database().await;
    let server = test_server(database);

    let added = server.vocabulary_add(Parameters(AddVocabulary {
        word: "hedge".into(),
        zh: "树篱".into(),
        word_type: None,
        level: None,
        context: None,
    })).await;
    let id = serde_json::from_str::<Value>(&added).unwrap()["items"][0]["id"].as_i64().unwrap();

    server.vocabulary_update(Parameters(UpdateVocabulary {
        id,
        zh: Some("对冲，规避风险".into()),
        word_type: Some("v".into()),
        level: Some("C1".into()),
        notes: None,
    })).await;
    let found = server.vocabulary_search(Parameters(SearchVocabulary { query: "对冲".into(), limit: 20 })).await;
    assert!(found.contains("hedge"));

    let deleted = server.vocabulary_delete(Parameters(super::types::GetVocabulary { id })).await;
    assert!(deleted.contains("deleted"));
    let gone = server.vocabulary_search(Parameters(SearchVocabulary { query: "hedge".into(), limit: 20 })).await;
    assert!(!gone.contains("hedge"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn sentences_deduplicate_on_save() {
    let (database, path) = test_database().await;
    let server = test_server(database);

    let first = server.sentences_add(Parameters(AddSentence {
        sentence: "She was shortlisted for the role.".into(),
        zh: "入围……".into(),
        note: "求职、评奖场景".into(),
        level: Some("C1".into()),
    })).await;
    assert!(first.contains("\"created\": true"));

    let again = server.sentences_add(Parameters(AddSentence {
        sentence: "She was shortlisted for the role.".into(),
        zh: "入围……".into(),
        note: "".into(),
        level: None,
    })).await;
    assert!(again.contains("\"created\": false"));

    let found = server.sentences_search(Parameters(SearchSentences { query: "shortlisted".into(), limit: 20 })).await;
    assert!(found.contains("She was shortlisted"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn articles_are_deduplicated_searchable_and_annotatable() {
    let (database, path) = test_database().await;
    let server = test_server(database);

    let added = server.articles_add(Parameters(AddArticle {
        title: "How PostgreSQL plans a query".into(),
        content: "The planner weighs sequential scans against index scans using the cost model.".into(),
        source_url: Some("https://example.com/pg".into()),
        tags: vec!["postgres".into()],
    })).await;
    let id = serde_json::from_str::<Value>(&added).unwrap()["id"].as_i64().unwrap();
    assert!(added.contains("\"created\": true"));

    // An agent handed the same article twice must not fill the library with
    // copies — it re-reads the existing entry instead.
    let again = server.articles_add(Parameters(AddArticle {
        title: "How PostgreSQL plans a query".into(),
        content: "The planner weighs sequential scans against index scans using the cost model.".into(),
        source_url: None,
        tags: vec![],
    })).await;
    assert!(again.contains("\"created\": false"));
    assert_eq!(serde_json::from_str::<Value>(&again).unwrap()["id"].as_i64().unwrap(), id);

    server.articles_comment(Parameters(AddArticleComment {
        article_id: id,
        body: "值得记的是 cost model 这个说法".into(),
        anchor_text: Some("The planner weighs sequential scans against index scans using the cost model.".into()),
    })).await;

    let listed = server.articles_list(Parameters(ListArticles { query: Some("planner".into()), limit: 20 })).await;
    assert!(listed.contains("How PostgreSQL plans a query"));
    assert!(listed.contains("\"commentCount\": 1"));

    let fetched = server.articles_get(Parameters(super::types::GetArticle { id, with_comments: true })).await;
    assert!(fetched.contains("cost model 这个说法"));
    assert!(fetched.contains("anchorText"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn list_tools_and_known_words_are_available() {
    let (database, path) = test_database().await;
    database
        .conn()
        .execute(
            "INSERT INTO user_known_words(word, source) VALUES ('serendipity', 'test')",
            (),
        )
        .await
        .unwrap();
    let server = test_server(database);

    let known = server
        .vocabulary_known_words(Parameters(ListKnownWords {
            query: Some("serend".into()),
            limit: 10,
        }))
        .await;
    assert!(known.contains("serendipity"));

    let docs = server
        .documents_list(Parameters(ListDocuments {
            query: None,
            tag: None,
            limit: 10,
            offset: 0,
        }))
        .await;
    assert!(docs.contains("\"items\""));

    let sentences = server
        .sentences_list(Parameters(ListSentences {
            query: None,
            limit: 10,
            offset: 0,
        }))
        .await;
    assert!(sentences.contains("\"items\""));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn resources_and_prompts_are_available() {
    let (database, path) = test_database().await;
    let server = test_server(database);

    assert_eq!(TanWordsMcp::resource_definitions().len(), 1);
    assert!(TanWordsMcp::resource_template_definitions().len() >= 4);
    assert!(TanWordsMcp::prompt_definitions().len() >= 4);

    let stats = server.read_resource_value("tanwords://stats").await.unwrap();
    assert_eq!(stats.contents.len(), 1);

    let mut args = serde_json::Map::new();
    args.insert("text".into(), serde_json::json!("Hello world"));
    let messages = server.prompt_messages("extract-vocabulary", Some(args)).unwrap();
    assert_eq!(messages.len(), 1);
    let content = serde_json::to_string(&messages[0].content).unwrap();
    assert!(content.contains("Hello world"));

    drop(server);
    let _ = std::fs::remove_file(path);
}
