use rmcp::handler::server::wrapper::Parameters;
use rusqlite::Connection;
use serde_json::Value;

use super::config::{load_config, mcp_generate_token, save_config, McpConfig};
use super::controller::McpController;
use super::tools::TanWordsMcp;
use super::types::{
    AddVocabulary, AppendDocument, CreateDocument, GetDocument, SearchVocabulary,
};

fn test_database() -> String {
    let path = std::env::temp_dir().join(format!("tanwords-mcp-{}.db", mcp_generate_token()));
    let conn = Connection::open(&path).unwrap();
    crate::db::init_db(&conn).unwrap();
    path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn vocabulary_and_document_tools_round_trip() {
    let path = test_database();
    let server = TanWordsMcp::new(path.clone());

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
    let path = test_database();
    let probe = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let controller = McpController::default();
    let config = McpConfig { enabled: true, port, token: mcp_generate_token() };

    assert!(controller.restart(config.clone(), path.clone()).await.unwrap().running);
    assert!(controller.restart(config, path.clone()).await.unwrap().running);
    controller.stop().await;
    assert!(!controller.status().running);

    let _ = std::fs::remove_file(path);
}

#[test]
fn config_round_trip_and_token_strength() {
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_db(&conn).unwrap();
    let config = McpConfig {
        enabled: true,
        port: 49152,
        token: mcp_generate_token(),
    };
    assert!(config.token.len() >= 40);
    save_config(&conn, &config).unwrap();
    let loaded = load_config(&conn);
    assert!(loaded.enabled);
    assert_eq!(loaded.port, 49152);
    assert_eq!(loaded.token, config.token);
}
