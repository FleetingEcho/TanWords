import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { isDesktopHost } from "@/platform";
import { R2Section } from "./R2Section";
import { ImportPreviewModal } from "./ImportPreviewModal";
import { BackupPasswordDialog } from "./BackupPasswordDialog";
import { useDataSection } from "./useDataSection";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { DownloadIcon } from "@/components/ui/icons";
import { SettingRow, ToggleGroup } from "./SettingsShared";

export function DataSection({ db, t }: { db: ReturnType<typeof useDB>; t: ReturnType<typeof useT> }) {
  const { dbPath, dbSize, connection, exporting, confirmClear, pendingSwitchPath, switching, activeTab, tursoOpen, tursoUrl, tursoToken, rememberedTurso, connecting, confirmDisconnect, syncing, stuckTursoWarning, forgetting, showExportPassword, pendingExportSource, showImportPassword, pendingImportPath, importPassword, importPlan, analyzing, importing, importProgress, pendingOverwritePath, overwriting, overwriteProgress, vacuuming, remoteAccess, remoteAccessBusy, confirmRotateRemote, confirmDisableRemote, remoteAccessToken, isRemote, isOffline, canExport, canSwitchPath, canImport, canVacuum, formattedDbSize, setDbPath, setDbSize, setConnection, setExporting, setConfirmClear, setPendingSwitchPath, setSwitching, setActiveTab, setTursoOpen, setTursoUrl, setTursoToken, setRememberedTurso, setConnecting, setConfirmDisconnect, setSyncing, setStuckTursoWarning, setForgetting, setShowExportPassword, setPendingExportSource, setShowImportPassword, setPendingImportPath, setImportPassword, setImportPlan, setAnalyzing, setImporting, setPendingOverwritePath, setConfirmRotateRemote, setConfirmDisableRemote, setRemoteAccessToken, handleOpenExisting, handleNewLocation, confirmSwitch, handleConnectTurso, handleSelectSource, handleDisconnect, handleForgetSavedConnection, handleSyncNow, handleChooseImportFile, analyzeImport, handleImport, handleChooseOverwriteFile, confirmOverwrite, handleVacuum, handleEnableRemote, handleConfirmRotateRemote, handleConfirmDisableRemote, startExport, handleExport, handleClearTranslations } = useDataSection(db, t);

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
            <SettingRow label={t("settings.dbLocalSource")} sub={t("settings.dbLocalSourceSub")}>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  !isRemote ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {t(!isRemote ? "settings.dbSourceActive" : "settings.dbSourceInactive")}
                </span>
                {isRemote && (
                  <Button
                    variant="outline"
                    onClick={() => void handleSelectSource("local")}
                    disabled={switching}
                    className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted disabled:opacity-50"
                  >
                    {switching ? t("settings.switching") : t("settings.dbUseLocal")}
                  </Button>
                )}
              </div>
            </SettingRow>
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
                      {t(isDesktopHost ? "settings.remoteDBDisconnect" : "settings.dbUseLocal")}
                    </Button>
                  </>
                ) : (
                  <>
                    {!isDesktopHost && rememberedTurso?.tokenPresent && rememberedTurso.url && (
                      <Button
                        variant="outline"
                        onClick={() => void handleSelectSource("turso")}
                        disabled={switching}
                        className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted disabled:opacity-50"
                      >
                        {switching ? t("settings.switching") : t("settings.dbUseReplica")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => setTursoOpen((open) => !open)}
                      aria-expanded={tursoOpen}
                      className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
                    >
                      {t(rememberedTurso?.tokenPresent ? "settings.dbChangeTurso" : "settings.remoteDBConnect")}
                    </Button>
                  </>
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
                    disabled={connecting || !tursoUrl.trim()}
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
          sub={isDesktopHost
            ? (canExport ? t("settings.exportDBSub") : t("settings.exportUnavailableRemote"))
            : t("settings.exportBothDBSub")}
        >
          {isDesktopHost ? (
            <Button
              size="icon"
              onClick={() => handleExport("local")}
              disabled={exporting || !canExport}
              title={exporting ? t("settings.exporting") : t("settings.exportDB")}
              aria-label={exporting ? t("settings.exporting") : t("settings.exportDB")}
              className="h-8 w-8 rounded-lg disabled:opacity-50 transition-colors"
            >
              <DownloadIcon className={`w-4 h-4 ${exporting ? "animate-pulse" : ""}`} />
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => handleExport("local")}
                disabled={exporting}
                className="h-8 gap-1.5 px-3 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {t("settings.exportLocalDB")}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport("turso")}
                disabled={exporting || !rememberedTurso?.tokenPresent}
                className="h-8 gap-1.5 px-3 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {t("settings.exportReplicaDB")}
              </Button>
            </div>
          )}
        </SettingRow>

        {isDesktopHost && (
          <SettingRow
            label={t("settings.vacuumDB")}
            sub={canVacuum ? t("settings.vacuumDBSub") : t("settings.vacuumDBUnavailableRemote")}
          >
            <Button
              variant="outline"
              onClick={handleVacuum}
              disabled={vacuuming || !canVacuum}
              className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {vacuuming ? t("settings.vacuumDBWorking") : t("settings.vacuumDBChoose")}
            </Button>
          </SettingRow>
        )}
      </div>

      <div className="bg-destructive/5 border border-destructive/20 rounded-xl px-5 divide-y divide-destructive/20">
        <SettingRow label={t("settings.importOverwrite")} sub={t("settings.importOverwriteSub")}>
          <Button
            variant="ghost"
            onClick={handleChooseOverwriteFile}
            disabled={overwriting || !canImport}
            className="h-8 px-4 rounded-lg text-xs font-semibold border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
          >
            {overwriting ? t("settings.importOverwriteWorking") : t("settings.importOverwriteChoose")}
          </Button>
        </SettingRow>

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
    </div>
  );
}

