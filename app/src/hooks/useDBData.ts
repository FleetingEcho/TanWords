/** Data management (Settings › Data): local DB path/size, backup export,
 *  Postgres connect/disconnect, self-provisioned Postgres remote access,
 *  import analyze/apply, sync, and clear-translations — composed by
 *  useDB.extra.ts (see useDB.ts). */
import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { webAuthFetch } from "@/platform/webClient";
import { isDesktopHost } from "@/platform";
import { logError, reportWriteError } from "./useDB.errors";
import type { DbConnection, ImportPlan, ImportDecisions, ImportResult, OverwriteResult, PostgresRemoteStatus } from "./useDB.types";

async function dbRoute<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await webAuthFetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // raw text is the message
    }
    throw message;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function useDBData() {
  // ── Data management (Settings › Data) ─────────────────────────────────

  const getDbPath = useCallback(async (): Promise<string> => {
    if (!isDesktopHost) return "";
    try {
      return await invoke<string>("db_get_db_path");
    } catch (e) {
      logError("getDbPath", e);
      return "";
    }
  }, []);

  /** Where a local database would live, independent of what's actually
   *  connected right now — unlike `getDbPath` (empty while connected to
   *  Postgres, which has no local file). Lets the Local tab show a real path
   *  even while a remote profile is active, instead of showing nothing or
   *  the remote's own URL. */
  const getDefaultLocalPath = useCallback(async (): Promise<string> => {
    if (!isDesktopHost) return "";
    try {
      return await invoke<string>("db_get_default_local_path");
    } catch (e) {
      logError("getDefaultLocalPath", e);
      return "";
    }
  }, []);

  const getDbSize = useCallback(async (): Promise<number> => {
    try {
      return await invoke<number>("db_get_db_size");
    } catch (e) {
      logError("getDbSize", e);
      return 0;
    }
  }, []);

  const exportBackup = useCallback(async (dest: string, password: string | null = null): Promise<void> => {
    if (!isDesktopHost) return;
    try {
      await invoke("db_export_backup", { dest, password });
    } catch (e) {
      reportWriteError("exportBackup", e, "导出备份失败");
      throw e;
    }
  }, []);

  /** Downloads a local SQLite snapshot of the currently-connected Postgres
   *  database — table-by-table copy, since Postgres has no local replica
   *  file for `VACUUM INTO` to clone. Desktop-only, same as connecting. */
  const exportPostgresBackup = useCallback(async (dest: string, password: string | null = null): Promise<void> => {
    if (!isDesktopHost) return;
    try {
      await invoke("db_export_postgres_backup", { dest, password });
    } catch (e) {
      reportWriteError("exportPostgresBackup", e, "导出 Postgres 备份失败");
      throw e;
    }
  }, []);

  /** The active connection profile plus what it supports, so the UI can hide
   *  actions (export, switch file) that a remote profile can't perform. */
  const getConnection = useCallback(async (): Promise<DbConnection | null> => {
    try {
      return await invoke<DbConnection>("db_get_connection");
    } catch (e) {
      logError("getConnection", e);
      return null;
    }
  }, []);

  /** Points the app directly at a user-supplied Postgres database. There is
   *  no local replica — the connection string carries its own credentials
   *  and every read/write is a live network round trip from then on. Caller
   *  must reload the app afterwards. Desktop-only: on web, a Postgres
   *  connection is provisioned server-side via `enablePostgresRemote`
   *  instead of pasted in. */
  const connectPostgres = useCallback(async (url: string): Promise<DbConnection> => {
    if (!isDesktopHost) throw new Error("Pasting a Postgres connection string is desktop-only");
    try {
      return await invoke<DbConnection>("db_connect_postgres", { url });
    } catch (e) {
      reportWriteError("connectPostgres", e, "连接 Postgres 失败");
      throw e;
    }
  }, []);

  /** This web account's self-provisioned role+database inside the shared
   *  Postgres instance, if it has one. Web-only — there's no "account" on
   *  the desktop side to attach this to. */
  const getPostgresRemote = useCallback(async (): Promise<PostgresRemoteStatus> => {
    if (isDesktopHost) return { enabled: false, url: null };
    try {
      return await dbRoute<PostgresRemoteStatus>("/api/db/postgres/status");
    } catch (e) {
      logError("getPostgresRemote", e);
      return { enabled: false, url: null };
    }
  }, []);

  /** Provisions (first call) or re-enables this account's Postgres role, and
   *  switches the account's own web session onto it. Returns the password
   *  in `url` — show/copy it immediately, since a later status read never
   *  includes it again. */
  const enablePostgresRemote = useCallback(async (): Promise<PostgresRemoteStatus> => {
    if (isDesktopHost) throw new Error("Remote access is web-only");
    try {
      return await dbRoute<PostgresRemoteStatus>("/api/db/postgres/enable", "POST");
    } catch (e) {
      reportWriteError("enablePostgresRemote", e, "启用远程连接失败");
      throw e;
    }
  }, []);

  /** New password, same role/database — invalidates every previously issued
   *  credential immediately. */
  const rotatePostgresRemote = useCallback(async (): Promise<PostgresRemoteStatus> => {
    if (isDesktopHost) throw new Error("Remote access is web-only");
    try {
      return await dbRoute<PostgresRemoteStatus>("/api/db/postgres/rotate", "POST");
    } catch (e) {
      reportWriteError("rotatePostgresRemote", e, "刷新密钥失败");
      throw e;
    }
  }, []);

  /** Revokes LOGIN (data and the role/database are kept for a cheap later
   *  re-enable) and switches the account's web session back to local. */
  const disablePostgresRemote = useCallback(async (): Promise<void> => {
    if (isDesktopHost) return;
    try {
      await dbRoute<{ enabled: boolean }>("/api/db/postgres/disable", "POST");
    } catch (e) {
      reportWriteError("disablePostgresRemote", e, "关闭远程连接失败");
      throw e;
    }
  }, []);

  /** Desktop-only: switches back to the default local file. On web, use
   *  `disablePostgresRemote` instead — it also revokes remote access. */
  const disconnectRemote = useCallback(async (): Promise<DbConnection> => {
    if (!isDesktopHost) throw new Error("Use disablePostgresRemote on web");
    try {
      return await invoke<DbConnection>("db_disconnect_remote");
    } catch (e) {
      reportWriteError("disconnectRemote", e, "断开在线数据库失败");
      throw e;
    }
  }, []);

  /** The profile that failed to open at launch, if any — same snapshot App.tsx
   *  already toasted once at startup. Settings re-reads it to decide whether
   *  to keep showing a "forget saved connection" affordance. */
  const getStartupWarning = useCallback(async (): Promise<string | null> => {
    try {
      return await invoke<string | null>("db_get_startup_warning");
    } catch (e) {
      logError("getStartupWarning", e);
      return null;
    }
  }, []);

  /** Pull the primary's latest changes now instead of waiting for the next
   *  background sync. No-op on a local profile. */
  const syncNow = useCallback(async (): Promise<void> => {
    try {
      await invoke("db_sync_now");
    } catch (e) {
      reportWriteError("syncNow", e, "同步失败");
      throw e;
    }
  }, []);

  /** Reads another TanWords database and reports what would be added and what
   *  already exists. Writes nothing — the source is opened read-only. */
  const importAnalyze = useCallback(async (sourcePath: string, password: string | null = null): Promise<ImportPlan> => {
    try {
      if (!isDesktopHost) {
        return await dbRoute<ImportPlan>("/api/import/analyze", "POST", { path: sourcePath, password });
      }
      return await invoke<ImportPlan>("db_import_analyze", { sourcePath, password });
    } catch (e) {
      reportWriteError("importAnalyze", e, "读取数据库文件失败");
      throw e;
    }
  }, []);

  /** Applies an import with a decision for every conflict, in one transaction. */
  const importApply = useCallback(
    async (sourcePath: string, decisions: ImportDecisions, password: string | null = null): Promise<ImportResult> => {
      try {
        if (!isDesktopHost) {
          return await dbRoute<ImportResult>("/api/import/apply", "POST", { path: sourcePath, decisions, password });
        }
        return await invoke<ImportResult>("db_import_apply", { sourcePath, decisions, password });
      } catch (e) {
        reportWriteError("importApply", e, "导入失败");
        throw e;
      }
    },
    []
  );

  /** Wipes the active database's tables and copies another TanWords database
   *  file's contents in verbatim — every table, original ids and all, not
   *  just the natural-keyed subset `importApply` merges. Desktop-only: the
   *  web host has no upload-based route for this yet. Works identically
   *  whether the active database is local or a connected remote. */
  const importOverwrite = useCallback(
    async (sourcePath: string, password: string | null = null): Promise<OverwriteResult> => {
      if (!isDesktopHost) throw new Error("Full-overwrite import is only available in the desktop app");
      try {
        return await invoke<OverwriteResult>("db_import_overwrite", { sourcePath, password });
      } catch (e) {
        reportWriteError("importOverwrite", e, "导入失败");
        throw e;
      }
    },
    []
  );

  /** Reclaims space left by deleted/updated rows (SQLite never shrinks a file
   *  on its own). Desktop-only for now, matching importOverwrite. */
  const vacuumDatabase = useCallback(async (): Promise<void> => {
    if (!isDesktopHost) return;
    try {
      await invoke("db_vacuum");
    } catch (e) {
      reportWriteError("vacuumDatabase", e, "压缩数据库失败");
      throw e;
    }
  }, []);

  /** Mounts a different SQLite file as the active DB (creating it if new). Caller must reload the app after this succeeds — every already-fetched page is stale. */
  const switchDbPath = useCallback(async (newPath: string): Promise<string> => {
    if (!isDesktopHost) return "";
    try {
      return await invoke<string>("db_switch_path", { newPath });
    } catch (e) {
      reportWriteError("switchDbPath", e, "切换数据库失败");
      throw e;
    }
  }, []);

  const clearTranslations = useCallback(async (): Promise<void> => {
    try {
      await invoke("db_clear_translations");
    } catch (e) {
      reportWriteError("clearTranslations", e, "清空翻译记录失败");
    }
  }, []);

  return useMemo(() => ({
    getDbPath, getDefaultLocalPath, getDbSize, exportBackup, exportPostgresBackup, switchDbPath, clearTranslations,
    getConnection, connectPostgres, disconnectRemote, syncNow, getStartupWarning,
    importAnalyze, importApply, importOverwrite, vacuumDatabase,
    getPostgresRemote, enablePostgresRemote, rotatePostgresRemote, disablePostgresRemote,
  }), [
    getDbPath, getDefaultLocalPath, getDbSize, exportBackup, exportPostgresBackup, switchDbPath, clearTranslations,
    getConnection, connectPostgres, disconnectRemote, syncNow, getStartupWarning,
    importAnalyze, importApply, importOverwrite, vacuumDatabase,
    getPostgresRemote, enablePostgresRemote, rotatePostgresRemote, disablePostgresRemote,
  ]);
}
