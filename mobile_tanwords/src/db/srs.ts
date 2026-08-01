/**
 * FSRS review scheduling — port of desktop `app/core/src/db/srs.rs`,
 * rs-fsrs → ts-fsrs. Shares the `srs_records` table with the desktop app:
 * State discriminants are 0=New, 1=Learning, 2=Review, 3=Relearning in both
 * crates, and `rating` is the desktop's "again" | "hard" | "good" (numbers
 * 1..4, "easy" included, are accepted as an extension).
 */
import { fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";
import { getDb } from "./connection";
import type { DueCard, ReviewResult, SrsRating, SrsState } from "@/hooks/useDB.types";

/** Words introduced per db_get_due_cards call when the reviewer isn't
 *  working through a review backlog — keeps a big vocabulary from dumping
 *  hundreds of "new" cards into one session. */
export const DEFAULT_NEW_LIMIT = 20;

function stateToStr(state: State): SrsState {
  switch (state) {
    case State.Learning:
      return "learning";
    case State.Review:
      return "review";
    case State.Relearning:
      return "relearning";
    default:
      return "new";
  }
}

function stateFromInt(v: number): State {
  switch (v) {
    case 1:
      return State.Learning;
    case 2:
      return State.Review;
    case 3:
      return State.Relearning;
    default:
      return State.New;
  }
}

function dtToSql(dt: Date): string {
  // RFC3339, like Rust's to_rfc3339() — "Z" instead of "+00:00", same instant,
  // and sqlToDt below parses both forms.
  return dt.toISOString();
}

/**
 * Port of `sql_to_dt`. Stored values are RFC3339 (written by dtToSql, desktop
 * or mobile) or SQLite's default datetime('now') format
 * ("YYYY-MM-DD HH:MM:SS", UTC without a marker) for rows never touched by
 * FSRS. Both are parsed WITHOUT leaning on the JS engine's lenient Date
 * parsing (which would read the naive form as local time); anything
 * unrecognized falls back to now, like the Rust code.
 */
export function sqlToDt(s: string): Date {
  const rfc3339 = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})$/
  );
  if (rfc3339) {
    const [, y, mo, d, h, mi, se, frac, tz] = rfc3339;
    let ms = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(se),
      frac ? Math.round(Number(frac) * 1000) : 0
    );
    if (tz.toUpperCase() !== "Z") {
      const sign = tz.startsWith("-") ? -1 : 1;
      const digits = tz.replace(/[^0-9]/g, "");
      const offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
      ms -= offsetMin * 60_000;
    }
    return new Date(ms);
  }
  const naive = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (naive) {
    const [, y, mo, d, h, mi, se] = naive;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)));
  }
  return new Date();
}

function ratingFromInput(rating: SrsRating | "easy" | 1 | 2 | 3 | 4): Grade {
  switch (rating) {
    case "again":
    case 1:
      return Rating.Again;
    case "hard":
    case 2:
      return Rating.Hard;
    case "good":
    case 3:
      return Rating.Good;
    case "easy":
    case 4:
      return Rating.Easy;
    default:
      throw new Error(`invalid rating: ${rating} (expected again/hard/good)`);
  }
}

/**
 * Count of cards ready for review right now: the due backlog plus a capped
 * batch of never-reviewed words, using the same cap as db_get_due_cards'
 * default so the Dashboard badge matches what opening the reviewer shows.
 *
 * Compares dates in JS rather than SQL because next_review_at may hold either
 * RFC3339 (written by db_review_card) or SQLite's own datetime() format
 * (written by the older db_save_quiz_result path) — the two don't sort
 * correctly against each other as raw strings.
 */
export async function db_get_review_count(): Promise<number> {
  const db = getDb();
  const now = Date.now();

  const dueRows = await db.getAllAsync<{ next_review_at: string }>(
    "SELECT next_review_at FROM srs_records WHERE entity_type = 'word' AND next_review_at IS NOT NULL"
  );
  const dueCount = dueRows.filter((r) => sqlToDt(r.next_review_at).getTime() <= now).length;

  const newRow = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM words w LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word' WHERE sr.id IS NULL"
  );
  const newCount = newRow?.n ?? 0;

  return dueCount + Math.min(newCount, DEFAULT_NEW_LIMIT);
}

const ZH_EXPR =
  "COALESCE((SELECT wd.zh FROM word_definitions wd WHERE wd.word_id = w.id ORDER BY wd.sort_order LIMIT 1), '')";
const CONTEXT_EXPR =
  "COALESCE(" +
  "(SELECT wd.example_en FROM word_definitions wd " +
  "WHERE wd.word_id = w.id AND wd.example_en IS NOT NULL AND wd.example_en != '' " +
  "ORDER BY wd.sort_order LIMIT 1), " +
  "''" +
  ")";

