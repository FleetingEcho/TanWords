import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { saveDialog, openDialog, pickFile } from "@/ipc/dialog";
import { webUploadForImport, webExportBackup } from "@/platform/webClient";
import { isDesktopHost } from "@/platform";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { DbConnection, ImportDecisions, ImportPlan, RememberedTursoConnection } from "@/hooks/useDB.types";
import { R2Section } from "./R2Section";
import { ImportPreviewModal } from "./ImportPreviewModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DownloadIcon } from "@/components/ui/icons";
import { SettingRow, ToggleGroup } from "./SettingsShared";

function BackupPasswordDialog({
  open,
  mode,
  onCancel,
  onPlain,
  onConfirm,
}: {
  open: boolean;
  mode: "export" | "import";
  onCancel: () => void;
  onPlain?: () => void;
  onConfirm: (password: string) => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirm("");
      setEncrypt(false);
      setError(null);
    }
  }, [open]);

  const submit = () => {
    if (mode === "export" && !encrypt) {
      onPlain?.();
      return;
    }
    if (!password) {
      setError(t("settings.backupPasswordRequired"));
      return;
    }
    if (mode === "export" && password !== confirm) {
      setError(t("settings.backupPasswordMismatch"));
      return;
    }
    onConfirm(password);
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="max-w-sm">
      <div className="p-5 space-y-3">
        <DialogTitle className="text-sm font-semibold">
          {t(mode === "export" ? "settings.backupPasswordTitle" : "settings.importPasswordTitle")}
        </DialogTitle>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t(mode === "export" ? "settings.backupPasswordMessage" : "settings.importPasswordMessage")}
        </p>
        {mode === "export" && (
          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="radio"
                name="backup-encrypt"
                checked={!encrypt}
                onChange={() => setEncrypt(false)}
              />
              {t("settings.backupNoPasswordChoice")}
            </label>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="radio"
                name="backup-encrypt"
                checked={encrypt}
                onChange={() => setEncrypt(true)}
              />
              {t("settings.backupEncryptChoice")}
            </label>
          </div>
        )}
        {(mode === "import" || encrypt) && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">{t("settings.backupPassword")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-hidden focus:border-primary"
            />
          </label>
        )}
        {encrypt && mode === "export" && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">{t("settings.backupPasswordConfirm")}</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-hidden focus:border-primary"
            />
          </label>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
        <Button variant="ghost" onClick={onCancel} className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted">
          {t("common.cancel")}
        </Button>
        <Button onClick={submit} className="h-8 px-3 rounded-lg text-xs font-semibold">
          {t(mode === "export" ? "settings.backupContinue" : "settings.importPasswordConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}

export function DataSection({ db, t }: { db: ReturnType<typeof useDB>; t: ReturnType<typeof useT> }) {
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
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState("");

  // Import from another database file
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);

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

  const handleDisconnect = async () => {
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
    }
  };

  const startExport = async (password: string | null) => {
    if (!isDesktopHost) {
      setExporting(true);
      try {
        webExportBackup(password);
        toast.success(t("settings.exportOk"));
      } finally {
        setTimeout(() => setExporting(false), 1200);
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

  const handleExport = () => setShowExportPassword(true);

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

  return (
    <div className="space-y-3">
      {stuckTursoWarning && !isRemote && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-500">
                {t("settings.remoteDBStuckTitle")}
              </p>
              <p className="mt-1 truncate text-[11px] leading-relaxed text-muted-foreground" title={stuckTursoWarning}>
                {stuckTursoWarning}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={handleForgetSavedConnection}
              disabled={forgetting}
              className="h-8 shrink-0 rounded-lg border border-destructive/40 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              {forgetting ? t("settings.remoteDBForgetting") : t("settings.remoteDBForget")}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            {isRemote && (
              <span className="min-w-0 truncate font-mono text-[11px] text-primary" title={connection?.remoteUrl ?? ""}>
                {connection?.remoteUrl}
              </span>
            )}
            {isDesktopHost ? (
              <span
                className="min-w-0 max-w-[320px] truncate font-mono text-[11px] text-muted-foreground"
                title={isRemote ? `${t("settings.remoteDBReplicaNote")}: ${dbPath}` : dbPath}
              >
                {isRemote ? `(${t("settings.remoteDBReplicaNote")}) ` : ""}{dbPath || "…"}
              </span>
            ) : (
              <span className="max-w-[320px] truncate font-mono text-[11px] text-muted-foreground">
                {isRemote ? `(${t("settings.remoteDBReplicaNote")}) ` : ""}{t("settings.dbLocationServer")}
              </span>
            )}
          </div>
          <span className="shrink-0 rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground" title={t("settings.dbSizeIncludesAuxiliary")}>{formattedDbSize}</span>
        </div>

        <ToggleGroup
          options={[
            { id: "local", label: t("settings.dbTabLocal") },
            { id: "cloud", label: t("settings.dbTabCloud") },
          ]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as "local" | "cloud")}
        />

        {activeTab === "local" ? (
          isDesktopHost && canSwitchPath ? (
            <SettingRow label={t("settings.switchDB")} sub={t("settings.switchDBSub")}>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleOpenExisting}
                  className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
                >
                  {t("settings.switchDBOpenExisting")}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleNewLocation}
                  className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
                >
                  {t("settings.switchDBNewLocation")}
                </Button>
              </div>
            </SettingRow>
          ) : isDesktopHost ? (
            <p className="text-xs text-muted-foreground py-2">{t("settings.switchDBUnavailableRemote")}</p>
          ) : (
            <p className="text-xs text-muted-foreground py-2">{t("settings.remoteDBLocal")}</p>
          )
        ) : (
          <div className="space-y-3">
            <SettingRow
              label={t("settings.remoteDB")}
              sub={isOffline ? t("settings.remoteDBOfflineNote") : t("settings.remoteDBSub")}
            >
              <div className="flex items-center gap-2">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isOffline
                    ? "bg-destructive/10 text-destructive"
                    : isRemote
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}>
                  {isOffline
                    ? t("settings.remoteDBOffline")
                    : isRemote
                      ? t("settings.remoteDBConnected")
                      : t("settings.remoteDBLocal")}
                </span>
                {isRemote ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleSyncNow}
                      disabled={syncing || !connection?.caps.sync}
                      className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted disabled:opacity-50 transition-colors"
                    >
                      {syncing ? t("settings.remoteDBSyncing") : t("settings.remoteDBSync")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmDisconnect(true)}
                      className="h-8 px-3 rounded-lg text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      {t("settings.remoteDBDisconnect")}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setTursoOpen((open) => !open)}
                    aria-expanded={tursoOpen}
                    className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
                  >
                    {t("settings.remoteDBConnect")}
                  </Button>
                )}
              </div>
            </SettingRow>

            {tursoOpen && !isRemote && (
              <div className="space-y-3">
                {/* Appearance settings live in user_settings, i.e. in the database
                    itself, so connecting to an empty one reads as "everything was
                    reset". Say so before they click, not after. */}
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-500">
                    {t("settings.remoteDBWarnTitle")}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {t("settings.remoteDBWarnBody")}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {t("settings.remoteDBWarnSafe")}
                  </p>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">{t("settings.remoteDBUrl")}</span>
                  <input
                    value={tursoUrl}
                    onChange={(e) => setTursoUrl(e.target.value)}
                    placeholder={t("settings.remoteDBUrlPlaceholder")}
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-hidden focus:border-primary"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">{t("settings.remoteDBToken")}</span>
                  <input
                    type="password"
                    value={tursoToken}
                    onChange={(e) => setTursoToken(e.target.value)}
                    placeholder={t("settings.remoteDBTokenPlaceholder")}
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-hidden focus:border-primary"
                  />
                  <span className="block text-[11px] text-muted-foreground">{t("settings.remoteDBTokenHint")}</span>
                  {rememberedTurso?.tokenPresent && !tursoToken.trim() && (
                    <span className="mt-1 block text-[11px] font-medium text-primary">{t("settings.remoteDBTokenSaved")}</span>
                  )}
                </label>
                <div className="flex justify-end">
                  <Button
                    onClick={handleConnectTurso}
                    disabled={connecting || !tursoUrl.trim() || (!tursoToken.trim() && !rememberedTurso?.tokenPresent)}
                    className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {connecting ? t("settings.remoteDBConnecting") : t("settings.remoteDBConnect")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Object storage for the files a database row cannot hold. Not tied to
        * the local/cloud tab: which database you use and where big files go
        * are independent choices, and hiding this behind a tab meant the usage
        * figure was invisible unless you happened to be on the right one. */}
      <R2Section />

      <div className="bg-card border border-border rounded-xl px-5 divide-y divide-border">
        <SettingRow
          label={t("settings.importDB")}
          sub={canImport ? t("settings.importDBSub") : t("settings.importDBUnavailable")}
        >
          <Button
            variant="outline"
            onClick={handleChooseImportFile}
            disabled={analyzing || !canImport}
            className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {analyzing ? t("settings.importDBAnalyzing") : t("settings.importDBChoose")}
          </Button>
        </SettingRow>

        <SettingRow
          label={t("settings.exportDB")}
          sub={canExport ? t("settings.exportDBSub") : t("settings.exportUnavailableRemote")}
        >
          <Button
            size="icon"
            onClick={handleExport}
            disabled={exporting || !canExport}
            title={exporting ? t("settings.exporting") : t("settings.exportDB")}
            aria-label={exporting ? t("settings.exporting") : t("settings.exportDB")}
            className="h-8 w-8 rounded-lg disabled:opacity-50 transition-colors"
          >
            <DownloadIcon className={`w-4 h-4 ${exporting ? "animate-pulse" : ""}`} />
          </Button>
        </SettingRow>
      </div>

      <div className="bg-destructive/5 border border-destructive/20 rounded-xl px-5">
        <SettingRow label={t("settings.dangerClearTranslations")} sub={t("settings.dangerClearTranslationsSub")}>
          <Button
            variant="ghost"
            onClick={handleClearTranslations}
            className={`h-8 px-4 rounded-lg text-xs font-semibold transition-colors ${
              confirmClear
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "border border-destructive/40 text-destructive hover:bg-destructive/10"
            }`}
          >
            {confirmClear ? t("settings.dangerConfirm") : t("settings.dangerClear")}
          </Button>
        </SettingRow>
      </div>

      <ConfirmModal
        open={pendingSwitchPath !== null}
        title={t("settings.switchDBConfirmTitle")}
        message={t("settings.switchDBConfirmMessage")}
        confirmLabel={switching ? t("settings.switching") : t("settings.switchDB")}
        danger={false}
        confirmDisabled={switching}
        onCancel={() => setPendingSwitchPath(null)}
        onConfirm={confirmSwitch}
      />

      <BackupPasswordDialog
        open={showExportPassword}
        mode="export"
        onCancel={() => setShowExportPassword(false)}
        onPlain={() => {
          setShowExportPassword(false);
          void startExport(null);
        }}
        onConfirm={(password) => {
          setShowExportPassword(false);
          void startExport(password);
        }}
      />

      <BackupPasswordDialog
        open={showImportPassword}
        mode="import"
        onCancel={() => {
          setShowImportPassword(false);
          setPendingImportPath(null);
        }}
        onConfirm={(password) => {
          setImportPassword(password);
          setShowImportPassword(false);
          if (pendingImportPath) void analyzeImport(pendingImportPath, password);
        }}
      />

      {importPlan && (
        <ImportPreviewModal
          plan={importPlan}
          importing={importing}
          onCancel={() => {
            setImportPlan(null);
            setPendingImportPath(null);
            setImportPassword("");
          }}
          onConfirm={handleImport}
          t={t}
        />
      )}

      <ConfirmModal
        open={confirmDisconnect}
        title={t("settings.remoteDBDisconnectTitle")}
        message={t("settings.remoteDBDisconnectMessage")}
        confirmLabel={t("settings.remoteDBDisconnect")}
        danger
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
      />
    </div>
  );
}
