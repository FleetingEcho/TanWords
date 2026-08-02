/** SQLite's CURRENT_TIMESTAMP / datetime('now') store UTC as "YYYY-MM-DD HH:MM:SS"
 *  with no zone marker. `new Date()` treats that space-separated form as local
 *  time (not UTC), so every value silently shifts by the user's UTC offset —
 *  e.g. a session saved 3 hours ago can land in the wrong day bucket. Convert
 *  to a "T…Z" string first so it parses as the UTC instant it actually is. */
export function parseDbTimestamp(raw: string): Date {
  return new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
}
