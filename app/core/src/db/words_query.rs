use crate::db::params; use crate::db::Value;
use crate::shim::State;
use chrono::Utc;
use serde::Serialize;

use crate::db;
use crate::db::words_types::{WordDefItem, WordDetail, WordIdName, WordListItem, WordPage};
use crate::AppState;

/// The SELECT list + FROM/JOIN shared by db_get_words and db_get_words_page —
/// one place, so the row-mapping indices below never drift between the two.
const WORD_LIST_SELECT: &str =
    "SELECT w.id, w.word, w.word_type, w.level, w.word_freq,
            COALESCE((SELECT wd.zh FROM word_definitions wd WHERE wd.word_id = w.id ORDER BY wd.sort_order LIMIT 1), '') as zh,
            COALESCE(sr.srs_level, 0) as srs_level,
            sr.next_review_at,
            w.created_at,
            w.updated_at,
            COALESCE(w.source, 'manual') as source,
            (w.enrichment_text IS NOT NULL) as enriched,
            w.starred,
            w.status
     FROM words w
     LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'";

fn map_word_list_item(row: &crate::db::Row) -> crate::db::DbResult<WordListItem> {
    Ok(WordListItem {
        id: row.get(0)?,
        word: row.get(1)?,
        word_type: row.get(2)?,
        level: row.get(3)?,
        word_freq: row.get(4)?,
        zh: row.get(5)?,
        srs_level: row.get(6)?,
        next_review_at: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        source: row.get(10)?,
        // `enriched` is `(enrichment_text IS NOT NULL)` — BOOL on
        // Postgres, 0/1 on SQLite; reading as bool is portable. `starred`
        // is a BIGINT 0/1 column — read as i64 (Postgres won't decode INT8
        // as bool) and compare.
        enriched: row.get::<bool>(11)?,
        starred: row.get::<i64>(12)? != 0,
        status: row.get::<Option<String>>(13)?.unwrap_or_else(|| "learning".to_string()),
    })
}

#[crate::shim::command]
pub async fn db_get_words(
    search: Option<String>,
    level_filter: Option<String>,
    sort_by: Option<String>,
    date_field: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    conn: State<'_, AppState>,
) -> Result<Vec<WordListItem>, String> {
    let db = db::conn(&conn)?;

    let mut sql = String::from(WORD_LIST_SELECT);
    sql.push_str(" WHERE 1=1");

    let mut param_values: Vec<Value> = vec![];

    if let Some(ref s) = search {
        sql.push_str(" AND (w.word LIKE ?1 ESCAPE '\\' OR EXISTS (SELECT 1 FROM word_definitions wd2 WHERE wd2.word_id = w.id AND wd2.zh LIKE ?1 ESCAPE '\\'))");
        param_values.push(Value::from(format!("%{}%", db::escape_like(s))));
    }

    if let Some(ref lv) = level_filter {
        if lv == "B1-" {
            sql.push_str(" AND w.level IN ('B1', 'A2', 'A1')");
        } else {
            let idx = param_values.len() + 1;
            sql.push_str(&format!(" AND w.level = ?{idx}"));
            param_values.push(Value::from(lv.clone()));
        }
    }

    // Date-range filter, on either created_at or updated_at (default created_at).
    let date_col = match date_field.as_deref() {
        Some("updated") => "w.updated_at",
        _ => "w.created_at",
    };
    if let Some(ref from) = date_from {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(" AND {date_col} >= ?{idx}"));
        param_values.push(Value::from(from.clone()));
    }
    if let Some(ref to) = date_to {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(" AND {date_col} <= ?{idx}"));
        param_values.push(Value::from(format!("{} 23:59:59", to)));
    }

    match sort_by.as_deref() {
        Some("freq") => sql.push_str(" ORDER BY w.word_freq DESC, w.created_at DESC"),
        // LOWER(col) is the portable case-insensitive sort — SQLite's
        // `COLLATE NOCASE` is SQLite-only (Postgres has no NOCASE collation).
        Some("alpha") => sql.push_str(" ORDER BY LOWER(w.word) ASC"),
        // "recent" — updated_at is initialized to created_at on insert and bumped
        // on every edit (enrichment, notes), so ordering by it alone surfaces
        // both newly-added and newly-edited words without a MAX() expression.
        _ => sql.push_str(" ORDER BY w.updated_at DESC"),
    }

    db::fetch_all(&db, &sql, param_values, |row| map_word_list_item(row)).await
}

