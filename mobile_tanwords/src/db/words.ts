/**
 * Vocabulary persistence — port of desktop `app/core/src/db/words_query.rs`
 * + `words_write.rs` (+ `words_types.rs` shapes). Same SQL, same semantics;
 * `?N` positional binds become plain `?` (expo-sqlite style).
 *
 * Row types match the renderer interfaces in `@/hooks/useDB.types`.
 */
import { getDb } from "./connection";
import type { EnrichmentInput, WordDetail, WordListItem } from "@/hooks/useDB.types";

// ── Query result structs (words_types.rs) ────────────────────────────────────

export interface WordDefItem {
  pos: string;
  zh: string;
  en: string | null;
  example_en: string | null;
  example_zh: string | null;
}

export interface AddWordResult {
  id: number;
  isNew: boolean;
}

export interface WordExtras {
  notes: string;
  messages: string;
}

/** Batch add payload (db_add_words_batch). Field names stay snake_case —
 *  Rust's NewVocabWord has no camelCase rename and the renderer posts
 *  `word_type` / `context` verbatim. */
export interface NewVocabWord {
  word: string;
  zh: string;
  word_type?: string | null;
  level?: string | null;
  context?: string | null;
}

export interface BatchAddResult {
  added: number;
  skipped: number;
}

// ── Reads (words_query.rs) ───────────────────────────────────────────────────

