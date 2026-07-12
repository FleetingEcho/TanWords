import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { tables } from "./routes/tables.js";
import { generate } from "./generate.js";
import { DB_PATH } from "./db.js";

const app = new Hono();

// Local-only tool — permissive CORS since the frontend runs on a different port.
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true, dbPath: DB_PATH }));
app.route("/api/tables", tables);
app.route("/api/generate", generate);

const port = 5198;
console.log(`[tanwords-admin] API listening on http://127.0.0.1:${port}`);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
