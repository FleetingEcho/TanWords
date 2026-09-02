use std::sync::{Arc, Mutex};

use db::connection::{Db, DbDescriptor, DbProfile};

pub mod appconfig;
pub mod adblock;
pub mod db;
pub mod document_privacy;
#[cfg(any(feature = "tts", feature = "asr"))]
pub mod model_download;
#[cfg(feature = "tts")]
pub mod tts;
/// Remote (OpenAI-compatible HTTP) TTS — no sherpa/ONNX dependency, so it is
/// compiled regardless of the local-engine feature.
pub mod tts_remote;
/// ntfy push reminders for calendar events — pure HTTP, no feature gate.
pub mod ntfy;
#[cfg(feature = "asr")]
pub mod asr;
pub mod reader;
pub mod secrets;
pub mod r2;
pub mod app_lock;
pub mod http_util;
pub mod rss;
pub mod hn;
#[cfg(feature = "audio")]
pub mod music;
#[cfg(feature = "audio")]
pub mod native_audio;
pub mod localdocs;
pub mod mcp;
pub mod rpc;
pub mod shim;
// The desktop sidecar's own axum surface (loopback, per-process token,
// stdout handshake, `/asset?path=` file serving). The web/server crate builds
// its own router instead, so this module only exists in desktop builds.
#[cfg(feature = "desktop")]
pub mod server;

pub struct AppState {
    /// Swapped wholesale by `db_switch_path` / `db_connect_postgres`, so a
    /// different database (or a different *kind* of database) never requires a
    /// restart. A `std::sync::Mutex` rather than an async one on purpose: it is
    /// only ever held long enough to clone the inner `libsql::Conn` out,
    /// never across an `.await` — see `db::conn`.
    pub db: Mutex<Db>,
    /// The active TTS engine, if one has been loaded. Loaded lazily — never
    /// populated at startup — and hot-swapped in place when the user picks a
    /// different model.
    /// `Arc`-wrapped so `tts_synthesize` can clone a `'static` handle into
    /// `spawn_blocking`, keeping the CPU-bound ONNX inference off the tokio
    /// worker threads that also service other IPC commands.
    #[cfg(feature = "tts")]
    pub tts: Arc<Mutex<Option<tts::LoadedEngine>>>,
    /// The active ASR (speech-to-text) engine, if one has been loaded. Same
    /// lazy-load / hot-swap shape as `tts` above.
    #[cfg(feature = "asr")]
    pub asr: Arc<Mutex<Option<asr::LoadedAsrEngine>>>,
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
    /// released, closing its connection pool.
    pub fn replace_db(&self, next: Db) -> Result<(), String> {
        *self.db.lock().map_err(|e| e.to_string())? = next;
        self.document_privacy.clear()?;
        Ok(())
    }
}

/// Everything `run()` does except serving HTTP: opens the startup database,
/// then delegates to `build_state_for`. Desktop entry point.
pub async fn build_state() -> (Arc<shim::Registry>, shim::AppHandle) {
    let (database, db_fallback_warning) =
        open_startup_db().await.expect("Failed to open database");
    build_state_for(database, db_fallback_warning).await
}

/// Builds the managed-state registry and app handle around an already-open
/// database. On desktop, persisted MCP state is restored in a background task
/// so its three settings queries never delay the sidecar handshake. The web backend
/// (`web/server`) calls this once per active user — each user gets their own
/// registry around their own DB (per-user local file or Postgres), so
/// the ~15k lines of command code keep reading one `State<AppState>` while
/// sessions stay fully isolated, including the events broadcast channel.
pub async fn build_state_for(
    database: Db,
    db_fallback_warning: Option<String>,
) -> (Arc<shim::Registry>, shim::AppHandle) {
    let mcp_controller = mcp::McpController::default();
    let mut registry = shim::Registry::default();
    registry.manage(AppState {
        db: Mutex::new(database),
        #[cfg(feature = "tts")]
        tts: Arc::new(Mutex::new(None)),
        #[cfg(feature = "asr")]
        asr: Arc::new(Mutex::new(None)),
        db_fallback_warning,
        document_privacy: document_privacy::DocumentPrivacyState::default(),
    });
    registry.manage(mcp_controller);
    #[cfg(feature = "audio")]
    registry.manage(native_audio::NativeAudioState::default());
    let registry = Arc::new(registry);

    let (events_tx, _events_rx) = tokio::sync::broadcast::channel(256);
    let app_handle = shim::AppHandle::new(registry.clone(), events_tx);

    // MCP is desktop/localhost-only. Restore it after yielding back to run(),
    // which can then enter server::serve and publish the Electron handshake
    // without waiting for three user_settings queries. The task still owns the
    // same AppHandle-backed connection provider, so later DB switches work as
    // before. Web builds must never start a per-user localhost server inside the
    // shared host process.
    #[cfg(not(feature = "web"))]
    {
        let handle = app_handle.clone();
        tokio::task::spawn(async move {
            tokio::task::yield_now().await;
            let state = handle.state::<AppState>();
            let Ok(conn) = db::conn(&state) else { return };
            let config = mcp::load_config(&conn).await;
            if !config.enabled {
                return;
            }
            let controller = handle.state::<mcp::McpController>().inner().clone();
            let provider = mcp::state_conn_provider(handle.clone());
            let _ = controller.restart(config, provider, handle).await;
        });
    }

    (registry, app_handle)
}

