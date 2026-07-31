use crate::shim::State;

use crate::db;
use crate::AppState;

#[derive(serde::Serialize)]
pub struct RecentWord {
    pub id: i64,
    pub word: String,
    pub zh: String,
    pub level: String,
    pub updated_at: String,
}

#[derive(serde::Serialize)]
pub struct RecentDoc {
    pub id: i64,
    pub title: String,
    pub updated_at: String,
}

#[derive(serde::Serialize)]
pub struct DashboardStats {
    pub word_count: i64,
    pub words_this_week: i64,
    pub article_count: i64,
    pub doc_count: i64,
    pub known_count: i64,
    pub recent_words: Vec<RecentWord>,
    pub recent_docs: Vec<RecentDoc>,
}

#[crate::shim::command]
pub async fn db_dashboard_stats(conn: State<'_, AppState>) -> Result<DashboardStats, String> {
    let db = db::conn(&conn)?;

    let word_count = db::scalar_i64(&db, "SELECT COUNT(*) FROM words", ()).await?;
    let words_this_week = db::scalar_i64(
        &db,
        "SELECT COUNT(*) FROM words WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-6 days')",
        (),
    )
    .await?;
    let article_count = db::scalar_i64(&db, "SELECT COUNT(*) FROM articles", ()).await?;
    let doc_count = db::scalar_i64(&db, "SELECT COUNT(*) FROM documents", ()).await?;
    let known_count = db::scalar_i64(&db, "SELECT COUNT(*) FROM user_known_words", ()).await?;

    // A `resume` field used to be computed here from a JOIN on extracted_items.
    // Migration 20 dropped that table (it replaced the candidate/accept
    // workflow with a per-article markdown note plus saved_sentences), so the
    // query could only ever fail — and its `.unwrap_or(None)` turned that into
    // a silent `None` on every single dashboard load. Nothing in the renderer
    // ever read it. Removed rather than repaired: the concept it modelled no
    // longer exists in the schema.

    let recent_words = db::fetch_all(
        &db,
        "SELECT w.id, w.word,
                COALESCE((SELECT zh FROM word_definitions d
                          WHERE d.word_id = w.id ORDER BY d.sort_order, d.id LIMIT 1), ''),
                COALESCE(w.level, ''),
                w.updated_at
         FROM words w ORDER BY w.updated_at DESC, w.id DESC LIMIT 5",
        (),
        |row| {
            Ok(RecentWord {
                id: row.get(0)?,
                word: row.get(1)?,
                zh: row.get(2)?,
                level: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .await?;

    let recent_docs = db::fetch_all(
        &db,
        // 5, matching DASHBOARD_BODY_ROWS in the renderer's DashboardCard — the
        // grid's cards are a fixed five rows tall, so a lower limit here just
        // leaves this one looking half-empty next to its neighbours.
        "SELECT id, title, updated_at FROM documents ORDER BY updated_at DESC LIMIT 5",
        (),
        |row| {
            Ok(RecentDoc {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    )
    .await?;

    Ok(DashboardStats {
        word_count,
        words_this_week,
        article_count,
        doc_count,
        known_count,
        recent_words,
        recent_docs,
    })
}
