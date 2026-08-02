/**
 * Reading library (paste/article analysis) — port of desktop
 * `app/core/src/db/reading.rs`: reading_articles + reading_article_comments,
 * with FTS5 search (reading_articles_fts) and the same upsert-by-fingerprint
 * semantics for re-saved articles.
 */
import { Platform } from "react-native";
import { getDb } from "./connection";

/** Rows in the reading library list. `content` is deliberately absent — a
 *  page of 20 articles would otherwise carry a few hundred KB of body text
 *  the list never renders. */
export interface ReadingArticleItem {
  id: number;
  title: string;
  word_count: number;
  source: string;
  source_url: string;
  tags: string;
  created_at: string;
  last_read_at: string;
  comment_count: number;
  /** Matching text around the search term; empty when not searching. */
  snippet: string;
}

export interface ReadingArticleDetail {
  id: number;
  title: string;
  content: string;
  word_count: number;
  source: string;
  source_url: string;
  tags: string;
  created_at: string;
  last_read_at: string;
}

export interface ReadingComment {
  id: number;
  article_id: number;
  author: string;
  body: string;
  /** The sentence this note is about; null means it's about the whole piece. */
  anchor_text: string | null;
  created_at: string;
}

export interface ReadingArticlePage {
  items: ReadingArticleItem[];
  total: number;
}

/**
 * Every whitespace-separated word becomes a quoted prefix term, ANDed
 * together — quoting keeps punctuation in the query from being parsed as
 * FTS5 syntax (a stray `-` or quote otherwise fails the whole query).
 * Port of `fts_match_query`.
 */
export function ftsMatchQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ""))
    .filter((term) => term.length > 0)
    .map((term) => `"${term}"*`)
    .join(" AND ");
}

