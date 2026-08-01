use std::sync::{Arc, Mutex};

use db::connection::{Db, DbDescriptor, DbProfile};

pub mod appconfig;
pub mod db;
pub mod document_privacy;
pub mod tts;
pub mod reader;
pub mod secrets;
pub mod http_util;
pub mod rss;
pub mod hn;
pub mod music;
pub mod native_audio;
pub mod localdocs;
pub mod mcp;
pub mod rpc;
pub mod server;
pub mod shim;

pub struct AppState {
    /// Swapped wholesale by `db_switch_path` / `db_connect_turso`, so a
    /// different database (or a different *kind* of database) never requires a
    /// restart. A `std::sync::Mutex` rather than an async one on purpose: it is
    /// only ever held long enough to clone the inner `libsql::Connection` out,
    /// never across an `.await` — see `db::conn`.
    pub db: Mutex<Db>,
    /// The active TTS engine, if one has been loaded. Loaded lazily — never
    /// populated at startup — and hot-swapped in place when the user picks a
    /// different model.
    /// `Arc`-wrapped so `tts_synthesize` can clone a `'static` handle into
    /// `spawn_blocking`, keeping the CPU-bound ONNX inference off the tokio
    /// worker threads that also service other IPC commands.
    pub tts: Arc<Mutex<Option<tts::LoadedEngine>>>,
    /// Set once at startup if a previously-saved custom DB path (via
    /// `db_switch_path`) failed to open and the app silently fell back to
    /// the default location — surfaced once to the frontend so the user
    /// sees a warning instead of a mysteriously empty vocabulary.
    pub db_fallback_warning: Option<String>,
    pub document_privacy: document_privacy::DocumentPrivacyState,
}

impl AppState {
    pub fn descriptor(&self) -> Result<DbDescriptor, String> {
        Ok(self.db.lock().map_err(|e| e.to_string())?.descriptor())
    }

    pub fn db_path(&self) -> Result<String, String> {
        Ok(self.db.lock().map_err(|e| e.to_string())?.path().to_string())
    }

    /// Replaces the live database. The old `Db` is dropped once the lock is
    /// released, which is also what stops a replaced Turso profile's
    /// background sync.
    pub fn replace_db(&self, next: Db) -> Result<(), String> {
        *self.db.lock().map_err(|e| e.to_string())? = next;
        self.document_privacy.clear()?;
        Ok(())
    }
}

/// Starts the sidecar: opens the database, builds the managed-state
/// registry, binds an ephemeral localhost port, prints the
/// `{"port":..,"token":".."}` handshake line Electron's supervisor parses,
/// then serves until the process exits.
pub async fn run() {
    let (database, db_fallback_warning) =
        open_startup_db().await.expect("Failed to open database");
    let mcp_config = mcp::load_config(&database.conn()).await;
    let mcp_controller = mcp::McpController::default();
    let startup_mcp_controller = mcp_controller.clone();

    let mut registry = shim::Registry::default();
    registry
        .manage(AppState {
            db: Mutex::new(database),
            tts: Arc::new(Mutex::new(None)),
            db_fallback_warning,
            document_privacy: document_privacy::DocumentPrivacyState::default(),
        })
        .manage(mcp_controller)
        .manage(native_audio::NativeAudioState::default());
    let registry = Arc::new(registry);

    let (events_tx, _events_rx) = tokio::sync::broadcast::channel(256);
    let app_handle = shim::AppHandle::new(registry.clone(), events_tx);

    if mcp_config.enabled {
        let handle = app_handle.clone();
        tokio::task::spawn(async move {
            let provider = mcp::state_conn_provider(handle.clone());
            let _ = startup_mcp_controller.restart(mcp_config, provider, handle).await;
        });
    }

    server::serve(registry, app_handle).await;
}

pub fn default_db_path() -> String {
    let app_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("tanwords");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir
        .join("tanwords.db")
        .to_string_lossy()
        .to_string()
}

/// Where a Turso profile keeps its local replica. Derived rather than
/// configurable: it is a cache of the primary, not the user's own file, and
/// keeping it out of the default DB path avoids ever confusing the two.
pub fn replica_db_path() -> String {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("tanwords")
        .join("turso-replica.db")
        .to_string_lossy()
        .to_string()
}

/// Opens the saved connection profile, self-healing to the default local file
/// if it can't be opened — e.g. the file lives on a drive that isn't mounted,
/// or a Turso endpoint is unreachable / its token was revoked. Returns the
/// failure alongside the fallback so the user gets a warning instead of a
/// fresh, seemingly-empty database.
async fn open_startup_db() -> Result<(Db, Option<String>), String> {
    let default_profile = DbProfile::Local { path: default_db_path() };

    let Some(saved) = appconfig::load_db_profile() else {
        return Ok((db::connection::open(&default_profile, None).await?, None));
    };

    let token = match &saved {
        DbProfile::Turso { .. } => secrets::turso_token_get(),
        DbProfile::Local { .. } => None,
    };
    match db::connection::open(&saved, token.as_deref()).await {
        Ok(database) => Ok((database, None)),
        Err(error) => {
            let description = describe_profile(&saved);
            eprintln!("[tanwords] saved db profile {description} failed to open ({error}), falling back to default");
            // A local file that won't open won't start working on its own, so
            // forget it rather than failing the same way every launch. A Turso
            // endpoint usually fails for a reason that *does* resolve itself
            // (offline, VPN, laptop lid just opened), so the profile and its
            // token are kept and simply retried next launch — losing them to
            // one flaky moment would mean re-entering the token by hand.
            if saved.kind() == db::DbKind::Local {
                appconfig::clear_db_profile();
            }
            let database = db::connection::open(&default_profile, None).await?;
            Ok((database, Some(format!("{description}: {error}"))))
        }
    }
}

fn describe_profile(profile: &DbProfile) -> String {
    match profile {
        DbProfile::Local { path } => path.clone(),
        DbProfile::Turso { url, .. } => format!("Turso {url}"),
    }
}
