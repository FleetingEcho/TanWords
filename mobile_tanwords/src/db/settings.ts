/**
 * Generic key/value settings — port of the `user_settings` helpers
 * (`get_setting` / `set_setting`) and the standalone counters from desktop
 * `app/core/src/db/settings.rs`. Desktop's profile/backup/Turso commands in
 * the same file stay out of this module: profiles live in
 * `src/db/connection.tsx` on mobile.
 */
import { getDb } from "./connection";

export async function db_get_setting(args: { key: string }): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [args.key]
  );
  return row ? row.value : null;
}

export async function db_set_setting(args: { key: string; value: string }): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
    [args.key, args.value]
  );
}

export async function db_get_word_count(): Promise<number> {
  const db = getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM words");
  return row?.n ?? 0;
}