function wordCountOf(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Saves an article, treating a re-save of the same text as a re-read: the
 * user re-pasting an article they already have should land back on the same
 * entry, not a second copy. Port of `upsert_article`.
 * Returns [id, created].
 */
async function upsertArticle(
  title: string,
  content: string,
  source: string,
  sourceUrl: string,
  tags: string
): Promise<[number, boolean]> {
  const db = getDb();
  // First 200 characters — chars, not bytes, like Rust's .chars().take(200).
  const fingerprint = Array.from(content).slice(0, 200).join("");
  const existing = await db
    .getFirstAsync<{ id: number }>(
      "SELECT id FROM reading_articles WHERE title = ? AND substr(content, 1, 200) = ?",
      [title, fingerprint]
    )
    .catch(() => null);

  if (existing) {
    await db.runAsync("UPDATE reading_articles SET last_read_at = datetime('now') WHERE id = ?", [
      existing.id,
    ]);
    return [existing.id, false];
  }

  const inserted = await db.runAsync(
    "INSERT INTO reading_articles (title, content, word_count, source, source_url, tags) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
    [title, content, wordCountOf(content), source, sourceUrl, tags]
  );
  return [inserted.lastInsertRowId, true];
}

export async function db_save_reading_article(args: {
  title: string;
  content: string;
  source: string;
  sourceUrl?: string | null;
  /** JSON string of a tags array (renderer passes `JSON.stringify(tags)`). */
  tags?: string | null;
}): Promise<number> {
  const [id] = await upsertArticle(
    args.title,
    args.content,
    args.source,
    args.sourceUrl ?? "",
    args.tags ?? "[]"
  );
  return id;
}

/** Lists the library. `search` runs against the FTS index (relevance-ranked,
 *  with a snippet); everything else is a plain filter. */
export async function db_list_reading_articles(args?: {
  search?: string | null;
  source?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  onlyCommented?: boolean | null;
  sort?: "recent" | "added" | "longest" | string | null;
  page?: number | null;
  limit?: number | null;
}): Promise<ReadingArticlePage> {
  const db = getDb();
  const lim = Math.min(100, Math.max(1, args?.limit ?? 20));
  const offset = (args?.page ?? 0) * lim;

  // Rust: search.map(fts_match_query).filter(|terms| !terms.is_empty())
  const searchTermsOpt = args?.search != null ? ftsMatchQuery(args.search) : null;
  const searching = searchTermsOpt != null && searchTermsOpt.length > 0;
  // Web's wa-sqlite build has no FTS5 — the join/bm25/snippet path is native-only.
  const useFts = searching && Platform.OS !== "web";
  // Fallback mirrors ftsMatchQuery's AND-of-terms semantics over the indexed cols.

  let from = "FROM reading_articles a";
  if (useFts) {
    from += " JOIN reading_articles_fts f ON f.rowid = a.id";
  }

  let whereSql = " WHERE 1=1";
  const values: (string | number)[] = [];

  if (useFts) {
    whereSql += " AND reading_articles_fts MATCH ?";
    values.push(searchTermsOpt!);
  } else if (searching) {
    for (const t of (args?.search ?? "").trim().replace(/["*]/g, " ").split(/\s+/).filter(Boolean)) {
      whereSql += " AND (a.title LIKE ? OR a.content LIKE ?)";
      const p = `%${t}%`;
      values.push(p, p);
    }
  }
  const source = args?.source && args.source.length > 0 ? args.source : null;
  if (source !== null) {
    whereSql += " AND a.source = ?";
    values.push(source);
  }
  const dateFrom = args?.dateFrom && args.dateFrom.length > 0 ? args.dateFrom : null;
  if (dateFrom !== null) {
    whereSql += " AND a.last_read_at >= ?";
    values.push(dateFrom);
  }
  const dateTo = args?.dateTo && args.dateTo.length > 0 ? args.dateTo : null;
  if (dateTo !== null) {
    whereSql += " AND a.last_read_at < date(?, '+1 day')";
    values.push(dateTo);
  }
  if (args?.onlyCommented ?? false) {
    whereSql += " AND EXISTS(SELECT 1 FROM reading_article_comments c WHERE c.article_id = a.id)";
  }

  const totalRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n ${from}${whereSql}`,
    values
  );
  const total = totalRow?.n ?? 0;

  // Relevance only means something for a search; otherwise the user picked
  // the order explicitly.
  let order: string;
  if (args?.sort === "added") order = "a.created_at DESC";
  else if (args?.sort === "longest") order = "a.word_count DESC";
  else if (useFts) order = "bm25(reading_articles_fts)";
  else order = "a.last_read_at DESC";
  const snippet = useFts ? "snippet(reading_articles_fts, 1, '', '', '…', 22)" : "''";

  const sql =
    "SELECT a.id, a.title, a.word_count, a.source, a.source_url, a.tags, a.created_at, a.last_read_at, " +
    "(SELECT COUNT(*) FROM reading_article_comments c WHERE c.article_id = a.id) AS comment_count, " +
    `${snippet} AS snippet ` +
    `${from}${whereSql} ` +
    `ORDER BY ${order} ` +
    "LIMIT ? OFFSET ?";
  values.push(lim, offset);

  const rows = await db.getAllAsync<{
    id: number;
    title: string;
    word_count: number;
    source: string;
    source_url: string;
    tags: string;
    created_at: string;
    last_read_at: string;
    comment_count: number;
    snippet: string;
  }>(sql, values);

  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      word_count: r.word_count,
      source: r.source,
      source_url: r.source_url,
      tags: r.tags,
      created_at: r.created_at,
      last_read_at: r.last_read_at,
      comment_count: r.comment_count,
      snippet: r.snippet,
    })),
    total,
  };
}

/** `touch` marks it as read now, which is what the library sorts by. */
export async function db_get_reading_article(args: {
  id: number;
  touch?: boolean | null;
}): Promise<ReadingArticleDetail | null> {
  const db = getDb();
  if (args.touch ?? false) {
    await db.runAsync("UPDATE reading_articles SET last_read_at = datetime('now') WHERE id = ?", [
      args.id,
    ]);
  }
  const row = await db
    .getFirstAsync<ReadingArticleDetail>(
      "SELECT id, title, content, word_count, source, source_url, tags, created_at, last_read_at " +
        "FROM reading_articles WHERE id = ?",
      [args.id]
    )
    .catch(() => null);
  return row;
}

export async function db_delete_reading_article(args: { id: number }): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM reading_article_comments WHERE article_id = ?", [args.id]);
  await db.runAsync("DELETE FROM reading_articles WHERE id = ?", [args.id]);
}

export async function db_list_reading_comments(args: {
  articleId: number;
}): Promise<ReadingComment[]> {
  const db = getDb();
  return db.getAllAsync<ReadingComment>(
    "SELECT id, article_id, author, body, anchor_text, created_at " +
      "FROM reading_article_comments WHERE article_id = ? ORDER BY created_at",
    [args.articleId]
  );
}

/** Port of `insert_comment`. */
export async function db_add_reading_comment(args: {
  articleId: number;
  author: string;
  body: string;
  anchorText?: string | null;
}): Promise<number> {
  const db = getDb();
  const existsRow = await db
    .getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM reading_articles WHERE id = ?", [
      args.articleId,
    ])
    .catch(() => ({ n: 0 }));
  if ((existsRow?.n ?? 0) === 0) {
    throw new Error("Article not found");
  }
  const inserted = await db.runAsync(
    "INSERT INTO reading_article_comments (article_id, author, body, anchor_text) " +
      "VALUES (?, ?, ?, ?)",
    [args.articleId, args.author, args.body, args.anchorText ?? null]
  );
  return inserted.lastInsertRowId;
}

export async function db_delete_reading_comment(args: { id: number }): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM reading_article_comments WHERE id = ?", [args.id]);
}