// ── Paged words (the vocabulary list's 10k-scale path) ──────────────────────

/// Server-side filter set for db_get_words_page. Every field mirrors a chip
/// group on the Words list; `None`/empty means "no constraint on this axis".
#[derive(Default)]
struct WordFilters {
    search: Option<String>,
    levels: Vec<String>,
    statuses: Vec<String>,
    starred: bool,
    enriched: Option<bool>,
    source: Option<String>,
    due_only: bool,
    sort_by: String,
    date_field: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
}

impl WordFilters {
    /// Appends each active filter as ` AND ...` fragments, pushing params in
    /// placeholder order (?1, ?2, …). Used by both the page query and its
    /// paired COUNT(*) so the list and the pager's total can never disagree.
    /// Returns the due-predicate param indices when the duo of "now" values
    /// was allocated (due filter or due-first sort consulted the clock).
    fn push_where(&self, sql: &mut String, params: &mut Vec<Value>, due_expr: Option<&str>) {
        if let Some(ref s) = self.search {
            let idx = params.len() + 1;
            sql.push_str(&format!(
                " AND (w.word LIKE ?{idx} ESCAPE '\\' OR EXISTS (SELECT 1 FROM word_definitions wd2 WHERE wd2.word_id = w.id AND wd2.zh LIKE ?{idx} ESCAPE '\\'))"
            ));
            params.push(Value::from(format!("%{}%", db::escape_like(s))));
        }

        if !self.levels.is_empty() {
            let mut arms: Vec<String> = Vec::with_capacity(self.levels.len());
            for lv in &self.levels {
                if lv == "B1-" {
                    // "B1 and below" expands to the starter CEFR tiers.
                    arms.push("w.level IN ('B1', 'A2', 'A1')".to_string());
                } else {
                    let idx = params.len() + 1;
                    params.push(Value::from(lv.clone()));
                    arms.push(format!("w.level = ?{idx}"));
                }
            }
            sql.push_str(&format!(" AND ({})", arms.join(" OR ")));
        }

        if !self.statuses.is_empty() {
            let mut placeholders: Vec<String> = Vec::with_capacity(self.statuses.len());
            for st in &self.statuses {
                let idx = params.len() + 1;
                params.push(Value::from(st.clone()));
                placeholders.push(format!("?{idx}"));
            }
            sql.push_str(&format!(" AND w.status IN ({})", placeholders.join(", ")));
        }

        if self.starred {
            sql.push_str(" AND w.starred = 1");
        }

        match self.enriched {
            Some(true) => sql.push_str(" AND w.enrichment_text IS NOT NULL"),
            Some(false) => sql.push_str(" AND w.enrichment_text IS NULL"),
            None => {}
        }

        if let Some(ref s) = self.source {
            let idx = params.len() + 1;
            params.push(Value::from(s.clone()));
            sql.push_str(&format!(" AND COALESCE(w.source, 'manual') = ?{idx}"));
        }

        if self.due_only {
            if let Some(expr) = due_expr {
                sql.push_str(&format!(" AND {expr}"));
            }
        }

        // Date-range filter, on either created_at or updated_at (default created_at).
        let date_col = match self.date_field.as_deref() {
            Some("updated") => "w.updated_at",
            _ => "w.created_at",
        };
        if let Some(ref from) = self.date_from {
            let idx = params.len() + 1;
            sql.push_str(&format!(" AND {date_col} >= ?{idx}"));
            params.push(Value::from(from.clone()));
        }
        if let Some(ref to) = self.date_to {
            let idx = params.len() + 1;
            sql.push_str(&format!(" AND {date_col} <= ?{idx}"));
            params.push(Value::from(format!("{} 23:59:59", to)));
        }
    }
}

/// Builds the "this word's next review is in the past" predicate.
///
/// `next_review_at` may hold either RFC3339 ("2026-10-23T16:47:45+00:00",
/// written by db_review_card) or SQLite's own datetime() format
/// ("2026-10-23 16:47:45", from legacy-era rows) — the two formats never
/// sort correctly against each other (' ' < 'T'), which is why srs.rs
/// compares in Rust. In SQL we instead compare each row against a "now"
/// string formatted to match THAT row's format; each arm of the OR is then a
/// safe like-for-like comparison, portable across SQLite and Postgres.
fn due_predicate(now_rfc_idx: usize, now_sql_idx: usize) -> String {
    format!(
        "EXISTS (SELECT 1 FROM srs_records d
                  WHERE d.entity_id = w.id AND d.entity_type = 'word'
                    AND d.next_review_at IS NOT NULL
                    AND ((d.next_review_at LIKE '%T%' AND d.next_review_at <= ?{now_rfc_idx})
                      OR (d.next_review_at NOT LIKE '%T%' AND d.next_review_at <= ?{now_sql_idx})))"
    )
}

