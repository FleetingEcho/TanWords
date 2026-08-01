/**
 * Dictionary recent-lookup history — port of desktop
 * `app/core/src/db/search_history.rs`.
 */
import { getDb } from "./connection";
import type { SearchHistoryItem } from "@/hooks/useDB.types";

const RECENT_LIMIT = 50;

/**
 * Records a dictionary lookup, or bumps it to the top if the word was
 * searched before — the list is "recent distinct words", not a raw log.
 *
 * Re-searching deletes and re-inserts rather than updating searched_at in
 * place: CURRENT_TIMESTAMP is only second-resolution, so two lookups within
 * the same second would tie and sort arbitrarily. A fresh autoincrement id
 * is a reliable recency order regardless of clock resolution.
 */
export async function db_add_search_history(args: { word: string }): Promise<void> {
  const word = args.word.trim().toLowerCase();
  if (word.length === 0) {
    return;
  }
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM search_history WHERE word = ?", [word]);
    await db.runAsync(
      "INSERT INTO search_history (word, searched_at) VALUES (?, CURRENT_TIMESTAMP)",
      [word]
    );
  });
}

/** The most recent lookups, each flagged with whether the word is (now, not
 *  necessarily at search time) in the vocabulary — computed fresh on every
 *  read so it can't go stale if the word was added via a different route. */
export async function db_get_search_history(): Promise<SearchHistoryItem[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{ word: string; searched_at: string; in_vocab: number }>(
    "SELECT sh.word, sh.searched_at, " +
      "EXISTS(SELECT 1 FROM words w WHERE w.word = sh.word) AS in_vocab " +
      "FROM search_history sh " +
      "ORDER BY sh.searched_at DESC, sh.id DESC " +
      "LIMIT ?",
    [RECENT_LIMIT]
  );
  return rows.map((r) => ({
    word: r.word,
    searched_at: r.searched_at,
    in_vocab: r.in_vocab !== 0,
  }));
}

export async function db_clear_search_history(): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM search_history");
}
