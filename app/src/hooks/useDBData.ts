/** Data management (Settings › Data): local DB path/size, backup export,
 *  Turso connect/disconnect/remembered profile, import analyze/apply, sync,
 *  and clear-translations — composed by useDB.extra.ts (see useDB.ts). */
import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { webAuthFetch } from "@/platform/webClient";
import { isDesktopHost } from "@/platform";
import { logError, reportWriteError } from "./useDB.errors";
import type { DbConnection, RememberedTursoConnection, ImportPlan, ImportDecisions, ImportResult, OverwriteResult, RemoteAccessStatus } from "./useDB.types";

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

  /** Points the app at a Turso database as an embedded replica. The token goes
   *  straight to the OS keychain and is never readable from here again. Caller
   *  must reload the app afterwards — every already-fetched page is stale. */
  const connectTurso = useCallback(async (url: string, token: string): Promise<DbConnection> => {
    try {
      if (!isDesktopHost) {
        return await dbRoute<DbConnection>("/api/db/turso/connect", "POST", { url, token });
      }
      return await invoke<DbConnection>("db_connect_turso", { url, token });
    } catch (e) {
      reportWriteError("connectTurso", e, "连接 Turso 失败");
      throw e;
    }
  }, []);

  /** Points the app directly at a user-supplied Postgres database. Unlike
   *  Turso there is no local replica or keychain token — the connection
   *  string carries its own credentials and every read/write is a live
   *  network round trip from then on. Caller must reload the app afterwards. */
  const connectPostgres = useCallback(async (url: string): Promise<DbConnection> => {
    // Desktop-only for now: the web server has a per-account Turso store
    // (`state.users.set_turso`) but no equivalent sealed-credential storage
    // for an arbitrary Postgres connection string yet. The UI gates the
    // Postgres tab to the desktop host so this branch isn't reachable there.
    if (!isDesktopHost) throw new Error("Postgres connections are desktop-only for now");
    try {
      return await invoke<DbConnection>("db_connect_postgres", { url });
    } catch (e) {
      reportWriteError("connectPostgres", e, "连接 Postgres 失败");
      throw e;
    }
  }, []);

  /** Web-only selection between the account's preserved local database and its
   * remembered Turso replica. Selecting local does not erase credentials. */
  const selectDbSource = useCallback(async (source: "local" | "turso"): Promise<DbConnection> => {
    if (isDesktopHost) throw new Error("Per-account database selection is web-only");
    try {
      return await dbRoute<DbConnection>("/api/db/source", "POST", { source });
    } catch (e) {
      reportWriteError("selectDbSource", e, "切换数据库失败");
      throw e;
    }
  }, []);

  /** Whether this web account has a dedicated sqld container a desktop app
   *  can connect to directly, sharing this account's data live. Web-only —
   *  there's no "account" on the desktop side to attach this to. */
  const getRemoteAccess = useCallback(async (): Promise<RemoteAccessStatus> => {
    if (isDesktopHost) return { enabled: false, url: null };
    try {
      return await dbRoute<RemoteAccessStatus>("/api/db/remote/status");
    } catch (e) {
      logError("getRemoteAccess", e);
      return { enabled: false, url: null };
    }
  }, []);

  /** Provisions (or restarts, if previously disabled) this account's sqld
   *  container. Returns the token only this once per call — the caller must
   *  show/copy it immediately. */
  const enableRemoteAccess = useCallback(async (): Promise<RemoteAccessStatus> => {
    if (isDesktopHost) throw new Error("Remote access is web-only");
    try {
      return await dbRoute<RemoteAccessStatus>("/api/db/remote/enable", "POST");
    } catch (e) {
      reportWriteError("enableRemoteAccess", e, "启用远程连接失败");
      throw e;
    }
  }, []);

  /** New keypair, same data (the container is recreated but its volume is
   *  reused) — invalidates every previously issued token immediately. */
  const rotateRemoteAccess = useCallback(async (): Promise<RemoteAccessStatus> => {
    if (isDesktopHost) throw new Error("Remote access is web-only");
    try {
      return await dbRoute<RemoteAccessStatus>("/api/db/remote/rotate", "POST");
    } catch (e) {
      reportWriteError("rotateRemoteAccess", e, "刷新密钥失败");
      throw e;
    }
  }, []);

  /** Stops (not removes) the container — data and the URL are kept for a
   *  cheap later re-enable. */
  const disableRemoteAccess = useCallback(async (): Promise<void> => {
    if (isDesktopHost) return;
    try {
      await dbRoute<{ enabled: boolean }>("/api/db/remote/disable", "POST");
    } catch (e) {
      reportWriteError("disableRemoteAccess", e, "关闭远程连接失败");
      throw e;
    }
  }, []);

  /** Desktop-compatible disconnect operation. Web Settings uses
   * selectDbSource("local") so remembered credentials are preserved. */
  const disconnectRemote = useCallback(async (): Promise<DbConnection> => {
    try {
      if (!isDesktopHost) {
        return await dbRoute<DbConnection>("/api/db/turso/disconnect", "POST");
      }
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

  /** Whether the profile saved on disk (independent of the live connection,
   *  which is already the local fallback if this is relevant at all) is
   *  Turso — gates the "forget saved connection" button. */
  const isSavedProfileTurso = useCallback(async (): Promise<boolean> => {
    try {
      if (!isDesktopHost) {
        const remembered = await dbRoute<RememberedTursoConnection>("/api/db/turso/remembered");
        return remembered.url !== null && remembered.tokenPresent;
      }
      return await invoke<boolean>("db_saved_profile_is_turso");
    } catch (e) {
      logError("isSavedProfileTurso", e);
      return false;
    }
  }, []);

  /** Reads the last Turso URL and whether the keychain still has a token, so
   *  the Settings form can prefill a reconnect without exposing the token. */
  const getRememberedTurso = useCallback(async (): Promise<RememberedTursoConnection | null> => {
    try {
      if (!isDesktopHost) {
        return await dbRoute<RememberedTursoConnection>("/api/db/turso/remembered");
      }
      return await invoke<RememberedTursoConnection>("db_get_remembered_turso");
    } catch (e) {
      logError("getRememberedTurso", e);
      return null;
    }
  }, []);

  /** Clears a saved Turso profile that can't be reconnected right now (lost
   *  token, wiped keychain, …), without needing a live connection to it. */
  const forgetSavedProfile = useCallback(async (): Promise<void> => {
    try {
      if (!isDesktopHost) {
        await dbRoute("/api/db/turso/forget", "POST");
        return;
      }
      await invoke("db_forget_saved_profile");
    } catch (e) {
      reportWriteError("forgetSavedProfile", e, "Failed to clear saved connection");
      throw e;
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
    getConnection, connectTurso, connectPostgres, selectDbSource, disconnectRemote, syncNow,
    getStartupWarning, isSavedProfileTurso, forgetSavedProfile, getRememberedTurso,
    importAnalyze, importApply, importOverwrite, vacuumDatabase,
    getRemoteAccess, enableRemoteAccess, rotateRemoteAccess, disableRemoteAccess,
  }), [
    getDbPath, getDefaultLocalPath, getDbSize, exportBackup, exportPostgresBackup, switchDbPath, clearTranslations,
    getConnection, connectTurso, connectPostgres, selectDbSource, disconnectRemote, syncNow,
    getStartupWarning, isSavedProfileTurso, forgetSavedProfile, getRememberedTurso,
    importAnalyze, importApply, importOverwrite, vacuumDatabase,
    getRemoteAccess, enableRemoteAccess, rotateRemoteAccess, disableRemoteAccess,
  ]);
}
