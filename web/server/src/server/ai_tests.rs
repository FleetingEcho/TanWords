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
async fn authed_app(name: &str) -> (axum::Router, String, std::path::PathBuf) {
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
    users
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
        users,
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
            public_host: None,
            postgres_host: "127.0.0.1".to_string(),
            postgres_port: 5432,
            postgres_superuser_password: None,
        }),
        http: reqwest::Client::new(),
        shutdown: tokio::sync::watch::channel(()).1,
    };
    (build_router(state), token, dir)
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
