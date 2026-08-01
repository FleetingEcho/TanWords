/** Display helpers shared by the docs list and editor. */

/** SQLite `datetime('now')` strings are UTC ("YYYY-MM-DD HH:MM:SS") — parse
 *  as UTC so relative display isn't shifted, like desktop's sql_to_dt. */
export function parseSqliteUtc(s: string): Date | null {
  if (!s) return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** List-row timestamp: HH:MM today, MM-DD this year, YYYY-MM-DD older. */
export function formatUpdatedAt(s: string, isZh: boolean): string {
  const d = parseSqliteUtc(s);
  if (!d) return s;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 字数 — count non-whitespace characters (Chinese-first) plus western words:
 *  "hello world 你好" → 2 words + 2 chars. Mirrors the doc.wordCount display. */
export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const latinWords = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  return cjk + latinWords;
}

/** Strip blank whitespace for preview snippets. */
export function snippetOf(contentText: string, max = 80): string {
  const flat = contentText.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}