#[crate::shim::command]
pub async fn db_get_words_page(
    search: Option<String>,
    levels: Option<Vec<String>>,
    statuses: Option<Vec<String>>,
    starred: Option<bool>,
    enriched: Option<bool>,
    source: Option<String>,
    due_only: Option<bool>,
    sort_by: Option<String>,
    date_field: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    limit: i64,
    offset: i64,
    conn: State<'_, AppState>,
) -> Result<WordPage, String> {
    let db = db::conn(&conn)?;

    let filters = WordFilters {
        search: search.filter(|s| !s.trim().is_empty()),
        levels: levels.unwrap_or_default(),
        statuses: statuses.unwrap_or_default(),
        starred: starred.unwrap_or(false),
        enriched,
        source: source.filter(|s| !s.trim().is_empty() && s != "all"),
        due_only: due_only.unwrap_or(false),
        sort_by: sort_by.unwrap_or_else(|| "recent".to_string()),
        date_field,
        date_from,
        date_to,
    };

    let mut params: Vec<Value> = vec![];

    // Allocate the two "now" representations up front when any due-aware
    // clause runs, so both the WHERE and ORDER BY can reuse the same
    // placeholder indices (positional params are matched by number, not by
    // textual order).
    let due_expr = if filters.due_only || filters.sort_by == "due" {
        let now = Utc::now();
        params.push(Value::from(now.to_rfc3339()));
        params.push(Value::from(now.format("%Y-%m-%d %H:%M:%S").to_string()));
        Some(due_predicate(params.len() - 1, params.len()))
    } else {
        None
    };

    let mut where_sql = String::new();
    filters.push_where(&mut where_sql, &mut params, due_expr.as_deref());

    let order_by = match filters.sort_by.as_str() {
        "alpha" => " ORDER BY LOWER(w.word) ASC".to_string(),
        "freq" => " ORDER BY w.word_freq DESC, w.created_at DESC".to_string(),
        // Due-first: review-ready words bubble to the top, the rest fall
        // back to alphabetical — the list doubles as a "what should I
        // review next" view.
        "due" => format!(
            " ORDER BY (CASE WHEN {} THEN 0 ELSE 1 END), LOWER(w.word) ASC",
            due_expr.as_deref().unwrap_or("0=1")
        ),
        // "recent" — see db_get_words.
        _ => " ORDER BY w.updated_at DESC".to_string(),
    };

    let total = db::scalar_i64(
        &db,
        &format!("SELECT COUNT(*) FROM words w WHERE 1=1{where_sql}"),
        params_for_count(&params, &filters),
    )
    .await?;

    let limit_idx = params.len() + 1;
    let offset_idx = params.len() + 2;
    params.push(Value::from(limit.clamp(1, 500)));
    params.push(Value::from(offset.max(0)));
    let sql = format!(
        "{WORD_LIST_SELECT} WHERE 1=1{where_sql}{order_by} LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
    );

    let items = db::fetch_all(&db, &sql, params, |row| map_word_list_item(row)).await?;
    Ok(WordPage { items, total })
}

/// The COUNT(*) query joins words alone (the srs LEFT JOIN only decorates
/// rows, it cannot change the count), so it reuses the same params EXCEPT
/// any that only appear in the decorated select — there aren't any: every
/// param belongs to the WHERE. A dedicated helper exists anyway so the next
/// person adding a select-only param gets one obvious place to look.
fn params_for_count(params: &[Value], _filters: &WordFilters) -> Vec<Value> {
    params.to_vec()
}

/// Cheap exact-word existence check for the AI-lookup affordance: typing a
/// word not yet in the vocabulary surfaces the "look it up with AI" row, and
/// paged listing can no longer answer that from the current page's rows.
#[crate::shim::command]
pub async fn db_word_exists(word: String, conn: State<'_, AppState>) -> Result<bool, String> {
    let db = db::conn(&conn)?;
    let n = db::scalar_i64(
        &db,
        "SELECT COUNT(*) FROM words WHERE LOWER(word) = LOWER(?1)",
        params![word.trim()],
    )
    .await?;
    Ok(n > 0)
}

