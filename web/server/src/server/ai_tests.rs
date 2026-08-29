//! Regression tests for the AI-provider proxy route (`server/ai.rs`).
//!
//! The settings page lists models with a GET `/api/ai-proxy/{id}/models`
//! (OpenAI-compatible convention), but the route used to be registered
//! POST-only, so axum answered 405 Method Not Allowed and "fetch available
//! models" always failed on the web app. These tests pin that both GET and
//! POST reach the handler through the session gate instead of being rejected
//! at the router, and that the gate itself still holds.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

use super::{build_router, WebState};
use crate::config::Config;
use crate::runtime::RuntimePool;
use crate::users::UsersDb;

/// A fully-wired router over a throwaway data dir, with one registered user
/// and their session token. Returns (app, token, dir).
async fn authed_app_with_users(
    name: &str,
) -> (axum::Router, String, Arc<UsersDb>, i64, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "tanwords-ai-proxy-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let users = Arc::new(
        UsersDb::open(&dir.join("users.db"), [7; 32], 7 * 24 * 3600)
            .await
            .unwrap(),
    );
    let user_id = users
        .register("proxy-test@example.com", "correct-horse")
        .await
        .unwrap();
    let (_, token) = users
        .login("proxy-test@example.com", "correct-horse")
        .await
        .unwrap()
        .unwrap();

    let pool = Arc::new(RuntimePool::new(
        users.clone(),
        dir.clone(),
        "127.0.0.1".to_string(),
        5432,
    ));
    let state = WebState {
        users: users.clone(),
        limiter: Arc::new(crate::auth::RateLimiter::new()),
        pool,
        config: Arc::new(Config {
            host: "127.0.0.1".to_string(),
            port: 0,
            data_dir: dir.clone(),
            web_dist: None,
            invite_key: None,
            admin_key: None,
            trust_proxy: false,
            master_key: [7; 32],
            jwt_ttl_secs: 7 * 24 * 3600,
            public_host: Some("db.example.com".to_string()),
            postgres_host: "127.0.0.1".to_string(),
            postgres_port: 5432,
            postgres_superuser_password: None,
        }),
        shutdown: tokio::sync::watch::channel(()).1,
    };
    // The re-auth routes extract ConnectInfo for rate limiting; under
    // `oneshot` there is no real socket, so feed them a mock address.
    let app = build_router(state).layer(axum::extract::connect_info::MockConnectInfo(
        std::net::SocketAddr::from(([127, 0, 0, 1], 50000)),
    ));
    (app, token, users, user_id, dir)
}

async fn authed_app(name: &str) -> (axum::Router, String, std::path::PathBuf) {
    let (app, token, _, _, dir) = authed_app_with_users(name).await;
    (app, token, dir)
}

async fn status(app: &axum::Router, method: &str, uri: &str, token: Option<&str>) -> StatusCode {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    // Drain the body so the connection/session isn't left half-read.
    let _ = body.collect().await.unwrap();
    parts.status
}

#[tokio::test]
async fn get_models_is_not_405() {
    let (app, token, dir) = authed_app("get-models").await;
    // With a session, GET must reach the handler. There is no provider row
    // for `custom` in the fresh db, so the handler answers 404 — the point is
    // that it answers at all instead of the router replying 405.
    let code = status(&app, "GET", "/api/ai-proxy/custom/models", Some(&token)).await;
    assert_eq!(
        code,
        StatusCode::NOT_FOUND,
        "GET /api/ai-proxy/custom/models must reach the handler, not 405"
    );
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn post_completions_still_routes() {
    let (app, token, dir) = authed_app("post-completions").await;
    // The chat path is a POST and must keep working after the route widened.
    let code = status(
        &app,
        "POST",
        "/api/ai-proxy/custom/chat/completions",
        Some(&token),
    )
    .await;
    assert_eq!(
        code,
        StatusCode::NOT_FOUND,
        "POST /api/ai-proxy/.../chat/completions must reach the handler, not 405"
    );
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn ai_proxy_still_requires_a_session() {
    let (app, _, dir) = authed_app("no-session").await;
    let code = status(&app, "GET", "/api/ai-proxy/custom/models", None).await;
    assert_eq!(code, StatusCode::UNAUTHORIZED);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn postgres_connection_string_requires_account_password_to_reveal() {
    let (app, token, users, user_id, dir) = authed_app_with_users("postgres-reveal").await;
    users
        .set_postgres_remote(
            user_id,
            "tanwords_user_1",
            "tanwords_user_1",
            "stored-postgres-secret",
        )
        .await
        .unwrap();

    let status_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/db/postgres/status")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status_body = status_response.into_body().collect().await.unwrap().to_bytes();
    assert!(
        !String::from_utf8_lossy(&status_body).contains("stored-postgres-secret"),
        "ordinary status reads must keep the credential masked"
    );

    let wrong = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/db/postgres/reveal")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"password":"wrong-password"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::FORBIDDEN);

    let reveal = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/db/postgres/reveal")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"password":"correct-horse"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reveal.status(), StatusCode::OK);
    let reveal_body = reveal.into_body().collect().await.unwrap().to_bytes();
    assert!(String::from_utf8_lossy(&reveal_body).contains("stored-postgres-secret"));

    let rotate_without_reauth = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/db/postgres/rotate")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"password":"wrong-password"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rotate_without_reauth.status(), StatusCode::FORBIDDEN);

    std::fs::remove_dir_all(dir).ok();
}
