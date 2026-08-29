use chrono::{DateTime, TimeZone, Utc};
use rs_fsrs::{Card, Rating, State, FSRS};
use crate::db::params;
use serde::Serialize;
use crate::shim::State as TauriState;

use crate::db;
use crate::AppState;

/// Words introduced per db_get_due_cards call when the reviewer isn't
/// working through a review backlog — keeps a big vocabulary from dumping
/// hundreds of "new" cards into one session.
const DEFAULT_NEW_LIMIT: i64 = 20;

#[derive(Serialize)]
pub struct DueCard {
    pub word_id: i64,
    pub word: String,
    pub zh: String,
    pub level: Option<String>,
    pub context_sentence: String,
    /// "new" | "learning" | "review" | "relearning"
    pub state: String,
}

fn state_to_str(state: State) -> &'static str {
    match state {
        State::New => "new",
        State::Learning => "learning",
        State::Review => "review",
        State::Relearning => "relearning",
    }
}

fn state_from_i64(v: i64) -> State {
    match v {
        1 => State::Learning,
        2 => State::Review,
        3 => State::Relearning,
        _ => State::New,
    }
}

fn dt_to_sql(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339()
}

fn sql_to_dt(s: &str) -> DateTime<Utc> {
    // Stored as RFC3339 (from dt_to_sql) or SQLite's default datetime('now')
    // format ("YYYY-MM-DD HH:MM:SS") for rows never touched by FSRS.
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                .map(|naive| Utc.from_utc_datetime(&naive))
        })
        .unwrap_or_else(|_| Utc::now())
}

/// Count of cards ready for review right now: the due backlog plus a capped
/// batch of never-reviewed words, using the same cap and the same
/// never-scheduled definition as `db_get_due_cards` so the Dashboard badge
/// matches what opening the reviewer shows.
///
/// Compares dates in Rust rather than SQL because next_review_at may hold
/// either RFC3339 (written by db_review_card) or SQLite's own datetime()
/// format (written by long-removed legacy quiz commands; real databases still
/// carry such rows) — the two don't sort correctly against each other as raw
/// strings.
#[crate::shim::command]
pub async fn db_get_review_count(conn: TauriState<'_, AppState>) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    let now = Utc::now();

    let due_dates: Vec<String> = db::fetch_all(
        &db,
        "SELECT next_review_at FROM srs_records WHERE entity_type = 'word' AND next_review_at IS NOT NULL",
        (),
        |row| row.get::<String>(0),
    )
    .await?;
    let due_count = due_dates.iter().filter(|s| sql_to_dt(s) <= now).count() as i64;

    let new_count: i64 = db::scalar_i64(
        &db,
        "SELECT COUNT(*) FROM words w LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word' WHERE sr.id IS NULL OR sr.next_review_at IS NULL",
        (),
    )
    .await?;

    Ok(due_count + new_count.min(DEFAULT_NEW_LIMIT))
}

#[crate::shim::command]
pub async fn db_get_due_cards(
    new_limit: Option<i64>,
    conn: TauriState<'_, AppState>,
) -> Result<Vec<DueCard>, String> {
    let db = db::conn(&conn)?;
    let new_limit = new_limit.unwrap_or(DEFAULT_NEW_LIMIT);

    let zh_expr = "COALESCE((SELECT wd.zh FROM word_definitions wd WHERE wd.word_id = w.id ORDER BY wd.sort_order LIMIT 1), '')";
    // `extracted_items` used to be the preferred source here, but migration 20
    // dropped that table when the candidate/accept workflow was replaced. The
    // subquery survived and made this whole statement fail on the first launch
    // after that migration (init_db re-creates the table — empty — on the next
    // launch, which is what hid the breakage).
    let context_expr = "COALESCE(
        (SELECT wd.example_en FROM word_definitions wd
         WHERE wd.word_id = w.id AND wd.example_en IS NOT NULL AND wd.example_en != ''
         ORDER BY wd.sort_order LIMIT 1),
        ''
    )";

    let mut result = vec![];

    // Backlog: previously-scheduled reviews that are now due. Filtered in
    // Rust, not SQL: `next_review_at` may hold either RFC3339 (written by
    // db_review_card) or SQLite's own datetime() format (written by
    // long-removed legacy quiz commands; real databases still carry such
    // rows), and the two don't compare correctly as raw strings — the same
    // reason `db_get_review_count` filters in Rust, which is also what keeps
    // the Dashboard badge and this list in agreement.
    let due_sql = format!(
        "SELECT w.id, w.word, {zh_expr}, w.level, {context_expr}, sr.state, sr.next_review_at
         FROM words w
         JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
         WHERE sr.next_review_at IS NOT NULL"
    );
    let now = Utc::now();
    let mut backlog: Vec<(chrono::DateTime<Utc>, DueCard)> = db::fetch_all(
        &db,
        &due_sql,
        (),
        |row| {
            let state_i: i64 = row.get(5)?;
            Ok((
                sql_to_dt(&row.get::<String>(6)?),
                DueCard {
                    word_id: row.get(0)?,
                    word: row.get(1)?,
                    zh: row.get(2)?,
                    level: row.get(3)?,
                    context_sentence: row.get(4)?,
                    state: state_to_str(state_from_i64(state_i)).to_string(),
                },
            ))
        },
    )
    .await?;
    backlog.retain(|(due, _)| *due <= now);
    backlog.sort_by_key(|(due, _)| *due);
    result.extend(backlog.into_iter().map(|(_, card)| card));

    // New: never-scheduled words, capped so a big vocabulary doesn't flood the
    // session. Two shapes count as never-scheduled: no srs row at all, and the
    // row `db_add_word`/`db_update_word` seed with `next_review_at` NULL —
    // without the second arm, every added word carries a seeded row and the
    // reviewer would have no way to bootstrap a first review.
    let new_sql = format!(
        "SELECT w.id, w.word, {zh_expr}, w.level, {context_expr}
         FROM words w
         LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
         WHERE sr.id IS NULL OR sr.next_review_at IS NULL
         ORDER BY w.created_at ASC
         LIMIT ?1"
    );
    result.extend(
        db::fetch_all(&db, &new_sql, params![new_limit], |row| {
            Ok(DueCard {
                word_id: row.get(0)?,
                word: row.get(1)?,
                zh: row.get(2)?,
                level: row.get(3)?,
                context_sentence: row.get(4)?,
                state: "new".to_string(),
            })
        })
        .await?,
    );

    Ok(result)
}

