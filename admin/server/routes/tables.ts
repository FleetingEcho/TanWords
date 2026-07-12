import { Hono } from "hono";
import { db } from "../db.js";

export const tables = new Hono();

const EXCLUDED = new Set(["sqlite_sequence"]);

function listTableNames(): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name"
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name).filter((n) => !EXCLUDED.has(n));
}

function assertKnownTable(name: string) {
  if (!listTableNames().includes(name)) {
    throw new Error(`Unknown table: ${name}`);
  }
}

tables.get("/", (c) => {
  const names = listTableNames();
  const counts = names.map((name) => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
    return { name, count: row.n };
  });
  return c.json(counts);
});

tables.get("/:name/schema", (c) => {
  const name = c.req.param("name");
  assertKnownTable(name);
  const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
  return c.json(cols);
});

tables.get("/:name", (c) => {
  const name = c.req.param("name");
  assertKnownTable(name);

  const page = Number(c.req.query("page") ?? 0);
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const search = c.req.query("search")?.trim();
  const offset = page * limit;

  const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; type: string }[];
  const textCols = cols.filter((c) => /char|text|clob/i.test(c.type)).map((c) => c.name);

  let where = "";
  const params: unknown[] = [];
  if (search && textCols.length > 0) {
    where = "WHERE " + textCols.map((col) => `"${col}" LIKE ?`).join(" OR ");
    textCols.forEach(() => params.push(`%${search}%`));
  }

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM "${name}" ${where}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`SELECT rowid AS _rowid, * FROM "${name}" ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return c.json({ rows, total, page, limit });
});

tables.post("/:name", async (c) => {
  const name = c.req.param("name");
  assertKnownTable(name);
  const body = await c.req.json<Record<string, unknown>>();
  const keys = Object.keys(body);
  const placeholders = keys.map(() => "?").join(", ");
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const result = db
    .prepare(`INSERT INTO "${name}" (${cols}) VALUES (${placeholders})`)
    .run(...keys.map((k) => body[k] as never));
  return c.json({ rowid: result.lastInsertRowid });
});

tables.patch("/:name/:rowid", async (c) => {
  const name = c.req.param("name");
  const rowid = c.req.param("rowid");
  assertKnownTable(name);
  const body = await c.req.json<Record<string, unknown>>();
  const keys = Object.keys(body);
  if (keys.length === 0) return c.json({ ok: true });
  const setClause = keys.map((k) => `"${k}" = ?`).join(", ");
  db.prepare(`UPDATE "${name}" SET ${setClause} WHERE rowid = ?`).run(
    ...keys.map((k) => body[k] as never),
    rowid
  );
  return c.json({ ok: true });
});

tables.delete("/:name/:rowid", (c) => {
  const name = c.req.param("name");
  const rowid = c.req.param("rowid");
  assertKnownTable(name);
  db.prepare(`DELETE FROM "${name}" WHERE rowid = ?`).run(rowid);
  return c.json({ ok: true });
});
