/**
 * Sentence-pattern library — port of desktop `app/core/src/db/patterns.rs`.
 * Same SQL; type shapes mirror the renderer's useDB.patterns.ts.
 */
import { getDb } from "./connection";

export interface SavePatternResult {
  pattern_id: number;
  created: boolean;
}

export interface PatternExampleItem {
  id: number;
  sentence: string;
  source: string;
}

export interface PatternItem {
  id: number;
  pattern: string;
  zh: string;
  note: string;
  level: string | null;
  starred: boolean;
  created_at: string;
  updated_at: string;
  examples: PatternExampleItem[];
}

export async function db_list_patterns(): Promise<PatternItem[]> {
  const db = getDb();
  const patterns = (
    await db.getAllAsync<{
      id: number;
      pattern: string;
      zh: string;
      note: string;
      level: string | null;
      starred: number;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT id,pattern,zh,note,level,starred,created_at,updated_at FROM patterns ORDER BY created_at DESC, id DESC"
    )
  ).map((r) => ({
    id: r.id,
    pattern: r.pattern,
    zh: r.zh,
    note: r.note,
    level: r.level,
    starred: r.starred !== 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
    examples: [] as PatternExampleItem[],
  }));

  const examples = await db.getAllAsync<{
    id: number;
    pattern_id: number;
    sentence: string;
    source: string;
  }>("SELECT id,pattern_id,sentence,source FROM pattern_examples ORDER BY id");

  for (const e of examples) {
    const p = patterns.find((item) => item.id === e.pattern_id);
    if (p) p.examples.push({ id: e.id, sentence: e.sentence, source: e.source });
  }
  return patterns;
}

export async function db_delete_pattern(args: { patternId: number }): Promise<void> {
  const db = getDb();
  const { patternId } = args;
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM pattern_practice WHERE pattern_id=?", [patternId]);
    await db.runAsync("DELETE FROM pattern_examples WHERE pattern_id=?", [patternId]);
    await db.runAsync("DELETE FROM patterns WHERE id=?", [patternId]);
  });
}

export async function db_set_pattern_starred(args: {
  patternId: number;
  starred: boolean;
}): Promise<void> {
  const db = getDb();
  await db.runAsync("UPDATE patterns SET starred = ? WHERE id = ?", [
    args.starred ? 1 : 0,
    args.patternId,
  ]);
}

/** Overwrite a saved sentence's AI-derived analysis (translation, skeleton,
 *  note, level) in place — used by the re-analyze action; the example
 *  sentences themselves are untouched. */
export async function db_update_pattern_analysis(args: {
  patternId: number;
  zh: string;
  skeleton: string;
  note: string;
  level: string;
}): Promise<void> {
  const db = getDb();
  const level = args.level.trim();
  await db.runAsync(
    "UPDATE patterns SET pattern=?, zh=?, note=?, level=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [args.skeleton, args.zh, args.note, level.length > 0 ? level : null, args.patternId]
  );
}

/** Save a full sentence into the sentence-pattern library (patterns +
 *  pattern_examples), deduplicating by the exact example sentence. */
export async function db_save_sentence_pattern(args: {
  sentence: string;
  zh: string;
  skeleton: string;
  note: string;
  level: string;
  source: string;
}): Promise<SavePatternResult> {
  const db = getDb();
  const sentence = args.sentence.trim();
  if (sentence.length === 0) {
    throw new Error("empty sentence");
  }

  let result: SavePatternResult = { pattern_id: 0, created: false };
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ pattern_id: number }>(
      "SELECT pattern_id FROM pattern_examples WHERE sentence=? LIMIT 1",
      [sentence]
    );
    if (existing) {
      result = { pattern_id: existing.pattern_id, created: false };
      return;
    }
    const skeleton = args.skeleton.trim();
    const patternText = skeleton.length === 0 ? sentence : skeleton;
    const level = args.level.trim();
    const inserted = await db.runAsync(
      "INSERT INTO patterns(pattern,zh,function_tag,level,note,updated_at) VALUES(?,?,'other',?,?,CURRENT_TIMESTAMP)",
      [patternText, args.zh, level.length > 0 ? level : null, args.note]
    );
    const patternId = inserted.lastInsertRowId;
    await db.runAsync("INSERT INTO pattern_examples(pattern_id,sentence,source) VALUES(?,?,?)", [
      patternId,
      sentence,
      args.source,
    ]);
    result = { pattern_id: patternId, created: true };
  });
  return result;
}
