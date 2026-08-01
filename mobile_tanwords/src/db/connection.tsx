/**
 * Database connection — profile open/switch/fallback.
 * Port of app/core/src/lib.rs::open_startup_db + db/connection.rs from desktop.
 *
 * Phase-1 minimal version: opens the local database, bootstraps schema.sql
 * into a brand-new DB. The Turso profile layer (libSQLOptions + syncLibSQL,
 * profile persistence, fallback warning) extends this file — same exports.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
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
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
  );
  if (!row || row.n === 0) {
    const schema = require("./schema_sql").default as string;
    await db.execAsync(schema);
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
