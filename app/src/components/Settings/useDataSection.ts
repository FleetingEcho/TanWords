import { useEffect, useState } from "react";
import { toast } from "sonner";
import { saveDialog, openDialog, pickFile } from "@/ipc/dialog";
import { webUploadForImport, webExportBackup } from "@/platform/webClient";
import { isDesktopHost } from "@/platform";
import { subscribe } from "@/ipc/events";
import type { useDB } from "@/hooks/useDB";
import type { useT } from "@/hooks/useT";
import { DbConnection, ImportDecisions, ImportPlan, ImportProgress, OverwriteProgress, PostgresExportProgress, RemoteAccessStatus, RememberedTursoConnection } from "@/hooks/useDB.types";

/** Every db.* call throws either a plain string (the backend's error text,
 *  passed through as-is by `invoke`) or an `Error` — normalise to text for
 *  display in the import error modal. */
function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function useDataSection(db: ReturnType<typeof useDB>, t: ReturnType<typeof useT>) {
  const [dbPath, setDbPath] = useState("");
  // Where a local database would live, independent of what's actually
  // connected — shown on the Local tab in place of the remote's own URL
  // while a Turso/Postgres profile is active (there's no local path then).
  const [defaultLocalPath, setDefaultLocalPath] = useState("");
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [connection, setConnection] = useState<DbConnection | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingSwitchPath, setPendingSwitchPath] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  // Which half of the (now split) storage settings is showing. Defaults to
  // "local" and flips to "cloud" once we know the active or last-attempted
  // profile was Turso — see the effect below.
  const [activeTab, setActiveTab] = useState<"local" | "cloud">("local");

  // Which cloud backend the connect form targets. Defaults to "turso" and
  // flips to "postgres" once we know the active profile is Postgres — see
  // the effect below.
  const [cloudBackend, setCloudBackend] = useState<"turso" | "postgres">("turso");

  // Turso connection form
  const [tursoOpen, setTursoOpen] = useState(false);
  const [tursoUrl, setTursoUrl] = useState("");
  const [tursoToken, setTursoToken] = useState("");
  const [rememberedTurso, setRememberedTurso] = useState<RememberedTursoConnection | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Postgres connection form. No local replica and no keychain token — the
  // connection string carries its own credentials, so there's nothing to
  // "remember" the way Turso's token is.
  const [postgresOpen, setPostgresOpen] = useState(false);
  const [postgresUrl, setPostgresUrl] = useState("");
  const [connectingPostgres, setConnectingPostgres] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [stuckTursoWarning, setStuckTursoWarning] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [pendingExportSource, setPendingExportSource] = useState<"local" | "turso" | "postgres">("local");
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState("");

  // Import from another database file
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  // Shown as a modal (not just a toast) whenever an import/export step fails,
  // so the specific reason — a bad password, an unrecognised file, a broken
  // connection mid-copy — doesn't get lost as a transient notification.
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => subscribe<ImportProgress>("import-progress", setImportProgress), []);

  // Full-overwrite import (replaces every table, not just the merged subset)
  const [pendingOverwritePath, setPendingOverwritePath] = useState<string | null>(null);
  const [overwriting, setOverwriting] = useState(false);
  const [overwriteProgress, setOverwriteProgress] = useState<OverwriteProgress | null>(null);

  useEffect(() => subscribe<OverwriteProgress>("overwrite-progress", setOverwriteProgress), []);

  // Postgres → local SQLite backup export (table-by-table copy, since
  // Postgres has no local replica file for VACUUM INTO to clone).
  const [postgresExportProgress, setPostgresExportProgress] = useState<PostgresExportProgress | null>(null);

  useEffect(() => subscribe<PostgresExportProgress>("postgres-export-progress", setPostgresExportProgress), []);

  const [vacuuming, setVacuuming] = useState(false);

  // Web-account "remote access": a dedicated sqld container a desktop app
  // can connect to directly, sharing this account's data live.
  const [remoteAccess, setRemoteAccess] = useState<RemoteAccessStatus | null>(null);
  const [remoteAccessBusy, setRemoteAccessBusy] = useState(false);
  const [confirmRotateRemote, setConfirmRotateRemote] = useState(false);
  const [confirmDisableRemote, setConfirmDisableRemote] = useState(false);
  // The token is only ever returned right after enable/rotate — shown once,
  // then cleared from memory rather than kept around indefinitely.
  const [remoteAccessToken, setRemoteAccessToken] = useState<string | null>(null);

  useEffect(() => {
    if (isDesktopHost) {
      db.getDbPath().then(setDbPath);
      db.getDefaultLocalPath().then(setDefaultLocalPath);
    }
    db.getDbSize().then(setDbSize);
    db.getConnection().then((c) => {
      setConnection(c);
      if (c?.kind === "turso" || c?.kind === "postgres") setActiveTab("cloud");
      if (c?.kind === "postgres") setCloudBackend("postgres");
    });
    // A saved Turso profile that failed to open at launch is kept (not
    // self-cleared like a local one) in case it was just a flaky network —
    // so it can linger across restarts if the real cause was a lost token.
    // Surface a way to clear it once we know that's actually the case.
    Promise.all([db.getStartupWarning(), db.isSavedProfileTurso()]).then(
      ([warning, isTurso]) => {
        if (warning && isTurso) {
          setStuckTursoWarning(warning);
          setActiveTab("cloud");
        }
      }
    );
    db.getRememberedTurso().then((saved) => {
      setRememberedTurso(saved);
      if (saved?.url) setTursoUrl(saved.url);
    });
    if (!isDesktopHost) db.getRemoteAccess().then(setRemoteAccess);
  }, []);

  const isRemote = connection?.kind === "turso" || connection?.kind === "postgres";
  // Serving the replica read-only because the primary was unreachable at
  // startup: syncing can't work, so the button would only ever fail.
  const isOffline = connection?.offline ?? false;
  const canExport = connection?.caps.export ?? true;
  const canSwitchPath = connection?.caps.switchPath ?? true;
  const canImport = connection?.caps.writable ?? true;
  const canVacuum = connection?.caps.vacuum ?? true;

  const formattedDbSize = dbSize === null
    ? "…"
    : dbSize >= 1024 ** 3
      ? `${(dbSize / 1024 ** 3).toFixed(2)} GB`
      : dbSize >= 1024 ** 2
        ? `${(dbSize / 1024 ** 2).toFixed(2)} MB`
        : dbSize >= 1024
          ? `${(dbSize / 1024).toFixed(1)} KB`
          : `${dbSize} B`;

  const handleOpenExisting = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (typeof picked === "string") setPendingSwitchPath(picked);
  };

  const handleNewLocation = async () => {
    const picked = await saveDialog({
      defaultPath: "tanwords.db",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (picked) setPendingSwitchPath(picked);
  };

  const confirmSwitch = async () => {
    if (!pendingSwitchPath) return;
    setSwitching(true);
    try {
      await db.switchDbPath(pendingSwitchPath);
      toast.success(t("settings.switchDBOk"));
      setTimeout(() => window.location.reload(), 600);
    } catch {
      // useDB already toasts the failure
      setSwitching(false);
      setPendingSwitchPath(null);
    }
  };

  const handleConnectTurso = async () => {
    setConnecting(true);
    try {
      // On reconnect, the token is kept in the keychain and intentionally not
      // shown here. Pass an empty token and let the backend fall back to it.
      await db.connectTurso(tursoUrl, tursoToken);
      setTursoToken("");
      toast.success(t("settings.remoteDBConnectOk"));
      setTimeout(() => window.location.reload(), 600);
    } catch {
      // useDB already toasts the failure; keep the form open so the user can
      // correct the URL or token rather than retyping both.
      setConnecting(false);
    }
  };

  const handleConnectPostgres = async () => {
    setConnectingPostgres(true);
    try {
      await db.connectPostgres(postgresUrl);
      toast.success(t("settings.remoteDBConnectOk"));
      setTimeout(() => window.location.reload(), 600);
    } catch {
      // useDB already toasts the failure; keep the form open so the user can
      // correct the connection string rather than retyping it.
      setConnectingPostgres(false);
    }
  };

  const handleSelectSource = async (source: "local" | "turso") => {
    setSwitching(true);
    try {
      await db.selectDbSource(source);
      toast.success(t(source === "local" ? "settings.dbUseLocalOk" : "settings.dbUseReplicaOk"));
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setSwitching(false);
      setConfirmDisconnect(false);
    }
  };

  const handleDisconnect = async () => {
    if (!isDesktopHost) {
      await handleSelectSource("local");
      return;
    }
    try {
      await db.disconnectRemote();
      toast.success(t("settings.remoteDBDisconnectOk"));
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setConfirmDisconnect(false);
    }
  };

  const handleForgetSavedConnection = async () => {
    setForgetting(true);
    try {
      await db.forgetSavedProfile();
      setStuckTursoWarning(null);
      setRememberedTurso(null);
      toast.success(t("settings.remoteDBForgetOk"));
    } catch {
      // useDB already toasts the failure
    } finally {
      setForgetting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await db.syncNow();
      toast.success(t("settings.remoteDBSyncOk"));
    } catch {
      // useDB already toasts the failure
    } finally {
      setSyncing(false);
    }
  };

  const handleChooseImportFile = async () => {
    if (!isDesktopHost) {
      const file = await pickFile({ accept: ".db,.zip" });
      if (!file) return;
      let path: string;
      try {
        path = await webUploadForImport(file);
      } catch (error) {
        setImportError(errorMessage(error));
        return;
      }
      if (file.name.toLowerCase().endsWith(".zip")) {
        setPendingImportPath(path);
        setShowImportPassword(true);
        return;
      }
      void analyzeImport(path, null);
      return;
    }

    const picked = await openDialog({
      multiple: false,
      filters: [
        { name: "TanWords Backup", extensions: ["db", "zip"] },
        { name: "SQLite Database", extensions: ["db"] },
        { name: "Encrypted ZIP", extensions: ["zip"] },
      ],
    });
    if (typeof picked !== "string") return;
    if (picked.toLowerCase().endsWith(".zip")) {
      setPendingImportPath(picked);
      setShowImportPassword(true);
      return;
    }
    void analyzeImport(picked, null);
  };

  /** Full-overwrite import: picks a plain .db file (no encrypted-zip support
   *  here — this is a blunt power-user tool, not the guided merge flow) and
   *  stages it for a destructive-action confirmation. */
  const handleChooseOverwriteFile = async () => {
    if (!isDesktopHost) {
      toast.error(t("settings.importOverwriteDesktopOnly"));
      return;
    }
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (typeof picked === "string") setPendingOverwritePath(picked);
  };

  const confirmOverwrite = async () => {
    if (!pendingOverwritePath) return;
    setOverwriting(true);
    setOverwriteProgress(null);
    try {
      const result = await db.importOverwrite(pendingOverwritePath, null);
      toast.success(t("settings.importOverwriteOk", { tables: result.tables.length, rows: result.rowsCopied }));
      if (result.skipped.length > 0) {
        toast.warning(t("settings.importOverwriteSkipped", { n: result.skipped.length }), {
          description: result.skipped.join("\n"),
          duration: 15000,
        });
      }
      setPendingOverwritePath(null);
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      // Keep the dialog state (pendingOverwritePath) so retry doesn't
      // require reselecting the file; the error modal explains what failed.
      setImportError(errorMessage(error));
    } finally {
      setOverwriting(false);
      setOverwriteProgress(null);
    }
  };

  const analyzeImport = async (path: string, password: string | null) => {
    setAnalyzing(true);
    try {
      setImportPlan(await db.importAnalyze(path, password));
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleImport = async (decisions: ImportDecisions) => {
    if (!importPlan) return;
    setImporting(true);
    setImportProgress(null);
    try {
      const result = await db.importApply(importPlan.sourcePath, decisions, importPassword || null);
      setImportPlan(null);
      setPendingImportPath(null);
      setImportPassword("");
      toast.success(
        t("settings.importDBDone", {
          added: result.added,
          overwritten: result.overwritten,
          skipped: result.skipped,
        })
      );
      // Every already-loaded page was fetched from the pre-import database.
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      // The preview modal (importPlan) stays open behind the error modal so
      // the user can retry without reselecting the file and re-choosing
      // conflict decisions.
      setImportError(errorMessage(error));
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const startExport = async (password: string | null) => {
    if (!isDesktopHost) {
      // Postgres export is desktop-only for now — that button is never
      // rendered on web, so pendingExportSource can't actually be "postgres"
      // here; the fallback is just to keep this call's type honest.
      setExporting(true);
      try {
        await webExportBackup(password, pendingExportSource === "postgres" ? "local" : pendingExportSource);
        toast.success(t("settings.exportOk"));
      } catch (error) {
        toast.error(typeof error === "string" ? error : String(error));
      } finally {
        setExporting(false);
      }
      return;
    }

    const dest = await saveDialog({
      defaultPath: `tanwords-backup-${new Date().toISOString().slice(0, 10)}${password ? ".zip" : ".db"}`,
      filters: password
        ? [{ name: t("settings.backupZipFilter"), extensions: ["zip"] }]
        : [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (!dest) return;
    setExporting(true);
    setPostgresExportProgress(null);
    try {
      if (pendingExportSource === "postgres") {
        await db.exportPostgresBackup(dest, password);
      } else {
        await db.exportBackup(dest, password);
      }
      toast.success(t("settings.exportOk"));
    } catch {
      // useDB already toasts the failure
    } finally {
      setExporting(false);
      setPostgresExportProgress(null);
    }
  };

  const handleExport = (source: "local" | "turso" | "postgres" = "local") => {
    setPendingExportSource(source);
    setShowExportPassword(true);
  };

  const handleClearTranslations = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    await db.clearTranslations();
    setConfirmClear(false);
    toast.success(t("settings.dangerClearedOk"));
  };

  const handleEnableRemote = async () => {
    setRemoteAccessBusy(true);
    try {
      const result = await db.enableRemoteAccess();
      setRemoteAccess(result);
      setRemoteAccessToken(result.token ?? null);
      toast.success(t("settings.remoteAccessEnabledOk"));
    } catch {
      // useDBData already toasts the failure
    } finally {
      setRemoteAccessBusy(false);
    }
  };

  const handleConfirmRotateRemote = async () => {
    setRemoteAccessBusy(true);
    try {
      const result = await db.rotateRemoteAccess();
      setRemoteAccess(result);
      setRemoteAccessToken(result.token ?? null);
      toast.success(t("settings.remoteAccessRotatedOk"));
    } catch {
      // useDBData already toasts the failure
    } finally {
      setRemoteAccessBusy(false);
      setConfirmRotateRemote(false);
    }
  };

  const handleConfirmDisableRemote = async () => {
    setRemoteAccessBusy(true);
    try {
      await db.disableRemoteAccess();
      setRemoteAccess({ enabled: false, url: remoteAccess?.url ?? null });
      setRemoteAccessToken(null);
      toast.success(t("settings.remoteAccessDisabledOk"));
    } catch {
      // useDBData already toasts the failure
    } finally {
      setRemoteAccessBusy(false);
      setConfirmDisableRemote(false);
    }
  };

  const handleVacuum = async () => {
    setVacuuming(true);
    try {
      await db.vacuumDatabase();
      toast.success(t("settings.vacuumDBOk"));
      db.getDbSize().then(setDbSize);
    } catch {
      // useDBData already toasts the failure
    } finally {
      setVacuuming(false);
    }
  };
  return { dbPath, defaultLocalPath, dbSize, connection, exporting, confirmClear, pendingSwitchPath, switching, activeTab, cloudBackend, tursoOpen, tursoUrl, tursoToken, rememberedTurso, connecting, postgresOpen, postgresUrl, connectingPostgres, confirmDisconnect, syncing, stuckTursoWarning, forgetting, showExportPassword, pendingExportSource, showImportPassword, pendingImportPath, importPassword, importPlan, analyzing, importing, importProgress, importError, pendingOverwritePath, overwriting, overwriteProgress, postgresExportProgress, vacuuming, remoteAccess, remoteAccessBusy, confirmRotateRemote, confirmDisableRemote, remoteAccessToken, isRemote, isOffline, canExport, canSwitchPath, canImport, canVacuum, formattedDbSize, setDbPath, setDefaultLocalPath, setDbSize, setConnection, setExporting, setConfirmClear, setPendingSwitchPath, setSwitching, setActiveTab, setCloudBackend, setTursoOpen, setTursoUrl, setTursoToken, setRememberedTurso, setConnecting, setPostgresOpen, setPostgresUrl, setConfirmDisconnect, setSyncing, setStuckTursoWarning, setForgetting, setShowExportPassword, setPendingExportSource, setShowImportPassword, setPendingImportPath, setImportPassword, setImportPlan, setAnalyzing, setImporting, setImportError, setPendingOverwritePath, setConfirmRotateRemote, setConfirmDisableRemote, setRemoteAccessToken, handleOpenExisting, handleNewLocation, confirmSwitch, handleConnectTurso, handleConnectPostgres, handleSelectSource, handleDisconnect, handleForgetSavedConnection, handleSyncNow, handleChooseImportFile, analyzeImport, handleImport, handleChooseOverwriteFile, confirmOverwrite, handleVacuum, handleEnableRemote, handleConfirmRotateRemote, handleConfirmDisableRemote, startExport, handleExport, handleClearTranslations };
}
