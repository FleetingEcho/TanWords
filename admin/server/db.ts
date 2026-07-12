import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function defaultDbPath(): string {
  const platform = process.platform;
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "tanwords", "tanwords.db");
  }
  if (platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "tanwords", "tanwords.db");
  }
  // Linux
  return path.join(os.homedir(), ".local", "share", "tanwords", "tanwords.db");
}

const argPath = process.argv.find((a) => a.startsWith("--db="))?.slice(5);
export const DB_PATH = argPath || process.env.TANWORDS_DB || defaultDbPath();

if (!fs.existsSync(DB_PATH)) {
  console.error(`[tanwords-admin] Database not found at ${DB_PATH}`);
  console.error(`Run the TanWords app once first, or pass --db=/path/to/tanwords.db`);
  process.exit(1);
}

// WAL mode lets this tool read/write concurrently with the running desktop app.
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

console.log(`[tanwords-admin] Connected to ${DB_PATH}`);
