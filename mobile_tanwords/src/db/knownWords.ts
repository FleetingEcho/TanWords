/**
 * "Already know this word" marks — port of the `user_known_words` commands
 * from desktop `app/core/src/db/articles.rs`
 * (`db_add_known_words` / `db_get_known_words`).
 */
import { getDb } from "./connection";

export async function db_add_known_words(args: {
  words: string[];
  source?: string;
}): Promise<void> {
  const db = getDb();
  const source = args.source ?? "marked";
  await db.withTransactionAsync(async () => {
    for (const word of args.words) {
      await db.runAsync("INSERT OR IGNORE INTO user_known_words (word, source) VALUES (?, ?)", [
        word.toLowerCase(),
        source,
      ]);
    }
  });
}

export async function db_get_known_words(): Promise<string[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{ word: string }>(
    "SELECT word FROM user_known_words ORDER BY created_at DESC"
  );
  return rows.map((r) => r.word);
}
