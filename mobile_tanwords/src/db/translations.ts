/**
 * Translation history — port of desktop `app/core/src/db/translations.rs`
 * plus the two translation commands that live in `settings.rs`
 * (`db_get_translation_count`, `db_clear_translations`).
 */
import { getDb } from "./connection";
import type { TranslationItem } from "@/hooks/useDB.types";

export async function db_save_translation(args: {
  sourceText: string;
  resultText: string;
  sourceLang?: string | null;
  targetLang: string;
  provider: string;
  mode: string;
}): Promise<number> {
  const db = getDb();
  const inserted = await db.runAsync(
    "INSERT INTO translations (source_text, result_text, source_lang, target_lang, provider, mode) VALUES (?, ?, ?, ?, ?, ?)",
    [args.sourceText, args.resultText, args.sourceLang ?? null, args.targetLang, args.provider, args.mode]
  );

  await db.runAsync(
    "INSERT INTO daily_streaks (date, translations) VALUES (date('now'), 1) " +
      "ON CONFLICT(date) DO UPDATE SET translations = translations + 1"
  );

  return inserted.lastInsertRowId;
}

export async function db_get_translations(args?: {
  search?: string | null;
  cluster?: string | null;
}): Promise<TranslationItem[]> {
  const db = getDb();

  let sql =
    "SELECT id, source_text, result_text, source_lang, target_lang, provider, mode, cluster_tag, created_at " +
    "FROM translations WHERE 1=1";

  const values: string[] = [];

  const search = args?.search ?? null;
  if (search !== null) {
    // One shared bind in Rust (?N twice) → two binds here.
    sql += " AND (source_text LIKE ? OR result_text LIKE ?)";
    values.push(`%${search}%`, `%${search}%`);
  }

  const cluster = args?.cluster ?? null;
  if (cluster !== null) {
    sql += " AND cluster_tag = ?";
    values.push(cluster);
  }

  sql += " ORDER BY created_at DESC LIMIT 200";

  return db.getAllAsync<TranslationItem>(sql, values);
}

export async function db_get_translation_count(): Promise<number> {
  const db = getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM translations");
  return row?.n ?? 0;
}

export async function db_clear_translations(): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM translations");
}
