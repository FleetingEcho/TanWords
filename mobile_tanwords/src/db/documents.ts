/**
 * Documents DB — port of desktop `app/core/src/db/documents/crud.rs`.
 *
 * Deliberate differences from desktop (mobile v1 scope):
 *  - Desktop stores BlockNote block JSON in `documents.content`; mobile's
 *    markdown editor writes plain text into BOTH `content` and `content_text`
 *    (same columns, FTS + desktop display keep working).
 *  - Search uses the `documents_fts` FTS5 index (title + content_text) with
 *    bm25 ranking + snippets, same pattern as src/db/reading.ts. Desktop's
 *    ordered-character LIKE fuzzy match is not ported.
 *  - Protected documents stay opaque (desktop encrypts content_text at rest);
 *    callers must check `protected` before opening the editor.
 *  - document_privacy (lock/wrap) is not ported on mobile v1; updates to
 *    protected rows never happen because the editor refuses to open them.
 */
import { getDb } from "./connection";
import { ftsMatchQuery } from "./reading";

export interface DocumentListItem {
  id: number;
  title: string;
  /** JSON array string, e.g. '["tag"]' — desktop format. */
  tags: string;
  pinned: boolean;
  word_count: number;
  created_at: string;
  updated_at: string;
  content_text: string;
  protected: boolean;
  /** FTS match context (filled only when searching, else ""). */
  snippet: string;
}

export interface DocumentDetail {
  id: number;
  title: string;
  content: string;
  content_text: string;
  tags: string;
  pinned: boolean;
  word_count: number;
  created_at: string;
  updated_at: string;
  protected: boolean;
}

export interface DocumentListResult {
  items: DocumentListItem[];
  total: number;
}

export type DocumentSort = "updated" | "created" | "title";

interface DocRow {
  id: number;
  title: string;
  tags: string;
  pinned: number;
  word_count: number;
  created_at: string;
  updated_at: string;
  content_text: string;
  protected: number;
  snippet: string;
}

function rowToItem(r: DocRow): DocumentListItem {
  return {
    id: r.id,
    title: r.title,
    tags: r.tags,
    pinned: r.pinned !== 0,
    word_count: r.word_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
    content_text: r.content_text,
    protected: r.protected !== 0,
    snippet: r.snippet ?? "",
  };
}

/** Port of `db_get_documents`. Desktop's two-shelf ordering is kept:
 *  unprotected first, pinned first within, then the requested sort
 *  (bm25 relevance order replaces the column sort while searching). */
export async function db_get_documents(args?: {
  search?: string | null;
  tag?: string | null;
  sort?: DocumentSort | null;
  page?: number | null;
  limit?: number | null;
}): Promise<DocumentListResult> {
  const db = getDb();
  // Desktop fetches one big page (privacy shelves collapse independently).
  const lim = Math.min(10000, Math.max(1, args?.limit ?? 10000));
  const offset = (args?.page ?? 0) * lim;

  const match = args?.search != null ? ftsMatchQuery(args.search) : "";
  const searching = match.length > 0;

  let whereSql = " WHERE 1=1";
  const values: (string | number)[] = [];

  const from = searching
    ? "FROM documents d JOIN documents_fts f ON f.rowid = d.id"
    : "FROM documents d";
  if (searching) {
    whereSql += " AND documents_fts MATCH ?";
    values.push(match);
  }
  const tag = args?.tag && args.tag.length > 0 ? args.tag : null;
  if (tag !== null) {
    whereSql += " AND EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value = ?)";
    values.push(tag);
  }

  const totalRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n ${from}${whereSql}`,
    values
  );
  const total = totalRow?.n ?? 0;

  const sortCol =
    args?.sort === "created"
      ? "d.created_at DESC"
      : args?.sort === "title"
        ? "d.title ASC"
        : "d.updated_at DESC";
  const order = searching ? `d.protected ASC, bm25(documents_fts)` : `d.protected ASC, d.pinned DESC, ${sortCol}`;
  // Never leak protected bodies into snippets (encrypted text is meaningless
  // and leaks ciphertext length).
  const snippet = searching
    ? "CASE WHEN d.protected=1 THEN '' ELSE snippet(documents_fts, 1, '«', '»', '…', 18) END"
    : "''";

  const rows = await db.getAllAsync<DocRow>(
    `${"SELECT d.id, d.title, d.tags, d.pinned, d.word_count, d.created_at, d.updated_at, " +
      " CASE WHEN d.protected=1 THEN '' ELSE d.content_text END AS content_text, d.protected, "}${snippet} AS snippet ` +
      `${from}${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...values, lim, offset]
  );

  return { items: rows.map(rowToItem), total };
}

/** Port of `db_get_document` (minus privacy decryption — see header note). */
export async function db_get_document(args: { id: number }): Promise<DocumentDetail | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{
    id: number;
    title: string;
    content: string;
    content_text: string;
    tags: string;
    pinned: number;
    word_count: number;
    created_at: string;
    updated_at: string;
    protected: number;
  }>(
    "SELECT id, title, content, content_text, tags, pinned, word_count, created_at, updated_at, protected FROM documents WHERE id = ?",
    [args.id]
  );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    content_text: row.content_text,
    tags: row.tags,
    pinned: row.pinned !== 0,
    word_count: row.word_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    protected: row.protected !== 0,
  };
}

/** Port of `db_create_document` — desktop defaults ('Untitled', '{}', '', '[]'). */
export async function db_create_document(): Promise<number> {
  const db = getDb();
  const r = await db.runAsync(
    "INSERT INTO documents (title, content, content_text, tags) VALUES ('Untitled', '{}', '', '[]')"
  );
  return r.lastInsertRowId;
}

/** Port of `db_update_document`: same columns, same `datetime('now')` bump.
 *  Callers pass the current tags JSON back verbatim so tags survive edits
 *  from editors that don't manage them. */
export async function db_update_document(args: {
  id: number;
  title: string;
  content: string;
  contentText: string;
  tags: string;
  pinned: boolean;
  wordCount: number;
}): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE documents SET title=?, content=?, content_text=?, tags=?, pinned=?, word_count=?, updated_at=datetime('now') WHERE id=?",
    [args.title, args.content, args.contentText, args.tags, args.pinned ? 1 : 0, args.wordCount, args.id]
  );
}

/** Port of `db_delete_document` (assets row sweep + document delete). */
export async function db_delete_document(args: { id: number }): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM document_assets WHERE document_id = ?", [args.id]);
  await db.runAsync("DELETE FROM documents WHERE id = ?", [args.id]);
}

/** Convenience pin toggle — desktop folds this into db_update_document; on
 *  mobile the list row long-press needs it standalone. */
export async function db_set_document_pinned(args: { id: number; pinned: boolean }): Promise<void> {
  const db = getDb();
  await db.runAsync("UPDATE documents SET pinned = ? WHERE id = ?", [args.pinned ? 1 : 0, args.id]);
}

/** Port of `db_get_all_tags` — distinct tag values from the JSON columns. */
export async function db_get_all_tags(): Promise<string[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{ value: string }>(
    "SELECT DISTINCT value FROM documents, json_each(documents.tags) ORDER BY value"
  );
  return rows.map((r) => r.value);
}
