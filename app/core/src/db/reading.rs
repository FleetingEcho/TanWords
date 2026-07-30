use libsql::{params, Connection, Value};
use serde::Serialize;
use crate::shim::State;

use crate::db;
use crate::AppState;

/// Rows in the reading library list. `content` is deliberately absent — a
/// page of 20 articles would otherwise carry a few hundred KB of body text
/// the list never renders.
#[derive(Serialize)]
pub struct ReadingArticleItem {
    pub id: i64,
    pub title: String,
    pub word_count: i64,
    pub source: String,
    pub source_url: String,
    pub tags: String,
    pub created_at: String,
    pub last_read_at: String,
    pub comment_count: i64,
    /// Matching text around the search term; empty when not searching.
    pub snippet: String,
}

#[derive(Serialize)]
pub struct ReadingArticleDetail {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub word_count: i64,
    pub source: String,
    pub source_url: String,
    pub tags: String,
    pub created_at: String,
    pub last_read_at: String,
}

#[derive(Serialize)]
pub struct ReadingComment {
    pub id: i64,
    pub article_id: i64,
    pub author: String,
    pub body: String,
    pub anchor_text: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct ReadingArticlePage {
    pub items: Vec<ReadingArticleItem>,
    pub total: i64,
}

/// Every whitespace-separated word becomes a quoted prefix term, ANDed
/// together — quoting keeps punctuation in the query from being parsed as
/// FTS5 syntax (a stray `-` or quote otherwise fails the whole query).
pub fn fts_match_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|term| term.replace('"', ""))
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn word_count_of(text: &str) -> i64 {
    text.split_whitespace().count() as i64
}