export async function db_get_words(args?: {
  search?: string | null;
  levelFilter?: string | null;
  sortBy?: string | null;
  /** Which timestamp the date range filters on — defaults to "created". */
  dateField?: "created" | "updated" | string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<WordListItem[]> {
  const db = getDb();

  let sql =
    "SELECT w.id, w.word, w.word_type, w.level, w.word_freq, " +
    "COALESCE((SELECT wd.zh FROM word_definitions wd WHERE wd.word_id = w.id ORDER BY wd.sort_order LIMIT 1), '') as zh, " +
    "COALESCE(sr.srs_level, 0) as srs_level, " +
    "sr.next_review_at, " +
    "w.created_at, " +
    "w.updated_at, " +
    "COALESCE(w.source, 'manual') as source, " +
    "(w.enrichment_text IS NOT NULL) as enriched, " +
    "w.starred " +
    "FROM words w " +
    "LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word' " +
    "WHERE 1=1";

  const values: (string | number)[] = [];

  const search = args?.search ?? null;
  if (search !== null) {
    // One shared bind in Rust (?1 twice) → two binds here.
    sql += " AND (w.word LIKE ? OR EXISTS (SELECT 1 FROM word_definitions wd2 WHERE wd2.word_id = w.id AND wd2.zh LIKE ?))";
    values.push(`%${search}%`, `%${search}%`);
  }

  const levelFilter = args?.levelFilter ?? null;
  if (levelFilter !== null) {
    if (levelFilter === "B1-") {
      sql += " AND w.level IN ('B1', 'A2', 'A1')";
    } else {
      sql += " AND w.level = ?";
      values.push(levelFilter);
    }
  }

  // Date-range filter, on either created_at or updated_at (default created_at).
  const dateCol = args?.dateField === "updated" ? "w.updated_at" : "w.created_at";
  const dateFrom = args?.dateFrom ?? null;
  if (dateFrom !== null) {
    sql += ` AND ${dateCol} >= ?`;
    values.push(dateFrom);
  }
  const dateTo = args?.dateTo ?? null;
  if (dateTo !== null) {
    sql += ` AND ${dateCol} <= ?`;
    values.push(`${dateTo} 23:59:59`);
  }

  switch (args?.sortBy) {
    case "freq":
      sql += " ORDER BY w.word_freq DESC, w.created_at DESC";
      break;
    case "alpha":
      sql += " ORDER BY w.word COLLATE NOCASE ASC";
      break;
    default:
      // "recent" — see the Rust source for why updated_at alone works here.
      sql += " ORDER BY w.updated_at DESC";
  }

  const rows = await db.getAllAsync<{
    id: number;
    word: string;
    word_type: string | null;
    level: string | null;
    word_freq: number;
    zh: string;
    srs_level: number;
    next_review_at: string | null;
    created_at: string;
    updated_at: string;
    source: string;
    enriched: number;
    starred: number;
  }>(sql, values);

  return rows.map((r) => ({
    id: r.id,
    word: r.word,
    word_type: r.word_type,
    level: r.level,
    word_freq: r.word_freq,
    zh: r.zh,
    srs_level: r.srs_level,
    next_review_at: r.next_review_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    source: r.source,
    enriched: r.enriched !== 0,
    starred: r.starred !== 0,
  }));
}

export async function db_get_word_detail(args: { wordId: number }): Promise<WordDetail> {
  const db = getDb();
  const { wordId } = args;

  const word = await db.getFirstAsync<{
    id: number;
    word: string;
    word_type: string | null;
    level: string | null;
    word_freq: number;
    mnemonic: string | null;
    notes: string | null;
    source: string;
    created_at: string;
    srs_level: number;
    next_review_at: string | null;
    enrichment_text: string | null;
    enrichment_json: string | null;
  }>(
    "SELECT w.id, w.word, w.word_type, w.level, w.word_freq, w.mnemonic, w.notes, w.source, w.created_at, " +
      "COALESCE(sr.srs_level, 0) AS srs_level, sr.next_review_at, w.enrichment_text, w.enrichment_json " +
      "FROM words w " +
      "LEFT JOIN srs_records sr ON sr.entity_id = w.id AND sr.entity_type = 'word' " +
      "WHERE w.id = ?",
    [wordId]
  );
  if (!word) throw new Error("Word not found: no rows returned");

  const definitions = await db.getAllAsync<WordDefItem>(
    "SELECT pos, zh, en, example_en, example_zh " +
      "FROM word_definitions WHERE word_id = ? ORDER BY sort_order",
    [wordId]
  );

  return {
    id: word.id,
    word: word.word,
    word_type: word.word_type,
    level: word.level,
    word_freq: word.word_freq,
    mnemonic: word.mnemonic,
    notes: word.notes,
    source: word.source,
    srs_level: word.srs_level,
    next_review_at: word.next_review_at,
    created_at: word.created_at,
    definitions,
    enrichment_text: word.enrichment_text,
    enrichment_json: word.enrichment_json,
  };
}

// ── Writes (words_write.rs) ──────────────────────────────────────────────────

export async function db_add_word(args: {
  word: string;
  wordType?: string | null;
  level?: string | null;
  zh: string;
}): Promise<AddWordResult> {
  const db = getDb();
  const { word, zh } = args;
  const wordType = args.wordType ?? null;
  const level = args.level ?? null;

  const inserted = await db.runAsync(
    "INSERT OR IGNORE INTO words (word, word_type, level, word_freq, source) VALUES (?, ?, ?, 1, 'manual')",
    [word, wordType, level]
  );

  const isNew = inserted.changes > 0;

  let wordId: number;
  if (isNew) {
    wordId = inserted.lastInsertRowId;
  } else {
    const row = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM words WHERE word = ?",
      [word]
    );
    if (!row) throw new Error("no rows returned");
    wordId = row.id;
  }

  await db.runAsync(
    "INSERT OR IGNORE INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?, 'other', ?, 0)",
    [wordId, zh]
  );

  await db.runAsync(
    "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?, 'word', 0, 2.5)",
    [wordId]
  );

  if (isNew) {
    await db.runAsync(
      "INSERT INTO daily_streaks (date, words_added) VALUES (date('now'), 1) " +
        "ON CONFLICT(date) DO UPDATE SET words_added = words_added + 1"
    );
  }

  return { id: wordId, isNew };
}

export async function db_delete_word(args: { wordId: number }): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM words WHERE id = ?", [args.wordId]);
}

export async function db_delete_words_batch(args: { wordIds: number[] }): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const wordId of args.wordIds) {
      await db.runAsync("DELETE FROM words WHERE id = ?", [wordId]);
    }
  });
}

export async function db_set_word_starred(args: { wordId: number; starred: boolean }): Promise<void> {
  const db = getDb();
  await db.runAsync("UPDATE words SET starred = ? WHERE id = ?", [
    args.starred ? 1 : 0,
    args.wordId,
  ]);
}

