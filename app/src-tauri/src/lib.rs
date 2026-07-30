use std::sync::{Arc, Mutex};
use tauri::Manager;

use db::connection::{Db, DbDescriptor, DbProfile};

pub mod appconfig;
pub mod db;
pub mod document_privacy;
pub mod tts;
pub mod reader;
pub mod secrets;
pub mod rss;
pub mod hn;
pub mod music;
pub mod native_audio;
pub mod localdocs;
pub mod mcp;
pub mod tray;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Opening the database is async now (an embedded replica does a first sync
    // before it is usable), but `run` is the sync entry point Tauri calls, so
    // startup blocks on it exactly where the old blocking open used to sit.
    let (database, db_fallback_warning) =
        tauri::async_runtime::block_on(open_startup_db()).expect("Failed to open database");
    let mcp_config = tauri::async_runtime::block_on(mcp::load_config(&database.conn()));
    let mcp_controller = mcp::McpController::default();
    let startup_mcp_controller = mcp_controller.clone();

    let builder = tauri::Builder::default();
    // Must be registered before every other plugin: a second launch forwards its
    // argv to the running instance and exits from inside this plugin's setup, so
    // anything registered earlier would already have run in the doomed process.
    // That matters here beyond mere tidiness — a second instance would open its
    // own SQLite connection to the same file, add a duplicate tray icon, and try
    // to bind the MCP server to an already-taken port.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // Clicking the launcher again should surface the app, and the window may
        // legitimately be hidden — closing it only hides to tray (see
        // on_window_event below), so `show` here is load-bearing, not just focus.
        tray::show_main_window(app);
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .setup(move |app| {
            if mcp_config.enabled {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let provider = mcp::state_conn_provider(handle.clone());
                    let _ = startup_mcp_controller
                        .restart(mcp_config, provider, handle)
                        .await;
                });
            }
            tray::build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // With a tray icon present, the red close button should hide the
            // window (menu-bar-app convention) instead of quitting — only the
            // tray's Quit item (or Cmd+Q) actually exits.
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let quitting = window
                    .app_handle()
                    .try_state::<tray::TrayState>()
                    .is_some_and(|s| s.quitting.load(std::sync::atomic::Ordering::SeqCst));
                if !quitting {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(AppState {
            db: Mutex::new(database),
            tts: Arc::new(Mutex::new(None)),
            db_fallback_warning,
            document_privacy: document_privacy::DocumentPrivacyState::default(),
        })
        .manage(mcp_controller)
        .manage(native_audio::NativeAudioState::default())
        .invoke_handler(tauri::generate_handler![
            db::db_get_word_count,
            db::db_get_translation_count,
            db::db_get_review_count,
            db::db_get_words,
            db::db_get_word_detail,
            db::db_add_word,
            db::db_delete_word,
            db::db_delete_words_batch,
            db::db_set_word_starred,
            db::db_get_setting,
            db::db_set_setting,
            db::db_save_translation,
            db::db_get_translations,
            db::db_get_quiz_words,
            db::db_save_quiz_result,
            db::db_add_word_enriched,
            db::db_get_word_extras,
            db::db_save_word_notes,
            db::db_save_word_chat,
            db::db_create_document,
            db::db_create_document_with_content,
            db::db_document_title_exists,
            db::db_get_documents,
            db::db_get_document,
            document_privacy::db_protect_document,
            document_privacy::db_private_password_status,
            document_privacy::db_unlock_document,
            document_privacy::db_lock_document,
            document_privacy::db_remove_document_protection,
            document_privacy::db_change_document_password,
            db::db_create_document_asset,
            db::db_get_document_asset,
            db::db_get_document_assets,
            db::db_list_document_assets,
            db::db_delete_document_asset,
            db::db_delete_orphan_document_assets,
            db::db_export_document_asset,
            db::db_export_document_assets_to_folder,
            db::db_export_document_assets_zip,
            db::db_get_document_link_context,
            db::db_prune_document_assets,
            db::db_update_document,
            db::db_delete_document,
            db::db_duplicate_document,
            db::db_get_all_tags,
            db::db_list_chat_sessions,
            db::db_get_chat_session,
            db::db_upsert_chat_session,
            db::db_delete_chat_session,
            db::db_set_chat_session_archived,
            db::db_set_chat_session_pinned,
            db::db_rename_chat_session,
            db::db_save_reading_article,
            db::db_list_reading_articles,
            db::db_get_reading_article,
            db::db_delete_reading_article,
            db::db_list_reading_comments,
            db::db_add_reading_comment,
            db::db_delete_reading_comment,
            db::db_search_chat_sessions,
            db::db_save_article_analysis,
            db::db_add_known_words,
            db::db_get_known_words,
            db::db_dashboard_stats,
            db::db_get_db_path,
            db::db_get_db_size,
            db::db_get_connection,
            db::db_connect_turso,
            db::db_disconnect_remote,
            db::db_sync_now,
            db::db_import_analyze,
            db::db_import_apply,
            db::db_export_backup,
            db::db_clear_translations,
            db::db_add_words_batch,
            db::db_get_due_cards,
            db::db_review_card,
            db::db_add_search_history,
            db::db_get_search_history,
            db::db_clear_search_history,
            db::db_switch_path,
            db::db_get_startup_warning,
            db::db_saved_profile_is_turso,
            db::db_forget_saved_profile,
            db::db_list_scenes,
            db::db_get_scene_lesson,
            db::db_save_scene_lesson,
            db::db_start_scene_session,
            db::db_finish_scene_session,
            db::db_save_scene_attempt,
            db::db_get_scene_progress,
            db::db_add_scene_words_to_vocabulary,
            db::db_save_sentence_pattern,
            db::db_list_patterns,
            db::db_delete_pattern,
            db::db_update_pattern_analysis,
            db::db_set_pattern_starred,
            tts::models::tts_scan_models,
            tts::models::tts_default_models_dir,
            tts::engine::tts_load_model,
            tts::engine::tts_delete_model,
            tts::engine::tts_synthesize,
            tts::engine::tts_engine_status,
            tts::download::tts_download_model,
            reader::fetch_article,
            hn::fetch_hn_comments,
            hn::fetch_hn_section,
            hn::search_hn,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            rss::fetch_rss,
            rss::db_add_rss_feed,
            rss::db_get_rss_feeds,
            rss::db_update_rss_feed_title,
            rss::db_update_rss_feed_preferences,
            rss::db_delete_rss_feed,
            rss::db_sync_rss_feed,
            rss::db_get_rss_entries,
            rss::db_mark_rss_entry_read,
            rss::db_get_rss_unread_counts,
            music::music_scan_library,
            native_audio::native_audio_probe_duration,
            native_audio::native_audio_load,
            native_audio::native_audio_play,
            native_audio::native_audio_pause,
            native_audio::native_audio_seek,
            native_audio::native_audio_set_speed,
            native_audio::native_audio_stop,
            native_audio::native_audio_snapshot,
            localdocs::localdocs_list,
            localdocs::localdocs_root_exists,
            localdocs::localdocs_store_asset,
            localdocs::localdocs_search,
            localdocs::localdocs_read,
            localdocs::localdocs_write,
            localdocs::localdocs_create,
            localdocs::localdocs_move,
            localdocs::localdocs_rename,
            localdocs::localdocs_delete,
            localdocs::localdocs_import,
            localdocs::localdocs_export,
            localdocs::markdown_read_files,
            localdocs::markdown_export_files,
            localdocs::markdown_export_bundles,
            mcp::mcp_get_config,
            mcp::mcp_apply_config,
            mcp::mcp_generate_token,
            tray::tray_update_now_playing,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Cmd+Q (and any other app-level exit request) should back off to
            // "hide to tray" too, same as the window's close button — only the
            // tray's Quit item sets `quitting` and is allowed through.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let quitting = app_handle
                    .try_state::<tray::TrayState>()
                    .is_some_and(|s| s.quitting.load(std::sync::atomic::Ordering::SeqCst));
                if !quitting {
                    api.prevent_exit();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }
        });
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