/// The columns bulk enrichment actually needs (id, word) — a dedicated
/// projection so the "enrich un-analyzed / re-analyze all" flows don't pay
/// for a 10k-row full dump (definitions subquery, srs join, IPC
/// serialization of every field) just to learn which words to process.
///
/// `un_enriched_only` mirrors the "Enrich un-analyzed" button: rows whose
/// enrichment_text is still NULL. Ordered by id for a stable processing
/// order across the worker pool's shared cursor.
#[crate::shim::command]
pub async fn db_list_word_ids(
    un_enriched_only: bool,
    conn: State<'_, AppState>,
) -> Result<Vec<WordIdName>, String> {
    let db = db::conn(&conn)?;
    let sql = if un_enriched_only {
        "SELECT id, word FROM words WHERE enrichment_text IS NULL ORDER BY id"
    } else {
        "SELECT id, word FROM words ORDER BY id"
    };
    db::fetch_all(&db, sql, (), |row| {
        Ok(WordIdName { id: row.get(0)?, word: row.get(1)? })
    })
    .await
}

/// Aggregate counts the Words page needs: total, un-enriched, and the
/// per-status split. One grouped COUNT instead of shipping word rows — the
/// "re-analyze all" confirm and the list header count both read from here.
#[derive(Serialize)]
pub struct WordStats {
    pub total: i64,
    pub un_enriched: i64,
    pub learning: i64,
    pub familiar: i64,
    pub mastered: i64,
}

#[crate::shim::command]
pub async fn db_get_word_stats(conn: State<'_, AppState>) -> Result<WordStats, String> {
    let db = db::conn(&conn)?;
    let total = db::scalar_i64(&db, "SELECT COUNT(*) FROM words", ()).await?;
    let un_enriched = db::scalar_i64(
        &db,
        "SELECT COUNT(*) FROM words WHERE enrichment_text IS NULL",
        (),
    )
    .await?;
    let status_rows: Vec<(String, i64)> = db::fetch_all(
        &db,
        "SELECT COALESCE(status, 'learning'), COUNT(*) FROM words GROUP BY COALESCE(status, 'learning')",
        (),
        |row| Ok((row.get::<String>(0)?, row.get::<i64>(1)?)),
    )
    .await?;
    let mut learning = 0;
    let mut familiar = 0;
    let mut mastered = 0;
    for (status, count) in status_rows {
        match status.as_str() {
            "familiar" => familiar += count,
            "mastered" => mastered += count,
            _ => learning += count,
        }
    }
    Ok(WordStats { total, un_enriched, learning, familiar, mastered })
}

#[crate::shim::command]
pub async fn db_get_word_detail(
    word_id: i64,
    conn: State<'_, AppState>,
) -> Result<WordDetail, String> {
    let db = db::conn(&conn)?;

    let word = db::fetch_one(
        &db,
        "SELECT w.id, w.word, w.word_type, w.level, w.word_freq, w.mnemonic, w.notes, w.source, w.created_at,
                    COALESCE(sr.srs_level, 0), sr.next_review_at, w.enrichment_text, w.enrichment_json
             FROM words w
             LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
         WHERE w.id = ?1",
        params![word_id],
        |row| {
            Ok(WordDetail {
                id: row.get(0)?,
                word: row.get(1)?,
                word_type: row.get(2)?,
                level: row.get(3)?,
                word_freq: row.get(4)?,
                mnemonic: row.get(5)?,
                notes: row.get(6)?,
                source: row.get(7)?,
                created_at: row.get(8)?,
                srs_level: row.get(9)?,
                next_review_at: row.get(10)?,
                enrichment_text: row.get(11)?,
                enrichment_json: row.get(12)?,
                definitions: vec![],
            })
        },
    )
    .await
    .map_err(|e| format!("Word not found: {e}"))?;

    let definitions: Vec<WordDefItem> = db::fetch_all(
        &db,
        "SELECT pos, zh, en, example_en, example_zh
         FROM word_definitions WHERE word_id = ?1 ORDER BY sort_order",
        params![word_id],
        |row| {
            Ok(WordDefItem {
                pos: row.get(0)?,
                zh: row.get(1)?,
                en: row.get(2)?,
                example_en: row.get(3)?,
                example_zh: row.get(4)?,
            })
        },
    )
    .await?;

    Ok(WordDetail { definitions, ..word })
}