export async function db_add_word_enriched(args: {
  word: string;
  zh: string;
  wordType?: string | null;
  enrichment: EnrichmentInput;
}): Promise<AddWordResult> {
  const db = getDb();
  const { word, zh, enrichment } = args;
  const wordType = args.wordType ?? null;
  const enrichmentLevel = enrichment.level ?? null;

  let result: AddWordResult = { id: 0, isNew: false };
  await db.withTransactionAsync(async () => {
    const inserted = await db.runAsync(
      "INSERT OR IGNORE INTO words (word, word_type, level, word_freq, source) VALUES (?, ?, ?, 1, 'ai')",
      [word, wordType, enrichmentLevel]
    );

    const isNew = inserted.changes > 0;

    let wordId: number;
    if (isNew) {
      wordId = inserted.lastInsertRowId;
    } else {
      const row = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM words WHERE word = ?",
        [word]
      );
      if (!row) throw new Error("no rows returned");
      wordId = row.id;
    }

    // Don't clobber a level/word_type a caller (e.g. Reading) already supplied.
    if (!isNew) {
      await db.runAsync(
        "UPDATE words SET level = COALESCE(level, ?), word_type = COALESCE(word_type, ?) WHERE id = ?",
        [enrichmentLevel, wordType, wordId]
      );
    }

    // Seed (or backfill) a short gloss for quiz cards. See the Rust source for
    // the full reasoning: prefer the AI-parsed gloss, fall back to `zh`, and
    // don't let an existing *empty* gloss block future fixes.
    const existing = await db.getFirstAsync<{ zh: string | null }>(
      "SELECT zh FROM word_definitions WHERE word_id = ? ORDER BY sort_order LIMIT 1",
      [wordId]
    );
    const existingZh = existing ? existing.zh : null;
    const needsGloss = existingZh === null || existingZh.trim().length === 0;
    if (needsGloss) {
      const gloss =
        enrichment.zhShort && enrichment.zhShort.trim().length > 0
          ? enrichment.zhShort
          : zh;
      if (existing) {
        await db.runAsync(
          "UPDATE word_definitions SET zh = ? WHERE word_id = ? AND (zh IS NULL OR TRIM(zh) = '')",
          [gloss, wordId]
        );
      } else {
        await db.runAsync(
          "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?, 'other', ?, 0)",
          [wordId, gloss]
        );
      }
    }

    await db.runAsync(
      "UPDATE words SET enrichment_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [enrichment.text, wordId]
    );

    await db.runAsync(
      "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?, 'word', 0, 2.5)",
      [wordId]
    );

    if (isNew) {
      await db.runAsync(
        "INSERT INTO daily_streaks (date, words_added) VALUES (date('now'), 1) ON CONFLICT(date) DO UPDATE SET words_added = words_added + 1"
      );
    }

    result = { id: wordId, isNew };
  });
  return result;
}

// ── Word Notes & Chat ────────────────────────────────────────────────────────

export async function db_get_word_extras(args: { wordId: number }): Promise<WordExtras> {
  const db = getDb();
  const { wordId } = args;

  const notesRow = await db
    .getFirstAsync<{ notes: string }>("SELECT COALESCE(user_notes, '') AS notes FROM words WHERE id = ?", [wordId])
    .catch(() => null);
  const chatRow = await db
    .getFirstAsync<{ messages: string }>("SELECT messages FROM word_chats WHERE word_id = ?", [wordId])
    .catch(() => null);

  return {
    notes: notesRow?.notes ?? "",
    messages: chatRow?.messages ?? "[]",
  };
}

export async function db_save_word_notes(args: { wordId: number; notes: string }): Promise<void> {
  const db = getDb();
  await db.runAsync("UPDATE words SET user_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    args.notes,
    args.wordId,
  ]);
}

export async function db_save_word_chat(args: { wordId: number; messages: string }): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT INTO word_chats (word_id, messages, updated_at) " +
      "VALUES (?, ?, CURRENT_TIMESTAMP) " +
      "ON CONFLICT(word_id) DO UPDATE SET messages = ?, updated_at = CURRENT_TIMESTAMP",
    [args.wordId, args.messages, args.messages]
  );
}

// ── Batch add (used by AI Chat vocabulary tools + future batch import) ──────

export async function db_add_words_batch(args: {
  words: NewVocabWord[];
  source: string;
  tag?: string | null;
}): Promise<BatchAddResult> {
  const db = getDb();
  const { words, source } = args;

  const tagsJson = args.tag && args.tag.trim().length > 0 ? JSON.stringify([args.tag]) : "[]";

  let added = 0;
  let skipped = 0;
  await db.withTransactionAsync(async () => {
    for (const w of words) {
      const wordLower = w.word.trim().toLowerCase();
      if (!wordLower) continue;
      const inserted = await db.runAsync(
        "INSERT OR IGNORE INTO words (word, word_type, level, word_freq, source, tags) VALUES (?, ?, ?, 1, ?, ?)",
        [wordLower, w.word_type ?? null, w.level ?? null, source, tagsJson]
      );
      if (inserted.changes > 0) {
        added += 1;
        await db.runAsync(
          "INSERT OR IGNORE INTO word_definitions (word_id, pos, zh, example_en, sort_order) VALUES (?, 'other', ?, ?, 0)",
          [inserted.lastInsertRowId, w.zh, w.context ?? null]
        );
      } else {
        skipped += 1;
      }
    }
  });
  return { added, skipped };
}
