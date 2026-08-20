use super::UsersDb;
use std::time::Duration;

async fn test_users(name: &str) -> (UsersDb, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("tanwords-{name}-{}", uuid::Uuid::new_v4()));
    let users = UsersDb::open(&dir.join("users.db"), [7; 32], 7 * 24 * 3600)
        .await
        .unwrap();
    (users, dir)
}

#[tokio::test]
async fn jwt_session_is_valid_and_revocable() {
    let (users, dir) = test_users("jwt-test").await;
    let user_id = users
        .register("reader@example.com", "correct-horse")
        .await
        .unwrap();
    let (_, token) = users
        .login("reader@example.com", "correct-horse")
        .await
        .unwrap()
        .unwrap();

    assert_eq!(token.split('.').count(), 3);
    assert_eq!(users.validate(&token).await.unwrap().unwrap().id, user_id);

    // Ordinary API requests must not queue behind unrelated credential
    // writes. Holding the writer proves validation uses its read connection.
    let conn = users.conn.lock().await;
    let concurrent = tokio::time::timeout(Duration::from_millis(100), users.validate(&token))
        .await
        .expect("session validation waited for the users.db writer")
        .unwrap()
        .unwrap();
    assert_eq!(concurrent.id, user_id);
    drop(conn);

    let (_, second_token) = users
        .login("reader@example.com", "correct-horse")
        .await
        .unwrap()
        .unwrap();
    assert_ne!(token, second_token);

    let mut tampered = token.clone();
    tampered.push('x');
    assert!(users.validate(&tampered).await.unwrap().is_none());

    users.logout(&token).await.unwrap();
    assert!(users.validate(&token).await.unwrap().is_none());
    assert!(users.validate(&second_token).await.unwrap().is_some());

    drop(users);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn web_app_lock_is_per_user_and_requires_current_password() {
    let (users, dir) = test_users("app-lock-test").await;
    let first = users
        .register("locked@example.com", "account-password")
        .await
        .unwrap();
    let second = users
        .register("other@example.com", "account-password")
        .await
        .unwrap();

    assert!(!users.app_lock_enabled(first).await.unwrap());
    users
        .set_app_lock(first, None, "screen-lock")
        .await
        .unwrap();
    assert!(users.app_lock_enabled(first).await.unwrap());
    assert!(!users.app_lock_enabled(second).await.unwrap());
    assert!(users.verify_app_lock(first, "screen-lock").await.unwrap());
    assert!(!users.verify_app_lock(first, "wrong").await.unwrap());

    assert!(users
        .set_app_lock(first, Some("wrong"), "replacement")
        .await
        .is_err());
    users
        .set_app_lock(first, Some("screen-lock"), "replacement")
        .await
        .unwrap();
    assert!(users.verify_app_lock(first, "replacement").await.unwrap());
    assert!(users.disable_app_lock(first, "wrong").await.is_err());
    users.disable_app_lock(first, "replacement").await.unwrap();
    assert!(!users.app_lock_enabled(first).await.unwrap());
    assert!(users.verify_app_lock(first, "anything").await.unwrap());

    drop(users);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn local_selection_preserves_postgres_credentials() {
    let (users, dir) = test_users("db-source-test").await;
    let user_id = users
        .register("switcher@example.com", "correct-horse")
        .await
        .unwrap();

    assert!(users.active_postgres_for(user_id).await.unwrap().is_none());
    users
        .set_postgres_remote(user_id, "tanwords_user_1", "tanwords_user_1", "secret")
        .await
        .unwrap();
    users.set_active_db(user_id, "postgres").await.unwrap();
    assert!(users.active_postgres_for(user_id).await.unwrap().is_some());

    users.set_active_db(user_id, "local").await.unwrap();
    assert!(users.active_postgres_for(user_id).await.unwrap().is_none());
    let remembered = users.postgres_remote_for(user_id).await.unwrap().unwrap();
    assert_eq!(remembered.role, "tanwords_user_1");
    assert_eq!(remembered.password, "secret");
    assert!(remembered.enabled);

    users.set_active_db(user_id, "postgres").await.unwrap();
    assert!(users.active_postgres_for(user_id).await.unwrap().is_some());
    users.set_postgres_enabled(user_id, false).await.unwrap();
    users.set_active_db(user_id, "local").await.unwrap();
    let remembered = users.postgres_remote_for(user_id).await.unwrap().unwrap();
    assert!(!remembered.enabled);

    drop(users);
    let _ = std::fs::remove_dir_all(dir);
}
