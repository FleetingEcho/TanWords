use rusqlite::Connection;
use std::sync::Mutex;

pub mod appconfig;
pub mod db;
pub mod tts;
pub mod reader;
pub mod secrets;
pub mod rss;

pub struct AppState {
    pub db: Mutex<Connection>,
    /// Mutable at runtime — `db_switch_path` swaps both this and `db` together
    /// under their own locks so a pluggable DB file doesn't require a restart.
    pub db_path: Mutex<String>,
    /// The active TTS engine, if one has been loaded. Loaded lazily — never
    /// populated at startup — and hot-swapped in place when the user picks a
    /// different model.
    pub tts: Mutex<Option<tts::LoadedEngine>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = resolve_db_path();
    let conn = Connection::open(&db_path).expect("Failed to open database");
    db::init_db(&conn).expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            db: Mutex::new(conn),
            db_path: Mutex::new(db_path),
            tts: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            db::db_get_word_count,
            db::db_get_translation_count,
            db::db_get_review_count,
            db::db_get_words,
            db::db_get_word_detail,
            db::db_add_word,
            db::db_delete_word,
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
            db::db_get_documents,
            db::db_get_document,
            db::db_update_document,
            db::db_delete_document,
            db::db_duplicate_document,
            db::db_get_all_tags,
            db::db_list_chat_sessions,
            db::db_get_chat_session,
            db::db_upsert_chat_session,
            db::db_delete_chat_session,
            db::db_search_chat_sessions,
            db::db_save_article_analysis,
            db::db_get_articles,
            db::db_get_article,
            db::db_delete_article,
            db::db_update_item_status,
            db::db_add_known_words,
            db::db_get_known_words,
            db::db_dashboard_stats,
            db::db_get_db_path,
            db::db_export_backup,
            db::db_clear_translations,
            db::db_add_words_batch,
            db::db_get_due_cards,
            db::db_review_card,
            db::db_add_search_history,
            db::db_get_search_history,
            db::db_clear_search_history,
            db::db_switch_path,
            tts::models::tts_scan_models,
            tts::models::tts_default_models_dir,
            tts::engine::tts_load_model,
            tts::engine::tts_delete_model,
            tts::engine::tts_synthesize,
            tts::engine::tts_engine_status,
            tts::download::tts_download_model,
            reader::fetch_article,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            rss::fetch_rss,
            rss::db_add_rss_feed,
            rss::db_get_rss_feeds,
            rss::db_update_rss_feed_title,
            rss::db_delete_rss_feed,
            rss::db_sync_rss_feed,
            rss::db_get_rss_entries,
            rss::db_mark_rss_entry_read,
            rss::db_get_rss_unread_counts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_db_path() -> String {
    let app_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("tanwords");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir
        .join("tanwords.db")
        .to_string_lossy()
        .to_string()
}

/// Prefers a user-chosen DB path saved by a previous `db_switch_path` call;
/// falls back to (and self-heals to) the default location if that path no
/// longer opens — e.g. the file was on a drive that isn't mounted right now.
fn resolve_db_path() -> String {
    if let Some(custom_path) = appconfig::load_db_path_override() {
        if Connection::open(&custom_path).is_ok() {
            return custom_path;
        }
        eprintln!("[tanwords] saved db path '{custom_path}' failed to open, falling back to default");
        appconfig::clear_db_path_override();
    }
    get_db_path()
}
