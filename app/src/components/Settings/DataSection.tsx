import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { isDesktopHost } from "@/platform";
import { R2Section } from "./R2Section";
import { ImportPreviewModal } from "./ImportPreviewModal";
import { ImportErrorModal } from "./ImportErrorModal";
import { BackupPasswordDialog } from "./BackupPasswordDialog";
import { useDataSection } from "./useDataSection";
import { DataSectionDatabaseCard } from "./DataSectionDatabaseCard";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { SettingRow } from "./SettingsShared";

export function DataSection({ db, t }: { db: ReturnType<typeof useDB>; t: ReturnType<typeof useT> }) {
  const data = useDataSection(db, t);
  const { dbPath, defaultLocalPath, dbSize, connection, exporting, confirmClear, pendingSwitchPath, switching, activeTab, cloudBackend, tursoOpen, tursoUrl, tursoToken, rememberedTurso, connecting, postgresOpen, postgresUrl, connectingPostgres, confirmDisconnect, syncing, stuckTursoWarning, forgetting, showExportPassword, pendingExportSource, showImportPassword, pendingImportPath, importPassword, importPlan, analyzing, importing, importProgress, importError, pendingOverwritePath, overwriting, overwriteProgress, postgresExportProgress, vacuuming, remoteAccess, remoteAccessBusy, confirmRotateRemote, confirmDisableRemote, remoteAccessToken, isRemote, isOffline, canExport, canSwitchPath, canImport, canVacuum, formattedDbSize, setDbPath, setDbSize, setConnection, setExporting, setConfirmClear, setPendingSwitchPath, setSwitching, setActiveTab, setCloudBackend, setTursoOpen, setTursoUrl, setTursoToken, setRememberedTurso, setConnecting, setPostgresOpen, setPostgresUrl, setConfirmDisconnect, setSyncing, setStuckTursoWarning, setForgetting, setShowExportPassword, setPendingExportSource, setShowImportPassword, setPendingImportPath, setImportPassword, setImportPlan, setAnalyzing, setImporting, setImportError, setPendingOverwritePath, setConfirmRotateRemote, setConfirmDisableRemote, setRemoteAccessToken, handleOpenExisting, handleNewLocation, confirmSwitch, handleConnectTurso, handleConnectPostgres, handleSelectSource, handleDisconnect, handleForgetSavedConnection, handleSyncNow, handleChooseImportFile, analyzeImport, handleImport, handleChooseOverwriteFile, confirmOverwrite, handleVacuum, handleEnableRemote, handleConfirmRotateRemote, handleConfirmDisableRemote, startExport, handleExport, handleClearTranslations } = data;

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

      <DataSectionDatabaseCard data={data} t={t} />

      {/* Web-only: this account's dedicated sqld container, so a desktop app
        * can connect directly (Settings > Cloud tab there) and share this
        * account's data live. Unrelated to the local/cloud tabs above (a
        * user-supplied external Turso/self-hosted target) — this one the
        * server provisions and manages per account. */}
      {!isDesktopHost && (
        <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t("settings.remoteAccessTitle")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.remoteAccessSub")}</p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                remoteAccess?.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {t(remoteAccess?.enabled ? "settings.remoteAccessOn" : "settings.remoteAccessOff")}
            </span>
          </div>

          {remoteAccess?.enabled ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-lg border border-input bg-background px-3 py-2 font-mono text-[11px]" title={remoteAccess.url ?? ""}>
                  {remoteAccess.url}
                </span>
                <Button
                  variant="outline"
                  onClick={() => remoteAccess.url && navigator.clipboard.writeText(remoteAccess.url)}
                  className="h-8 shrink-0 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
                >
                  {t("settings.remoteAccessCopyUrl")}
                </Button>
              </div>

              {remoteAccessToken && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 space-y-1.5">
                  <p className="text-[11px] font-medium text-amber-600 dark:text-amber-500">{t("settings.remoteAccessTokenWarn")}</p>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate rounded-lg border border-input bg-background px-3 py-1.5 font-mono text-[11px]" title={remoteAccessToken}>
                      {remoteAccessToken}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => navigator.clipboard.writeText(remoteAccessToken)}
                      className="h-7 shrink-0 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
                    >
                      {t("settings.remoteAccessCopyToken")}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmRotateRemote(true)}
                  disabled={remoteAccessBusy}
                  className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {t("settings.remoteAccessRotate")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmDisableRemote(true)}
                  disabled={remoteAccessBusy}
                  className="h-8 px-3 rounded-lg text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                >
                  {t("settings.remoteAccessDisable")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={handleEnableRemote}
              disabled={remoteAccessBusy}
              className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {remoteAccessBusy ? t("settings.remoteAccessWorking") : t("settings.remoteAccessEnable")}
            </Button>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmRotateRemote}
        title={t("settings.remoteAccessRotateConfirmTitle")}
        message={t("settings.remoteAccessRotateConfirmMessage")}
        confirmLabel={remoteAccessBusy ? t("settings.remoteAccessWorking") : t("settings.remoteAccessRotate")}
        danger
        confirmDisabled={remoteAccessBusy}
        onCancel={() => setConfirmRotateRemote(false)}
        onConfirm={handleConfirmRotateRemote}
      />

      <ConfirmModal
        open={confirmDisableRemote}
        title={t("settings.remoteAccessDisableConfirmTitle")}
        message={t("settings.remoteAccessDisableConfirmMessage")}
        confirmLabel={remoteAccessBusy ? t("settings.remoteAccessWorking") : t("settings.remoteAccessDisable")}
        danger
        confirmDisabled={remoteAccessBusy}
        onCancel={() => setConfirmDisableRemote(false)}
        onConfirm={handleConfirmDisableRemote}
      />

      {/* Directly under the database card, outside the local/cloud tabs: the R2
        * configuration lives *in the current database* (the `r2_config`
        * table), so it belongs to whichever database is open rather than to
        * one of the two ways of opening one. Behind a tab it would also be
        * unreachable for local-database users, who can use a bucket too. */}
      <R2Section />

      {/* Gate on `!isRemote` (which database is actually active), not on
        * `activeTab` (which tab you're looking at) — those two can differ,
        * e.g. viewing the Local tab while still connected to Postgres. This
        * always targets the live connection, so the visible tab must not be
        * what decides it. Unlike overwrite-import (which explicitly targets
        * "whichever database is active" and says so), clearing translations
        * on a Cloud connection would wipe shared/synced data other devices
        * are reading — too easy to reach for what's meant to be tidying up
        * your own local scratch history. The whole card (not just its
        * content) is gated: an empty `divide-y`-bordered div still renders
        * its border with nothing inside, showing as a stray colored line. */}
      {!isRemote && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl px-5 divide-y divide-destructive/20">
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
      )}

      <ConfirmModal
        open={pendingOverwritePath !== null}
        title={t("settings.importOverwriteConfirmTitle")}
        message={
          overwriting && overwriteProgress
            ? `${t(`settings.importOverwritePhase.${overwriteProgress.phase}`)} ${overwriteProgress.table} (${overwriteProgress.tableIndex}/${overwriteProgress.tableTotal})`
            : t("settings.importOverwriteConfirmMessage", { path: pendingOverwritePath ?? "" })
        }
        confirmLabel={overwriting ? t("settings.importOverwriteWorking") : t("settings.importOverwriteConfirm")}
        danger
        confirmDisabled={overwriting}
        onCancel={() => setPendingOverwritePath(null)}
        onConfirm={confirmOverwrite}
      />

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
          progress={importProgress}
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
        title={t(isDesktopHost ? "settings.remoteDBDisconnectTitle" : "settings.dbUseLocalTitle")}
        message={t(isDesktopHost ? "settings.remoteDBDisconnectMessage" : "settings.dbUseLocalMessage")}
        confirmLabel={t(isDesktopHost ? "settings.remoteDBDisconnect" : "settings.dbUseLocal")}
        danger
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
      />

      {/* Import/overwrite-import/analyze failures land here instead of only a
        * transient toast — the underlying preview/dialog state is left alone
        * (see the catch blocks in useDataSection) so dismissing this and
        * retrying doesn't require reselecting the file. */}
      <ImportErrorModal
        open={importError !== null}
        title={t("settings.importErrorTitle")}
        message={importError ?? ""}
        onClose={() => setImportError(null)}
        t={t}
      />
    </div>
  );
}

