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
    pub created_at: String,
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
pub fn db_dashboard_stats(conn: State<'_, AppState>) -> Result<DashboardStats, String> {
    let db = db::lock_db(&conn)?;

    let scalar = |sql: &str| -> i64 {
        db.query_row(sql, [], |row| row.get(0)).unwrap_or(0)
    };

    let word_count = scalar("SELECT COUNT(*) FROM words");
    let words_this_week = scalar(
        "SELECT COUNT(*) FROM words WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-6 days')",
    );
    let article_count = scalar("SELECT COUNT(*) FROM articles");
    let doc_count = scalar("SELECT COUNT(*) FROM documents");
    let known_count = scalar("SELECT COUNT(*) FROM user_known_words");

    // Latest article that still has unprocessed (candidate) items
    let resume = db
        .query_row(
            "SELECT a.id, a.title, a.origin,
                    COUNT(e.id),
                    SUM(CASE WHEN e.status != 'candidate' THEN 1 ELSE 0 END)
             FROM articles a
             JOIN extracted_items e ON e.article_id = a.id
             GROUP BY a.id
             HAVING SUM(CASE WHEN e.status = 'candidate' THEN 1 ELSE 0 END) > 0
             ORDER BY a.created_at DESC
             LIMIT 1",
            [],
            |row| {
                Ok(ResumeLesson {
                    article_id: row.get(0)?,
                    title: row.get(1)?,
                    origin: row.get(2)?,
                    total: row.get(3)?,
                    processed: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                })
            },
        )
        .ok();

    let mut recent_words = vec![];
    {
        let mut stmt = db
            .prepare(
                "SELECT w.id, w.word,
                        COALESCE((SELECT zh FROM word_definitions d
                                  WHERE d.word_id = w.id ORDER BY d.sort_order, d.id LIMIT 1), ''),
                        COALESCE(w.level, ''),
                        w.created_at
                 FROM words w ORDER BY w.created_at DESC, w.id DESC LIMIT 5",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(RecentWord {
                    id: row.get(0)?,
                    word: row.get(1)?,
                    zh: row.get(2)?,
                    level: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            recent_words.push(row.map_err(|e| e.to_string())?);
        }
    }

    let mut recent_docs = vec![];
    {
        let mut stmt = db
            .prepare("SELECT id, title, updated_at FROM documents ORDER BY updated_at DESC LIMIT 3")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(RecentDoc {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            recent_docs.push(row.map_err(|e| e.to_string())?);
        }
    }

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
