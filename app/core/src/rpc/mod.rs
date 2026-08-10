//! The HTTP surface that replaces Tauri IPC.
//!
//!   POST /invoke/:command   JSON args in, JSON result out
//!   GET  /events            SSE stream of `shim::AppHandle::emit` events
//!   GET  /asset?path=..     Range-capable file serving (replaces convertFileSrc)
//!
//! Everything is bound to 127.0.0.1 on an ephemeral port and gated on a bearer
//! token printed to stdout at startup, so nothing else on the machine can drive
//! the user's database.

pub mod dispatch {
    //! Generated at build time by `generate_dispatch_table()` in
    //! `build.rs` — see that function for the source of truth. Not a
    //! checked-in file; lives in `$OUT_DIR` and is regenerated on every
    //! `cargo build`/`cargo check`.
    include!(concat!(env!("OUT_DIR"), "/dispatch.rs"));
}

use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use crate::shim::{AppHandle, Registry, State};

/// Command arguments, already normalised to snake_case.
pub struct Args(Map<String, Value>);

impl Args {
    /// Builds from the raw request body.
    ///
    /// **The camelCase conversion here is load-bearing.** Tauri silently mapped
    /// JS `{ tabId }` onto Rust `tab_id`, and the frontend has ~98 call sites
    /// written against that. Without this pass roughly half the commands fail
    /// at runtime with a confusing "missing field" error. Only the top level is
    /// converted — nested objects are deserialized by serde against structs
    /// that already carry their own explicit `#[serde(rename_all = ..)]`.
    pub fn new(body: Value) -> Self {
        let map = match body {
            Value::Object(map) => map,
            Value::Null => Map::new(),
            other => {
                let mut m = Map::new();
                m.insert("value".into(), other);
                m
            }
        };
        Self(map.into_iter().map(|(k, v)| (to_snake_case(&k), v)).collect())
    }

    /// Removes and deserializes one argument. A missing key is passed to serde
    /// as `null` so that `Option<T>` parameters keep defaulting the way they
    /// did under Tauri.
    pub fn take<T: DeserializeOwned>(&mut self, name: &str) -> Result<T, String> {
        let value = self.0.remove(name).unwrap_or(Value::Null);
        serde_json::from_value(value).map_err(|e| e.to_string())
    }
}

fn to_snake_case(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 4);
    for (i, ch) in input.char_indices() {
        if ch.is_ascii_uppercase() {
            if i != 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Per-request context handed to every generated dispatch arm.
#[derive(Clone)]
pub struct Ctx {
    registry: Arc<Registry>,
    app: AppHandle,
}

impl Ctx {
    pub fn new(registry: Arc<Registry>, app: AppHandle) -> Self {
        Self { registry, app }
    }

    /// Replaces Tauri's `State` extractor.
    pub fn state<T: Send + Sync + 'static>(&self) -> State<'_, T> {
        self.registry
            .get::<T>()
            .map(State::from_ref)
            .expect("state not managed — add it to Registry::manage at startup")
    }

    /// Replaces the `AppHandle` parameter on commands that emit events.
    pub fn app(&self) -> AppHandle {
        self.app.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::{dispatch, to_snake_case, Args, Ctx};

    #[test]
    fn rss_pause_command_is_exposed_to_the_renderer() {
        assert!(dispatch::COMMAND_NAMES.contains(&"db_set_rss_feed_paused"));
    }

    #[test]
    fn split_document_save_commands_are_exposed_to_the_renderer() {
        assert!(dispatch::COMMAND_NAMES.contains(&"db_update_document_content"));
        assert!(dispatch::COMMAND_NAMES.contains(&"db_update_document_metadata"));
    }

    #[tokio::test]
    async fn content_and_metadata_updates_do_not_overwrite_each_other() {
        let database = crate::db::connection::open_memory().await.unwrap();
        let (registry, app) = crate::build_state_for(database, None).await;
        let ctx = Ctx::new(registry, app);
        let id = dispatch::dispatch(
            &ctx,
            "db_create_document_with_content",
            Args::new(serde_json::json!({
                "title": "Original",
                "content": "old-content",
                "contentText": "old text",
                "tags": "[]",
                "wordCount": 2,
                "folder": null
            })),
        )
        .await
        .unwrap()
        .as_i64()
        .unwrap();

        dispatch::dispatch(
            &ctx,
            "db_update_document_metadata",
            Args::new(serde_json::json!({
                "id": id,
                "title": "Renamed",
                "tags": null,
                "pinned": null,
                "status": null
            })),
        )
        .await
        .unwrap();
        dispatch::dispatch(
            &ctx,
            "db_update_document_content",
            Args::new(serde_json::json!({
                "id": id,
                "content": "new-content",
                "contentText": "new text",
                "wordCount": 2
            })),
        )
        .await
        .unwrap();

        let document = dispatch::dispatch(
            &ctx,
            "db_get_document",
            Args::new(serde_json::json!({ "id": id })),
        )
        .await
        .unwrap();
        assert_eq!(document["title"], "Renamed");
        assert_eq!(document["content"], "new-content");
        assert_eq!(document["content_text"], "new text");
    }

    #[tokio::test]
    async fn lock_document_accepts_the_renderer_id_payload() {
        let database = crate::db::connection::open_memory().await.unwrap();
        let (registry, app) = crate::build_state_for(database, None).await;
        let ctx = Ctx::new(registry, app);

        let result = dispatch::dispatch(
            &ctx,
            "db_lock_document",
            Args::new(serde_json::json!({ "id": 42 })),
        )
        .await;

        assert!(result.is_ok(), "renderer payload was rejected: {result:?}");
    }

    #[tokio::test]
    async fn lock_document_makes_an_open_private_document_unreadable() {
        let database = crate::db::connection::open_memory().await.unwrap();
        let (registry, app) = crate::build_state_for(database, None).await;
        let ctx = Ctx::new(registry, app);
        let id = dispatch::dispatch(&ctx, "db_create_document", Args::new(serde_json::Value::Null))
            .await
            .unwrap()
            .as_i64()
            .unwrap();
        dispatch::dispatch(
            &ctx,
            "db_protect_document",
            Args::new(serde_json::json!({ "id": id, "password": "test-password" })),
        )
        .await
        .unwrap();

        dispatch::dispatch(
            &ctx,
            "db_lock_document",
            Args::new(serde_json::json!({ "id": id })),
        )
        .await
        .unwrap();
        let reopened = dispatch::dispatch(
            &ctx,
            "db_get_document",
            Args::new(serde_json::json!({ "id": id })),
        )
        .await;

        assert_eq!(reopened.unwrap_err(), "DOCUMENT_LOCKED");

        dispatch::dispatch(
            &ctx,
            "db_unlock_document",
            Args::new(serde_json::json!({ "id": id, "password": "test-password" })),
        )
        .await
        .unwrap();
        let unlocked = dispatch::dispatch(
            &ctx,
            "db_get_document",
            Args::new(serde_json::json!({ "id": id })),
        )
        .await;
        assert!(unlocked.is_ok());
    }

    #[test]
    fn converts_the_argument_names_the_frontend_actually_sends() {
        assert_eq!(to_snake_case("tabId"), "tab_id");
        assert_eq!(to_snake_case("speakerId"), "speaker_id");
        assert_eq!(to_snake_case("documentId"), "document_id");
        assert_eq!(to_snake_case("url"), "url");
        assert_eq!(to_snake_case("dirname"), "dirname");
        // Already snake_case keys must survive untouched.
        assert_eq!(to_snake_case("rel_path"), "rel_path");
    }
}
