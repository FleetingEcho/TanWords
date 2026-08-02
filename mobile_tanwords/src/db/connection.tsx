/**
 * Database connection — profile open/switch/fallback.
 * Port of app/core/src/lib.rs::open_startup_db + db/connection.rs from desktop.
 *
 * Phase-1 minimal version: opens the local database, bootstraps schema.sql
 * into a brand-new DB. The Turso profile layer (libSQLOptions + syncLibSQL,
 * profile persistence, fallback warning) extends this file — same exports.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import * as SQLite from "expo-sqlite";

export const EXPECTED_SCHEMA_VERSION = 27;

const dbContext = createContext<SQLite.SQLiteDatabase | null>(null);

/** The live connection, available to non-React code (db modules, stores).
 *  Set by DbProvider once the DB is open; db/* modules import getDb(). */
let currentDb: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!currentDb) throw new Error("DB not ready (DbProvider has not finished opening)");
  return currentDb;
}

async function openLocal(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync("tanwords.db", {
    enableChangeListener: true,
  });
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  // Brand-new local DBs get the frozen desktop schema. Shared/Turso DBs never
  // migrate on mobile — the desktop app owns the schema, see PLAN.md D2.
  //
  // Sentinel check: `feed_bookmarks` is the LAST table in the script. A
  // bootstrap that died mid-way (e.g. web runs before the FTS5 filter above)
  // leaves `schema_migrations` behind while later tables never get created;
  // requiring the tail table makes such partial DBs re-run the — idempotent,
  // all IF NOT EXISTS — bootstrap and converge.
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('schema_migrations','feed_bookmarks')"
  );
  if (!row || row.n < 2) {
    // Web uses the FTS5-less variant: expo-sqlite's web wa-sqlite build ships
    // without FTS5 ("no such module: fts5"); native gets FTS via enableFTS in
    // app.json. Executed statement-by-statement — a multi-statement exec
    // string silently swallows CREATE VIRTUAL TABLE on some builds, and
    // per-statement errors name the exact failing DDL.
    const mod = require("./schema_sql");
    const statements = (Platform.OS === "web" ? mod.schemaWebStatements : mod.schemaStatements) as string[];
    for (const stmt of statements) {
      await db.execAsync(stmt + ";").catch((e) => {
        throw new Error(
          `Schema bootstrap failed on: ${stmt.slice(0, 120).replace(/\s+/g, " ")}… — ${e}`
        );
      });
    }
  }
  return db;
}

export function DbProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);

  useEffect(() => {
    let cancelled = false;
    openLocal().then((d) => {
      if (!cancelled) {
        currentDb = d;
        setDb(d);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!db) {
    // Boot splash while the DB opens (schema bootstrap on first launch can
    // take a beat) — a themed surface instead of a white flash.
    return (
      <View style={{ flex: 1 }} className="bg-background items-center justify-center">
        <ActivityIndicator size="large" color="hsl(226 68% 51%)" />
      </View>
    );
  }
  return <dbContext.Provider value={db}>{children}</dbContext.Provider>;
}

export function useDb(): SQLite.SQLiteDatabase {
  const db = useContext(dbContext);
  if (!db) throw new Error("useDb outside DbProvider");
  return db;
}
