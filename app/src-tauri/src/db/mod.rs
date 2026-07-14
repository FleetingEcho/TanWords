use rusqlite::{Connection, Result as SqlResult};
use std::sync::MutexGuard;
use tauri::State;

use crate::AppState;

// ── Helper ──────────────────────────────────────────────────────────────────

/// Lock the DB connection from Tauri State, returning a MutexGuard.
pub fn lock_db<'a>(state: &'a State<'a, AppState>) -> Result<MutexGuard<'a, Connection>, String> {
    state.db.lock().map_err(|e| e.to_string())
}

// ── Sub-modules ────────────────────────────────────────────────────────────

pub mod settings;
pub mod words_types;
pub mod words_query;
pub mod words_write;
pub mod translations;
pub mod quiz;
pub mod documents;
pub mod chat;
pub mod articles;
pub mod dashboard;
pub mod migrations;
pub mod srs;
pub mod search_history;
pub mod scene_lab;
pub mod knowledge_map;

pub use settings::*;
pub use words_types::*;
pub use words_query::*;
pub use words_write::*;
pub use translations::*;
pub use quiz::*;
pub use documents::*;
pub use chat::*;
pub use articles::*;
pub use dashboard::*;
pub use srs::*;
pub use search_history::*;
pub use scene_lab::*;
pub use knowledge_map::*;

// ── Database Initialization ─────────────────────────────────────────────────

pub fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(include_str!("../../sql/schema.sql"))?;

    // Migrations (idempotent)
    conn.execute("ALTER TABLE words ADD COLUMN enrichment_json TEXT", []).ok();
    conn.execute("ALTER TABLE words ADD COLUMN user_notes TEXT DEFAULT ''", []).ok();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS word_chats (
            word_id INTEGER PRIMARY KEY,
            messages TEXT NOT NULL DEFAULT '[]',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(word_id) REFERENCES words(id)
        );"
    ).ok();

    // Documents feature
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS documents (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT    NOT NULL DEFAULT 'Untitled',
            content      TEXT    NOT NULL DEFAULT '{}',
            content_text TEXT    NOT NULL DEFAULT '',
            tags         TEXT    NOT NULL DEFAULT '[]',
            pinned       INTEGER NOT NULL DEFAULT 0,
            word_count   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            title,
            content_text,
            content='documents',
            content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON documents BEGIN
            INSERT INTO documents_fts(rowid, title, content_text)
            VALUES (new.id, new.title, new.content_text);
        END;
        CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, content_text)
            VALUES ('delete', old.id, old.title, old.content_text);
        END;
        CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, content_text)
            VALUES ('delete', old.id, old.title, old.content_text);
            INSERT INTO documents_fts(rowid, title, content_text)
            VALUES (new.id, new.title, new.content_text);
        END;"
    ).ok();

    // AI Chat sessions
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_chat_sessions (
            id            TEXT PRIMARY KEY,
            title         TEXT    NOT NULL DEFAULT 'New Chat',
            messages      TEXT    NOT NULL DEFAULT '[]',
            system_prompt TEXT    NOT NULL DEFAULT '',
            preset_id     TEXT    NOT NULL DEFAULT 'english-tutor',
            provider_id   TEXT    NOT NULL DEFAULT '',
            message_count INTEGER NOT NULL DEFAULT 0,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated ON ai_chat_sessions(updated_at DESC);"
    ).ok();

    // Reading lessons: articles + extracted items + known words
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS articles (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT NOT NULL DEFAULT '',
            source_url TEXT NOT NULL DEFAULT '',
            origin     TEXT NOT NULL DEFAULT 'pasted',
            content    TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS extracted_items (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id       INTEGER NOT NULL,
            kind             TEXT NOT NULL DEFAULT 'word',
            text             TEXT NOT NULL,
            zh               TEXT NOT NULL DEFAULT '',
            note             TEXT NOT NULL DEFAULT '',
            level            TEXT NOT NULL DEFAULT '',
            context_sentence TEXT NOT NULL DEFAULT '',
            status           TEXT NOT NULL DEFAULT 'candidate',
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(article_id) REFERENCES articles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_extracted_article ON extracted_items(article_id);
        CREATE TABLE IF NOT EXISTS user_known_words (
            word       TEXT PRIMARY KEY,
            source     TEXT NOT NULL DEFAULT 'marked',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).ok();

    // Insert default settings
    let settings = vec![
        ("theme", r#""system""#),
        ("hotkey", r#""CmdOrCtrl+Shift+T""#),
        ("tts_voice", r#""en_US-lessac-high""#),
        ("default_source_lang", r#""auto""#),
        ("default_target_lang", r#""zh""#),
        ("default_ai_provider", r#""openai""#),
        ("quiz_reminder", r#""weekly""#),
        ("ui_language", r#""zh""#),
        ("latest_version", r#""0.1.0""#),
        ("target_level", r#""C1""#),
        ("daily_goal", "10"),
    ];

    for (key, value) in settings {
        conn.execute(
            "INSERT OR IGNORE INTO user_settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
    }

    migrations::run(conn)?;

    Ok(())
}
