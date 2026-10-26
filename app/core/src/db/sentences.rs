use crate::shim::State;
use crate::db::params;
use crate::db::Value;
use serde::Serialize;

use crate::{db, AppState};
use sea_orm::DbErr;

#[derive(Serialize)]
pub struct SaveSentenceResult {
    id: i64,
    created: bool,
}

/// A saved sentence — first-class, like a word. Replaces the old
/// patterns + pattern_examples duo with a single flat table.
#[derive(Serialize)]
pub struct SentenceItem {
    pub id: i64,
    pub sentence: String,
    pub zh: String,
    pub level: Option<String>,
    pub note: String,
    pub source: String,
    pub article_id: Option<i64>,
    pub starred: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[crate::shim::command]
pub async fn db_list_sentences(conn: State<'_, AppState>) -> Result<Vec<SentenceItem>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT id, sentence, zh, level, note, source, article_id, starred, created_at, updated_at
           FROM sentences ORDER BY created_at DESC, id DESC",
        (),
        |r| {
            Ok(SentenceItem {
                id: r.get(0)?,
                sentence: r.get(1)?,
                zh: r.get(2)?,
                level: r.get(3)?,
                note: r.get(4)?,
                source: r.get(5)?,
                article_id: r.get(6)?,
                // `starred` is a BIGINT 0/1 column — read as i64 and compare,
                // the same convention as words_query/calendar (Postgres won't
                // decode INT8 as bool).
                starred: r.get::<i64>(7)? != 0,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        },
    )
    .await
    .map_err(|e| e.to_string())
}

// ── Server-paged listing (filter bar + 10k-scale browsing) ────────────────

/// Facet counts for the sentence filter bar. Each axis skips its own
/// constraint (same self-exclusion contract as the words facets): a chip can
/// never zero itself, but counts respect every OTHER active filter including
/// search. NULL/unknown levels count in no bucket.
#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SentenceFacets {
    pub level_c2: i64,
    pub level_c1: i64,
    pub level_b2: i64,
    pub level_b1_below: i64, // B1 + A2 + A1
    pub starred: i64,
    /// Source is a free-form column ('chat', 'generate', …) — no static enum
    /// exists to chip against, so the bar gets the observed values with
    /// counts, newest piles first.
    pub sources: Vec<SentenceSourceCount>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SentenceSourceCount {
    pub source: String,
    pub count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentencePage {
    pub items: Vec<SentenceItem>,
    pub total: i64,
    pub facets: SentenceFacets,
}

#[derive(Default)]
struct SentenceFilters {
    search: Option<String>,
    levels: Vec<String>,
    starred: bool,
    source: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum FacetSkip {
    None,
    Levels,
    Starred,
    Sources,
}

const SENT_COLS: &str = "id, sentence, zh, level, note, source, article_id, starred, created_at, updated_at";

fn read_sentence(row: &crate::db::Row) -> Result<SentenceItem, DbErr> {
    Ok(SentenceItem {
        id: row.get(0)?,
        sentence: row.get(1)?,
        zh: row.get(2)?,
        level: row.get(3)?,
        note: row.get(4)?,
        source: row.get(5)?,
        article_id: row.get(6)?,
        // BIGINT 0/1 — read as i64 and compare (Postgres won't decode INT8 as
        // bool); same convention as the legacy list above.
        starred: row.get::<i64>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

impl SentenceFilters {
    /// Appends the active filters as ` AND ...` fragments, pushing params in
    /// placeholder order. Everything is dialect-safe on both SQLite and
    /// Postgres (LIKE/ESCAPE, IN lists, string compares — the words facets on
    /// Postgres failing with "group_concat does not exist" via a lone
    /// SQLite-ism is why every clause here is portable). `skip` drops exactly
    /// one axis so a facet never zeroes itself.
    fn push_where(&self, sql: &mut String, params: &mut Vec<Value>, skip: FacetSkip) {
        // Multi-token AND search across the fields the collapsed row or its
        // expansion can show — the frontend splits the query the same way,
        // and \-escaping keeps literal %/_ searchable.
        if let Some(ref s) = self.search {
            for token in s.split_whitespace() {
                let idx = params.len() + 1;
                params.push(Value::from(format!("%{}%", db::escape_like(token))));
                sql.push_str(&format!(
                    " AND (LOWER(s.sentence) LIKE ?{idx} ESCAPE '\\' OR LOWER(s.zh) LIKE ?{idx} ESCAPE '\\' OR LOWER(s.note) LIKE ?{idx} ESCAPE '\\' OR LOWER(s.source) LIKE ?{idx} ESCAPE '\\')"
                ));
            }
        }

        if skip != FacetSkip::Levels && !self.levels.is_empty() {
            let mut arms: Vec<String> = Vec::with_capacity(self.levels.len());
            for lv in &self.levels {
                if lv == "B1-" {
                    arms.push("s.level IN ('B1', 'A2', 'A1')".to_string());
                } else {
                    let idx = params.len() + 1;
                    params.push(Value::from(lv.clone()));
                    arms.push(format!("s.level = ?{idx}"));
                }
            }
            sql.push_str(&format!(" AND ({})", arms.join(" OR ")));
        }

        if skip != FacetSkip::Starred && self.starred {
            sql.push_str(" AND s.starred = 1");
        }

        if skip != FacetSkip::Sources {
            if let Some(ref s) = self.source {
                let idx = params.len() + 1;
                params.push(Value::from(s.clone()));
                sql.push_str(&format!(" AND COALESCE(s.source, 'manual') = ?{idx}"));
            }
        }

        // Inclusive local-day range on updated_at, expressed as lexicographic
        // text compares (timestamps are ISO text on both backends).
        if let Some(ref from) = self.date_from {
            if !from.is_empty() {
                let idx = params.len() + 1;
                params.push(Value::from(from.clone()));
                sql.push_str(&format!(" AND s.updated_at >= ?{idx}"));
            }
        }
        if let Some(ref to) = self.date_to {
            if !to.is_empty() {
                let idx = params.len() + 1;
                params.push(Value::from(format!("{to} 23:59:59")));
                sql.push_str(&format!(" AND s.updated_at <= ?{idx}"));
            }
        }
    }
}

async fn sentence_facets(db: &crate::db::Conn, filters: &SentenceFilters) -> Result<SentenceFacets, String> {
    let mut facets = SentenceFacets::default();

    // Level GROUP BY, skipping the level axis only.
    {
        let mut w = String::from(" WHERE 1=1");
        let mut params: Vec<Value> = Vec::new();
        filters.push_where(&mut w, &mut params, FacetSkip::Levels);
        let rows = db::fetch_all(
            db,
            &format!("SELECT CASE WHEN s.level IN ('B1','A2','A1') THEN 'b1_below' ELSE s.level END AS bucket, COUNT(*) FROM sentences s{w} GROUP BY bucket"),
            params,
            |r| Ok((r.get::<Option<String>>(0)?, r.get::<i64>(1)?)),
        )
        .await
        .map_err(|e| e.to_string())?;
        for (bucket, n) in rows {
            match bucket.as_deref() {
                Some("C2") => facets.level_c2 = n,
                Some("C1") => facets.level_c1 = n,
                Some("B2") => facets.level_b2 = n,
                Some("b1_below") => facets.level_b1_below = n,
                _ => {} // NULL / unknown levels count nowhere
            }
        }
    }

    // Starred count, skipping the starred axis only.
    {
        let mut w = String::from(" WHERE 1=1");
        let mut params: Vec<Value> = Vec::new();
        filters.push_where(&mut w, &mut params, FacetSkip::Starred);
        facets.starred = db::fetch_one(
            db,
            &format!("SELECT COUNT(*) FROM sentences s{w} AND s.starred = 1"),
            params,
            |r| r.get::<i64>(0),
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    // Observed sources with counts, skipping the source axis only. The
    // COALESCE mirrors push_where's so a filtered 'manual' finds rows whose
    // source column is '' or NULL.
    {
        let mut w = String::from(" WHERE 1=1");
        let mut params: Vec<Value> = Vec::new();
        filters.push_where(&mut w, &mut params, FacetSkip::Sources);
        facets.sources = db::fetch_all(
            db,
            &format!("SELECT COALESCE(NULLIF(s.source, ''), 'manual') AS src, COUNT(*) FROM sentences s{w} GROUP BY src ORDER BY 2 DESC"),
            params,
            |r| Ok(SentenceSourceCount { source: r.get(0)?, count: r.get(1)? }),
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(facets)
}

/// Filtered + paginated sentence list with facet counts riding along (one
/// round trip, snapshot-consistent — same shape as db_get_words_page).
#[crate::shim::command]
pub async fn db_get_sentences_page(
    search: Option<String>,
    levels: Option<Vec<String>>,
    starred: Option<bool>,
    source: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    sort_by: Option<String>,
    sort_desc: Option<bool>,
    limit: i64,
    offset: i64,
    conn: State<'_, AppState>,
) -> Result<SentencePage, String> {
    let db = db::conn(&conn)?;
    let filters = SentenceFilters {
        search: search.filter(|s| !s.trim().is_empty()).map(|s| s.trim().to_lowercase()),
        levels: levels.unwrap_or_default(),
        starred: starred.unwrap_or(false),
        source: source.filter(|s| !s.trim().is_empty()),
        date_from: date_from.filter(|s| !s.is_empty()),
        date_to: date_to.filter(|s| !s.is_empty()),
    };

    let mut w = String::from(" WHERE 1=1");
    let mut params: Vec<Value> = Vec::new();
    filters.push_where(&mut w, &mut params, FacetSkip::None);

    let total = db::fetch_one(
        &db,
        &format!("SELECT COUNT(*) FROM sentences s{w}"),
        params.clone(),
        |r| r.get::<i64>(0),
    )
    .await
    .map_err(|e| e.to_string())?;

    // "recent" = created order (the stable feed readers scroll), "alpha" for
    // dictionary-style scans. Tiebreak on id so paging can't shuffle rows.
    let order = match sort_by.as_deref() {
        Some("alpha") => {
            if sort_desc.unwrap_or(false) {
                " ORDER BY LOWER(s.sentence) DESC, s.id DESC"
            } else {
                " ORDER BY LOWER(s.sentence) ASC, s.id ASC"
            }
        }
        _ => " ORDER BY s.created_at DESC, s.id DESC",
    };

    let mut page_sql = format!("SELECT {SENT_COLS} FROM sentences s{w}{order}");
    let mut page_params = params;
    let limit_idx = page_params.len() + 1;
    let offset_idx = page_params.len() + 2;
    page_sql.push_str(&format!(" LIMIT ?{limit_idx} OFFSET ?{offset_idx}"));
    page_params.push(Value::from(limit.clamp(1, 200)));
    page_params.push(Value::from(offset.max(0)));
    let items = db::fetch_all(&db, &page_sql, page_params, |r| read_sentence(r))
        .await
        .map_err(|e| e.to_string())?;

    let facets = sentence_facets(&db, &filters).await?;
    Ok(SentencePage { items, total, facets })
}

#[crate::shim::command]
pub async fn db_delete_sentence(sentence_id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    db_delete_sentences_batch(vec![sentence_id], conn).await
}

/// Delete a selection in one transaction (mirrors the patterns batch delete).
#[crate::shim::command]
pub async fn db_delete_sentences_batch(
    sentence_ids: Vec<i64>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    if sentence_ids.is_empty() {
        return Ok(());
    }
    let ids = sentence_ids
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    tx.execute(
        &format!("DELETE FROM sentences WHERE id IN ({ids})"),
        (),
    )
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

#[crate::shim::command]
pub async fn db_set_sentence_starred(
    sentence_id: i64,
    starred: bool,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE sentences SET starred = ?1 WHERE id = ?2",
        params![starred as i64, sentence_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Re-analyze / edit a saved sentence's translation, note, and level in place.
/// The sentence text itself is immutable (the user saved it as-is). Used by
/// the re-analyze action and the inline edit flow.
#[crate::shim::command]
pub async fn db_update_sentence(
    sentence_id: i64,
    zh: String,
    note: String,
    level: String,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    let level = level.trim().to_string();
    let level_opt = if level.is_empty() { None } else { Some(level) };
    db.execute(
        "UPDATE sentences SET zh=?2, note=?3, level=?4, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![sentence_id, zh, note, level_opt],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Save a sentence into the library, deduplicating by the exact sentence text.
#[crate::shim::command]
pub async fn db_save_sentence(
    sentence: String,
    zh: String,
    note: String,
    level: String,
    source: String,
    conn: State<'_, AppState>,
) -> Result<SaveSentenceResult, String> {
    let db = db::txn_conn(&conn).await?;
    let sentence = sentence.trim().to_string();
    if sentence.is_empty() {
        return Err("empty sentence".into());
    }
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    // Dedup by exact sentence text.
    if let Some(id) = db::fetch_optional(
        &tx,
        "SELECT id FROM sentences WHERE sentence=?1 LIMIT 1",
        [sentence.clone()],
        |r| r.get::<i64>(0),
    )
    .await?
    {
        return Ok(SaveSentenceResult {
            id,
            created: false,
        });
    }
    let level = level.trim().to_string();
    let level_opt = if level.is_empty() { None } else { Some(level) };
    let id = db::fetch_one(
        &tx,
        "INSERT INTO sentences(sentence, zh, level, note, source, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP) RETURNING id",
        params![sentence, zh, level_opt, note, source],
        |r| r.get::<i64>(0),
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(SaveSentenceResult {
        id,
        created: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn batch_delete_removes_selected_sentences_and_keeps_the_rest() {
        let path = std::env::temp_dir()
            .join(format!("tanwords-sentence-batch-{}.db", std::process::id()))
            .to_string_lossy()
            .into_owned();
        let database =
            crate::db::connection::open(&crate::db::DbProfile::Local { path: path.clone() }, None)
                .await
                .expect("open test database");
        let app_state = crate::AppState {
            db: std::sync::Mutex::new(database),
            #[cfg(feature = "tts")]
            tts: std::sync::Mutex::new(None).into(),
            #[cfg(feature = "asr")]
            asr: std::sync::Mutex::new(None).into(),
            db_fallback_warning: None,
            document_privacy: Default::default(),
        };
        let state = crate::shim::State::from_ref(&app_state);

        let first = db_save_sentence(
            "First sentence.".into(),
            "第一句。".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save first sentence");
        let kept = db_save_sentence(
            "Keep this sentence.".into(),
            "保留这句。".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save kept sentence");
        let third = db_save_sentence(
            "Third sentence.".into(),
            "第三句。".into(),
            String::new(),
            "A1".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("save third sentence");

        db_delete_sentences_batch(vec![first.id, third.id], state.clone())
            .await
            .expect("batch delete sentences");

        let remaining = db_list_sentences(state)
            .await
            .expect("list remaining sentences");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, kept.id);

        // Dedup: saving the same sentence text returns the existing id, created=false.
        let dup = db_save_sentence(
            "Keep this sentence.".into(),
            "新翻译。".into(),
            String::new(),
            "A2".into(),
            String::new(),
            state.clone(),
        )
        .await
        .expect("dedup save");
        assert!(!dup.created);
        assert_eq!(dup.id, kept.id);

        drop(app_state);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{path}-wal"));
        let _ = std::fs::remove_file(format!("{path}-shm"));
    }
}
