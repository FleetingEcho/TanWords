import { useEffect, useState } from "react";
import { toast } from "sonner";
import { saveDialog, openDialog, pickFile } from "@/ipc/dialog";
import { webUploadForImport, webExportBackup } from "@/platform/webClient";
import { isDesktopHost } from "@/platform";
import { subscribe } from "@/ipc/events";
import type { useDB } from "@/hooks/useDB";
import type { useT } from "@/hooks/useT";
import { DbConnection, ImportDecisions, ImportPlan, ImportProgress, OverwriteProgress, RememberedTursoConnection } from "@/hooks/useDB.types";

export function useDataSection(db: ReturnType<typeof useDB>, t: ReturnType<typeof useT>) {
  const [dbPath, setDbPath] = useState("");
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

  // Turso connection form
  const [tursoOpen, setTursoOpen] = useState(false);
  const [tursoUrl, setTursoUrl] = useState("");
  const [tursoToken, setTursoToken] = useState("");
  const [rememberedTurso, setRememberedTurso] = useState<RememberedTursoConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [stuckTursoWarning, setStuckTursoWarning] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [pendingExportSource, setPendingExportSource] = useState<"local" | "turso">("local");
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState("");

  // Import from another database file
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  useEffect(() => subscribe<ImportProgress>("import-progress", setImportProgress), []);

  // Full-overwrite import (replaces every table, not just the merged subset)
  const [pendingOverwritePath, setPendingOverwritePath] = useState<string | null>(null);
  const [overwriting, setOverwriting] = useState(false);
  const [overwriteProgress, setOverwriteProgress] = useState<OverwriteProgress | null>(null);

  useEffect(() => subscribe<OverwriteProgress>("overwrite-progress", setOverwriteProgress), []);

  const [vacuuming, setVacuuming] = useState(false);

  useEffect(() => {
    if (isDesktopHost) db.getDbPath().then(setDbPath);
    db.getDbSize().then(setDbSize);
    db.getConnection().then((c) => {
      setConnection(c);
      if (c?.kind === "turso") setActiveTab("cloud");
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
  }, []);

  const isRemote = connection?.kind === "turso";
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
        toast.error(String(error));
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
    } catch {
      // useDBData already toasts the failure; keep the dialog state so retry doesn't require reselecting the file
    } finally {
      setOverwriting(false);
      setOverwriteProgress(null);
    }
  };

  const analyzeImport = async (path: string, password: string | null) => {
    setAnalyzing(true);
    try {
      setImportPlan(await db.importAnalyze(path, password));
    } catch {
      // useDB already toasts the failure
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
    } catch {
      // useDB already toasts the failure
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const startExport = async (password: string | null) => {
    if (!isDesktopHost) {
      setExporting(true);
      try {
        await webExportBackup(password, pendingExportSource);
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
    try {
      await db.exportBackup(dest, password);
      toast.success(t("settings.exportOk"));
    } catch {
      // useDB already toasts the failure
    } finally {
      setExporting(false);
    }
  };

  const handleExport = (source: "local" | "turso" = "local") => {
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
  return { dbPath, dbSize, connection, exporting, confirmClear, pendingSwitchPath, switching, activeTab, tursoOpen, tursoUrl, tursoToken, rememberedTurso, connecting, confirmDisconnect, syncing, stuckTursoWarning, forgetting, showExportPassword, pendingExportSource, showImportPassword, pendingImportPath, importPassword, importPlan, analyzing, importing, importProgress, pendingOverwritePath, overwriting, overwriteProgress, vacuuming, isRemote, isOffline, canExport, canSwitchPath, canImport, canVacuum, formattedDbSize, setDbPath, setDbSize, setConnection, setExporting, setConfirmClear, setPendingSwitchPath, setSwitching, setActiveTab, setTursoOpen, setTursoUrl, setTursoToken, setRememberedTurso, setConnecting, setConfirmDisconnect, setSyncing, setStuckTursoWarning, setForgetting, setShowExportPassword, setPendingExportSource, setShowImportPassword, setPendingImportPath, setImportPassword, setImportPlan, setAnalyzing, setImporting, setPendingOverwritePath, handleOpenExisting, handleNewLocation, confirmSwitch, handleConnectTurso, handleSelectSource, handleDisconnect, handleForgetSavedConnection, handleSyncNow, handleChooseImportFile, analyzeImport, handleImport, handleChooseOverwriteFile, confirmOverwrite, handleVacuum, startExport, handleExport, handleClearTranslations };
}