/// Starts the sidecar: opens the database, builds the managed-state
/// registry, binds an ephemeral localhost port, prints the
/// `{"port":..,"token":".."}` handshake line Electron's supervisor parses,
/// then serves until the process exits.
#[cfg(feature = "desktop")]
pub async fn run() {
    let started = std::time::Instant::now();
    let (database, db_fallback_warning) =
        open_startup_db().await.expect("Failed to open database");
    eprintln!("[startup] database-ready +{}ms", started.elapsed().as_millis());
    let (registry, app_handle) = build_state_for(database, db_fallback_warning).await;
    eprintln!("[startup] registry-ready +{}ms", started.elapsed().as_millis());
    server::serve(registry, app_handle).await;
}

/// Opens a web user's startup profile in one call: their self-provisioned
/// Postgres database when the server has a connection URL on file (the web
/// server builds it per-user from `postgres_remote_for`, never from a
/// client-supplied value), otherwise a per-user local file.
pub async fn open_user_db(
    user_dir: &std::path::Path,
    postgres_url: Option<String>,
) -> Result<Db, String> {
    std::fs::create_dir_all(user_dir).map_err(|e| e.to_string())?;
    let profile = match postgres_url {
        Some(url) => DbProfile::Postgres { url },
        None => DbProfile::Local {
            path: user_dir.join("tanwords.db").to_string_lossy().to_string(),
        },
    };
    db::connection::open(&profile, None).await
}

/// The on-disk root for everything process-owned: the database, the app
/// config, secret files. `TANWORDS_DATA_DIR` overrides the
/// platform default — set by the web server (headless boxes, containers);
/// the desktop app never sets it and gets the platform data dir as before.
pub fn app_data_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("TANWORDS_DATA_DIR") {
        if !dir.trim().is_empty() {
            let dir = std::path::PathBuf::from(dir);
            std::fs::create_dir_all(&dir).ok();
            return dir;
        }
    }
    let dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("tanwords");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Root for the TTS/ASR downloaded-model caches. Deliberately *not*
/// `app_data_dir()`: desktop already has real users with models downloaded
/// under `dirs::cache_dir()`, and switching them to the data dir would orphan
/// those downloads (the two differ, e.g. `~/Library/Caches` vs
/// `~/Library/Application Support` on macOS). `TANWORDS_DATA_DIR` still wins
/// when set — that's the web server's persistent `/data` volume, shared by
/// every user of that deployment (one download serves everyone, rather than
/// each account fetching its own multi-hundred-MB copy) — desktop never sets
/// it, so its behavior here is unchanged.
pub fn shared_models_root() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("TANWORDS_DATA_DIR") {
        if !dir.trim().is_empty() {
            let dir = std::path::PathBuf::from(dir);
            std::fs::create_dir_all(&dir).ok();
            return dir;
        }
    }
    dirs::cache_dir().unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// Whether this build of the core links the local sherpa-onnx TTS/ASR
/// engines. `web/server` calls this to report the voice assistant's
/// availability in its bootstrap response — `cfg!(feature = "tts")` checked
/// from that crate would test *its own* (undeclared) features, not this
/// dependency's, and would silently always read false.
pub fn has_voice_assistant() -> bool {
    cfg!(all(feature = "tts", feature = "asr"))
}

pub fn default_db_path() -> String {
    app_data_dir()
        .join("tanwords.db")
        .to_string_lossy()
        .to_string()
}

/// Opens the saved connection profile, self-healing to the default local file
/// if it can't be opened — e.g. the file lives on a drive that isn't mounted,
/// or a Postgres endpoint is unreachable / its credentials were rotated.
/// Returns the failure alongside the fallback so the user gets a warning
/// instead of a fresh, seemingly-empty database.
async fn open_startup_db() -> Result<(Db, Option<String>), String> {
    let default_profile = DbProfile::Local { path: default_db_path() };

    let Some(saved) = appconfig::load_db_profile() else {
        return Ok((db::connection::open(&default_profile, None).await?, None));
    };

    match db::connection::open(&saved, None).await {
        Ok(database) => Ok((database, None)),
        Err(error) => {
            let description = describe_profile(&saved);
            eprintln!("[tanwords] saved db profile {description} failed to open ({error}), falling back to default");
            // A local file that won't open won't start working on its own, so
            // forget it rather than failing the same way every launch. A
            // Postgres endpoint usually fails for a reason that *does*
            // resolve itself (offline, VPN, laptop lid just opened), so the
            // profile is kept and simply retried next launch.
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
        DbProfile::Postgres { url } => format!("Postgres {url}"),
    }
}