/// Saves an article, treating a re-save of the same text as a re-read.
/// Agents adding through MCP would otherwise pile up near-duplicates of
/// whatever they were handed; the user re-pasting an article they already
/// have should land back on the same entry, not a second copy.
pub async fn upsert_article(
    conn: &Connection,
    title: &str,
    content: &str,
    source: &str,
    source_url: &str,
    tags: &str,
) -> Result<(i64, bool), String> {
    let fingerprint: String = content.chars().take(200).collect();
    let existing: Option<i64> = crate::db::fetch_optional(
        conn,
        "SELECT id FROM reading_articles WHERE title = ?1 AND substr(content, 1, 200) = ?2",
        params![title, fingerprint],
        |row| row.get(0),
    )
    .await
    .unwrap_or(None);

    if let Some(id) = existing {
        conn.execute(
            "UPDATE reading_articles SET last_read_at = datetime('now') WHERE id = ?1",
            params![id],
        )
        .await
        .map_err(|e| e.to_string())?;
        return Ok((id, false));
    }

    conn.execute(
        "INSERT INTO reading_articles (title, content, word_count, source, source_url, tags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![title, content, word_count_of(content), source, source_url, tags],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok((conn.last_insert_rowid(), true))
}

#[crate::shim::command]
pub async fn db_save_reading_article(
    title: String,
    content: String,
    source: String,
    source_url: Option<String>,
    tags: Option<String>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    let (id, _) = upsert_article(
        &db,
        &title,
        &content,
        &source,
        &source_url.unwrap_or_default(),
        &tags.unwrap_or_else(|| "[]".into()),
    )
    .await?;
    Ok(id)
}

/// Lists the library. `search` runs against the FTS index (relevance-ranked,
/// with a snippet); everything else is a plain filter.
#[crate::shim::command]
pub async fn db_list_reading_articles(
    search: Option<String>,
    source: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    only_commented: Option<bool>,
    sort: Option<String>,
    page: Option<i64>,
    limit: Option<i64>,
    conn: State<'_, AppState>,
) -> Result<ReadingArticlePage, String> {
    let db = db::conn(&conn)?;
    let lim = limit.unwrap_or(20).clamp(1, 100);
    let offset = page.unwrap_or(0) * lim;

    let search_terms = search
        .as_deref()
        .map(fts_match_query)
        .filter(|terms| !terms.is_empty());

    let mut from = String::from("FROM reading_articles a");
    if search_terms.is_some() {
        from.push_str(" JOIN reading_articles_fts f ON f.rowid = a.id");
    }

    let mut where_sql = String::from(" WHERE 1=1");
    let mut values: Vec<Value> = vec![];

    if let Some(terms) = &search_terms {
        where_sql.push_str(&format!(" AND reading_articles_fts MATCH ?{}", values.len() + 1));
        values.push(Value::from(terms.clone()));
    }
    if let Some(source) = source.filter(|s| !s.is_empty()) {
        where_sql.push_str(&format!(" AND a.source = ?{}", values.len() + 1));
        values.push(Value::from(source));
    }
    if let Some(from_date) = date_from.filter(|s| !s.is_empty()) {
        where_sql.push_str(&format!(" AND a.last_read_at >= ?{}", values.len() + 1));
        values.push(Value::from(from_date));
    }
    if let Some(to_date) = date_to.filter(|s| !s.is_empty()) {
        where_sql.push_str(&format!(
            " AND a.last_read_at < date(?{}, '+1 day')",
            values.len() + 1
        ));
        values.push(Value::from(to_date));
    }
    if only_commented.unwrap_or(false) {
        where_sql
            .push_str(" AND EXISTS(SELECT 1 FROM reading_article_comments c WHERE c.article_id = a.id)");
    }

    let total = db::scalar_i64(
        &db,
        &format!("SELECT COUNT(*) {from}{where_sql}"),
        values.clone(),
    )
    .await?;

    // Relevance only means something for a search; otherwise the user picked
    // the order explicitly.
    let order = match sort.as_deref() {
        Some("added") => "a.created_at DESC",
        Some("longest") => "a.word_count DESC",
        _ if search_terms.is_some() => "bm25(reading_articles_fts)",
        _ => "a.last_read_at DESC",
    };
    let snippet = if search_terms.is_some() {
        "snippet(reading_articles_fts, 1, '', '', '…', 22)"
    } else {
        "''"
    };

    let sql = format!(
        "SELECT a.id, a.title, a.word_count, a.source, a.source_url, a.tags, a.created_at, a.last_read_at,
                (SELECT COUNT(*) FROM reading_article_comments c WHERE c.article_id = a.id),
                {snippet}
         {from}{where_sql}
         ORDER BY {order}
         LIMIT ?{} OFFSET ?{}",
        values.len() + 1,
        values.len() + 2
    );
    values.push(Value::from(lim));
    values.push(Value::from(offset));

    let items = db::fetch_all(&db, &sql, values, |row| {
        Ok(ReadingArticleItem {
            id: row.get(0)?,
            title: row.get(1)?,
            word_count: row.get(2)?,
            source: row.get(3)?,
            source_url: row.get(4)?,
            tags: row.get(5)?,
            created_at: row.get(6)?,
            last_read_at: row.get(7)?,
            comment_count: row.get(8)?,
            snippet: row.get(9)?,
        })
    })
    .await?;
    Ok(ReadingArticlePage { items, total })
}

#[crate::shim::command]
pub async fn db_get_reading_article(
    id: i64,
    touch: Option<bool>,
    conn: State<'_, AppState>,
) -> Result<Option<ReadingArticleDetail>, String> {
    let db = db::conn(&conn)?;
    if touch.unwrap_or(false) {
        db.execute(
            "UPDATE reading_articles SET last_read_at = datetime('now') WHERE id = ?1",
            params![id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    let detail = db::fetch_optional(
        &db,
        "SELECT id, title, content, word_count, source, source_url, tags, created_at, last_read_at
         FROM reading_articles WHERE id = ?1",
        params![id],
        |row| {
            Ok(ReadingArticleDetail {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                word_count: row.get(3)?,
                source: row.get(4)?,
                source_url: row.get(5)?,
                tags: row.get(6)?,
                created_at: row.get(7)?,
                last_read_at: row.get(8)?,
            })
        },
    )
    .await
    .unwrap_or(None);
    Ok(detail)
}

#[crate::shim::command]
pub async fn db_delete_reading_article(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute("DELETE FROM reading_article_comments WHERE article_id = ?1", params![id])
        .await
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM reading_articles WHERE id = ?1", params![id])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_list_reading_comments(
    article_id: i64,
    conn: State<'_, AppState>,
) -> Result<Vec<ReadingComment>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT id, article_id, author, body, anchor_text, created_at
         FROM reading_article_comments WHERE article_id = ?1 ORDER BY created_at",
        params![article_id],
        |row| {
            Ok(ReadingComment {
                id: row.get(0)?,
                article_id: row.get(1)?,
                author: row.get(2)?,
                body: row.get(3)?,
                anchor_text: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .await
}

pub async fn insert_comment(
    conn: &Connection,
    article_id: i64,
    author: &str,
    body: &str,
    anchor_text: Option<&str>,
) -> Result<i64, String> {
    let exists = crate::db::scalar_i64(
        conn,
        "SELECT COUNT(*) FROM reading_articles WHERE id = ?1",
        params![article_id],
    )
    .await
    .unwrap_or(0);
    if exists == 0 {
        return Err("Article not found".into());
    }
    conn.execute(
        "INSERT INTO reading_article_comments (article_id, author, body, anchor_text)
         VALUES (?1, ?2, ?3, ?4)",
        params![article_id, author, body, anchor_text],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[crate::shim::command]
pub async fn db_add_reading_comment(
    article_id: i64,
    author: String,
    body: String,
    anchor_text: Option<String>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    insert_comment(&db, article_id, &author, &body, anchor_text.as_deref()).await
}

#[crate::shim::command]
pub async fn db_delete_reading_comment(id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute("DELETE FROM reading_article_comments WHERE id = ?1", params![id])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