#[derive(Serialize)]
pub struct ReviewResult {
    pub next_review_at: String,
    pub scheduled_days: i64,
    pub state: String,
}

#[crate::shim::command]
pub async fn db_review_card(
    word_id: i64,
    rating: String,
    conn: TauriState<'_, AppState>,
) -> Result<ReviewResult, String> {
    let rating = match rating.as_str() {
        "again" => Rating::Again,
        "hard" => Rating::Hard,
        "good" => Rating::Good,
        other => return Err(format!("invalid rating: {other} (expected again/hard/good)")),
    };

    let db = db::conn(&conn)?;

    let existing: Option<(f64, f64, i64, i64, i64, i64, String, String, i64)> = db::fetch_optional(
        &db,
        "SELECT stability, difficulty, elapsed_days, scheduled_days, review_count, lapses, next_review_at, last_reviewed_at, state
         FROM srs_records WHERE entity_id = ?1 AND entity_type = 'word'",
        params![word_id],
        |row| {
            // The add-word paths seed a bare srs row (level/ease only), so
            // every FSRS column can be NULL on a first review. Reading the
            // NULLs as defaults keeps that first review a normal "new card"
            // instead of a decode error.
            Ok((
                row.get::<Option<f64>>(0)?.unwrap_or_default(),
                row.get::<Option<f64>>(1)?.unwrap_or_default(),
                row.get::<Option<i64>>(2)?.unwrap_or_default(),
                row.get::<Option<i64>>(3)?.unwrap_or_default(),
                row.get::<Option<i64>>(4)?.unwrap_or_default(),
                row.get::<Option<i64>>(5)?.unwrap_or_default(),
                row.get::<Option<String>>(6)?.unwrap_or_default(),
                row.get::<Option<String>>(7)?.unwrap_or_default(),
                row.get::<Option<i64>>(8)?.unwrap_or_default(),
            ))
        },
    )
    .await?;

    let now = Utc::now();
    let card = match existing {
        Some((stability, difficulty, elapsed_days, scheduled_days, reps, lapses, due_s, last_review_s, state_i)) => Card {
            due: if due_s.is_empty() { now } else { sql_to_dt(&due_s) },
            stability,
            difficulty,
            elapsed_days,
            scheduled_days,
            reps: reps as i32,
            lapses: lapses as i32,
            state: state_from_i64(state_i),
            last_review: if last_review_s.is_empty() { now } else { sql_to_dt(&last_review_s) },
        },
        None => Card::new(),
    };

    let fsrs = FSRS::default();
    let scheduling = fsrs.next(card, now, rating);
    let new_card = scheduling.card;

    let next_review_at = dt_to_sql(new_card.due);
    let last_reviewed_at = dt_to_sql(new_card.last_review);
    let state_str = state_to_str(new_card.state).to_string();

    db.execute(
        "INSERT INTO srs_records
            (entity_id, entity_type, srs_level, srs_ease, review_count, last_reviewed_at, next_review_at,
             stability, difficulty, elapsed_days, scheduled_days, lapses, state)
         VALUES (?1, 'word', ?2, 2.5, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(entity_id, entity_type) DO UPDATE SET
            srs_level = ?2, review_count = ?3, last_reviewed_at = ?4, next_review_at = ?5,
            stability = ?6, difficulty = ?7, elapsed_days = ?8, scheduled_days = ?9,
            lapses = ?10, state = ?11",
        params![
            word_id,
            new_card.state as i64,
            new_card.reps as i64,
            last_reviewed_at,
            next_review_at.clone(),
            new_card.stability,
            new_card.difficulty,
            new_card.elapsed_days,
            new_card.scheduled_days,
            new_card.lapses as i64,
            new_card.state as i64,
        ],
    )
    .await
    .map_err(|e| e.to_string())?;

    db.execute(
        "INSERT INTO daily_streaks (\"date\", quiz_done) VALUES (date('now'), 1)
         ON CONFLICT(\"date\") DO UPDATE SET quiz_done = daily_streaks.quiz_done + 1",
        (),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(ReviewResult {
        next_review_at,
        scheduled_days: new_card.scheduled_days,
        state: state_str,
    })
}
