/**
 * Dashboard aggregates — port of desktop `app/core/src/db/dashboard.rs`
 * (`db_dashboard_stats`). Result shape: DashboardStats in `@/hooks/useDB.types`.
 */
import { getDb } from "./connection";
import type { DashboardStats } from "@/hooks/useDB.types";

async function countRows(sql: string): Promise<number> {
  const db = getDb();
  const row = await db.getFirstAsync<{ n: number }>(sql);
  return row?.n ?? 0;
}

/** The four totals the dashboard tiles show, plus the lists its cards read. */
export async function db_dashboard_stats(): Promise<DashboardStats> {
  const db = getDb();

  const wordCount = await countRows("SELECT COUNT(*) AS n FROM words");
  const patternCount = await countRows("SELECT COUNT(*) AS n FROM patterns");
  const chatCount = await countRows("SELECT COUNT(*) AS n FROM ai_chat_sessions");
  const docCount = await countRows("SELECT COUNT(*) AS n FROM documents");

  const recentWords = await db.getAllAsync<{
    id: number;
    word: string;
    zh: string;
    level: string;
    updated_at: string;
  }>(
    "SELECT w.id, w.word, " +
      "COALESCE((SELECT zh FROM word_definitions d " +
      "WHERE d.word_id = w.id ORDER BY d.sort_order, d.id LIMIT 1), '') AS zh, " +
      "COALESCE(w.level, '') AS level, " +
      "w.updated_at " +
      "FROM words w ORDER BY w.updated_at DESC, w.id DESC LIMIT 5"
  );

  // 5, matching DASHBOARD_BODY_ROWS in the desktop renderer's DashboardCard —
  // the grid's cards are a fixed five rows tall.
  const recentDocs = await db.getAllAsync<{ id: number; title: string; updated_at: string }>(
    "SELECT id, title, updated_at FROM documents ORDER BY updated_at DESC LIMIT 5"
  );

  return {
    word_count: wordCount,
    pattern_count: patternCount,
    chat_count: chatCount,
    doc_count: docCount,
    recent_words: recentWords,
    recent_docs: recentDocs,
  };
}
