use tauri::State;

use crate::db;
use crate::AppState;

#[derive(serde::Serialize)]
pub struct ResumeLesson {
    pub article_id: i64,
    pub title: String,
    pub origin: String,
    pub total: i64,
    pub processed: i64,
}

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
    pub resume: Option<ResumeLesson>,
    pub recent_words: Vec<RecentWord>,
    pub recent_docs: Vec<RecentDoc>,
}

#[tauri::command]
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

    // Latest article that still has unprocessed (candidate) items
    let resume = db::fetch_optional(
        &db,
        "SELECT a.id, a.title, a.origin,
                COUNT(e.id),
                SUM(CASE WHEN e.status != 'candidate' THEN 1 ELSE 0 END)
         FROM articles a
         JOIN extracted_items e ON e.article_id = a.id
         GROUP BY a.id
         HAVING SUM(CASE WHEN e.status = 'candidate' THEN 1 ELSE 0 END) > 0
         ORDER BY a.created_at DESC
         LIMIT 1",
        (),
        |row| {
            Ok(ResumeLesson {
                article_id: row.get(0)?,
                title: row.get(1)?,
                origin: row.get(2)?,
                total: row.get(3)?,
                processed: row.get::<Option<i64>>(4)?.unwrap_or(0),
            })
        },
    )
    .await
    .unwrap_or(None);

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
        "SELECT id, title, updated_at FROM documents ORDER BY updated_at DESC LIMIT 3",
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
        resume,
        recent_words,
        recent_docs,
    })
}
