//! TanWords web backend.
//!
//! One binary: per-user core command API (`/invoke/*`, the same dispatch
//! table the desktop sidecar uses) backed by per-user runtime pool, email +
//! password auth against its own `users.db`, invite-key-gated registration,
//! SSE events, document-asset and import/export routes, an AI-provider proxy,
//! and the built SPA.

mod auth;
mod config;
mod embedded;
mod runtime;
mod server;
mod users;

use std::process::exit;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let config = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[tanwords-web] {e}");
            exit(1);
        }
    };
    // Hand the data dir to the core (database, app_config.json, secret files)
    // before anything in tanwords_lib touches the filesystem.
    config.apply_to_env();

    if config.invite_key.is_none() {
        eprintln!(
            "[tanwords-web] note: TANWORDS_INVITE_KEY is not set — registration and password \
             reset are closed. Set it when you want to invite someone."
        );
    }

    let users_db_path = config.data_dir.join("users.db");
    let users = match users::UsersDb::open(&users_db_path, config.master_key).await {
        Ok(u) => Arc::new(u),
        Err(e) => {
            eprintln!("[tanwords-web] {e}");
            exit(1);
        }
    };
    let pool = Arc::new(runtime::RuntimePool::new(users.clone(), config.data_dir.clone()));

    if let Err(e) = server::serve(config, users, pool).await {
        eprintln!("[tanwords-web] server error: {e}");
        exit(1);
    }
}