export async function db_get_due_cards(args?: { newLimit?: number | null }): Promise<DueCard[]> {
  const db = getDb();
  const newLimit = args?.newLimit ?? DEFAULT_NEW_LIMIT;

  const result: DueCard[] = [];

  // Backlog: previously-scheduled reviews that are now due.
  const dueRows = await db.getAllAsync<{
    id: number;
    word: string;
    zh: string;
    level: string | null;
    context_sentence: string;
    state: number;
  }>(
    `SELECT w.id, w.word, ${ZH_EXPR} AS zh, w.level, ${CONTEXT_EXPR} AS context_sentence, sr.state
     FROM words w
     JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
     WHERE sr.next_review_at <= ?
     ORDER BY sr.next_review_at ASC`,
    [dtToSql(new Date())]
  );
  for (const r of dueRows) {
    result.push({
      word_id: r.id,
      word: r.word,
      zh: r.zh,
      level: r.level,
      context_sentence: r.context_sentence,
      state: stateToStr(stateFromInt(r.state)),
    });
  }

  // New: words never reviewed, capped so a big vocabulary doesn't flood the session.
  const newRows = await db.getAllAsync<{
    id: number;
    word: string;
    zh: string;
    level: string | null;
    context_sentence: string;
  }>(
    `SELECT w.id, w.word, ${ZH_EXPR} AS zh, w.level, ${CONTEXT_EXPR} AS context_sentence
     FROM words w
     LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word'
     WHERE sr.id IS NULL
     ORDER BY w.created_at ASC
     LIMIT ?`,
    [newLimit]
  );
  for (const r of newRows) {
    result.push({
      word_id: r.id,
      word: r.word,
      zh: r.zh,
      level: r.level,
      context_sentence: r.context_sentence,
      state: "new",
    });
  }

  return result;
}

export async function db_review_card(args: {
  wordId: number;
  rating: SrsRating | "easy" | 1 | 2 | 3 | 4;
}): Promise<ReviewResult> {
  const db = getDb();
  const rating = ratingFromInput(args.rating);

  const row = await db.getFirstAsync<{
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    review_count: number;
    lapses: number;
    next_review_at: string | null;
    last_reviewed_at: string | null;
    state: number;
  }>(
    "SELECT stability, difficulty, elapsed_days, scheduled_days, review_count, lapses, next_review_at, last_reviewed_at, state " +
      "FROM srs_records WHERE entity_id = ? AND entity_type = 'word'",
    [args.wordId]
  );

  const now = new Date();
  const card: Card = row
    ? {
        due: row.next_review_at ? sqlToDt(row.next_review_at) : now,
        stability: row.stability,
        difficulty: row.difficulty,
        elapsed_days: row.elapsed_days,
        scheduled_days: row.scheduled_days,
        learning_steps: 0,
        reps: row.review_count,
        lapses: row.lapses,
        state: stateFromInt(row.state),
        last_review: row.last_reviewed_at ? sqlToDt(row.last_reviewed_at) : now,
      }
    : {
        // rs-fsrs Card::new(): due/last_review = now, everything else zeroed.
        due: now,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        state: State.New,
        last_review: now,
      };

  const f = fsrs();
  const newCard = f.repeat(card, now)[rating].card;

  const nextReviewAt = dtToSql(newCard.due);
  const lastReviewedAt = dtToSql(newCard.last_review ?? now);
  const stateStr = stateToStr(newCard.state);
  const stateInt = newCard.state as number;

  await db.runAsync(
    "INSERT INTO srs_records " +
      "(entity_id, entity_type, srs_level, srs_ease, review_count, last_reviewed_at, next_review_at, " +
      "stability, difficulty, elapsed_days, scheduled_days, lapses, state) " +
      "VALUES (?, 'word', ?, 2.5, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(entity_id, entity_type) DO UPDATE SET " +
      "srs_level = ?, review_count = ?, last_reviewed_at = ?, next_review_at = ?, " +
      "stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, " +
      "lapses = ?, state = ?",
    [
      args.wordId,
      stateInt,
      newCard.reps,
      lastReviewedAt,
      nextReviewAt,
      newCard.stability,
      newCard.difficulty,
      newCard.elapsed_days,
      newCard.scheduled_days,
      newCard.lapses,
      stateInt,
      stateInt,
      newCard.reps,
      lastReviewedAt,
      nextReviewAt,
      newCard.stability,
      newCard.difficulty,
      newCard.elapsed_days,
      newCard.scheduled_days,
      newCard.lapses,
      stateInt,
    ]
  );

  await db.runAsync(
    "INSERT INTO daily_streaks (date, quiz_done) VALUES (date('now'), 1) " +
      "ON CONFLICT(date) DO UPDATE SET quiz_done = quiz_done + 1"
  );

  return {
    next_review_at: nextReviewAt,
    scheduled_days: newCard.scheduled_days,
    state: stateStr,
  };
}
