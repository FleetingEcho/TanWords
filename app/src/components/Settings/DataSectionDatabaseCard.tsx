import { useT } from "@/hooks/useT";
import { isDesktopHost } from "@/platform";
import { useDataSection } from "./useDataSection";
import { Button } from "@/components/ui/button";
import { DownloadIcon } from "@/components/ui/icons";
import { SettingRow, ToggleGroup } from "./SettingsShared";

export function DataSectionDatabaseCard({ data, t }: { data: ReturnType<typeof useDataSection>; t: ReturnType<typeof useT> }) {
  const { dbPath, defaultLocalPath, dbSize, connection, exporting, confirmClear, pendingSwitchPath, switching, activeTab, postgresOpen, postgresUrl, connectingPostgres, confirmDisconnect, syncing, showExportPassword, pendingExportSource, showImportPassword, pendingImportPath, importPassword, importPlan, analyzing, importing, importProgress, importError, pendingOverwritePath, overwriting, overwriteProgress, postgresExportProgress, vacuuming, postgresRemote, postgresRemoteBusy, confirmRotatePostgresRemote, postgresRemoteJustRevealed, isRemote, isOffline, canExport, canSwitchPath, canImport, canVacuum, formattedDbSize, setDbPath, setDbSize, setConnection, setExporting, setConfirmClear, setPendingSwitchPath, setSwitching, setActiveTab, setPostgresOpen, setPostgresUrl, setConfirmDisconnect, setSyncing, setShowExportPassword, setPendingExportSource, setShowImportPassword, setPendingImportPath, setImportPassword, setImportPlan, setAnalyzing, setImporting, setImportError, setPendingOverwritePath, setConfirmRotatePostgresRemote, handleOpenExisting, handleNewLocation, confirmSwitch, handleConnectPostgres, handleDisablePostgresRemote, handleDisconnect, handleSyncNow, handleChooseImportFile, analyzeImport, handleImport, handleChooseOverwriteFile, confirmOverwrite, handleVacuum, handleEnablePostgresRemote, handleConfirmRotatePostgresRemote, startExport, handleExport, handleClearTranslations } = data;

  return (
      <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-4">
        <ToggleGroup
          options={[
            { id: "local", label: t("settings.dbTabLocal") },
            { id: "cloud", label: t("settings.dbTabCloud") },
          ]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as "local" | "cloud")}
          className="w-fit mx-auto"
          optionClassName={(active) =>
            active
              ? "bg-background text-foreground shadow-xs font-semibold"
              : "text-foreground/70 hover:text-foreground"
          }
        />

        {/* Tab-aware, not just connection-aware: this line describes
          * whichever tab is open, not always "the active connection" —
          * otherwise the Local tab shows a Postgres URL under a heading that
          * says "Local", which reads as contradictory next to the "not
          * available" message the tab already shows below it. */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="min-w-0 flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                isOffline ? "bg-destructive" : isRemote ? "bg-primary" : "bg-muted-foreground/40"
              }`}
              aria-hidden
            />
            {activeTab === "cloud" ? (
              isRemote ? (
                <span className="min-w-0 truncate font-mono text-[11px] text-primary" title={connection?.remoteUrl ?? ""}>
                  {connection?.remoteUrl}
                </span>
              ) : (
                <span className="max-w-[320px] truncate font-mono text-[11px] text-muted-foreground">
                  {t("settings.dbTabCloudNotConnected")}
                </span>
              )
            ) : isDesktopHost ? (
              <span
                className="min-w-0 max-w-[320px] truncate font-mono text-[11px] text-muted-foreground"
                title={isRemote ? `${t("settings.dbTabLocalNotActiveNote")}: ${defaultLocalPath}` : dbPath}
              >
                {isRemote ? `(${t("settings.dbTabLocalNotActiveNote")}) ` : ""}{(isRemote ? defaultLocalPath : dbPath) || "…"}
              </span>
            ) : (
              <span className="max-w-[320px] truncate font-mono text-[11px] text-muted-foreground">
                {t("settings.dbLocationServer")}
              </span>
            )}
          </div>
          <span className="shrink-0 rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground" title={t("settings.dbSizeIncludesAuxiliary")}>{formattedDbSize}</span>
        </div>

        {activeTab === "local" ? (
          <>
          {isDesktopHost && canSwitchPath ? (
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
                    onClick={handleDisablePostgresRemote}
                    disabled={postgresRemoteBusy}
                    className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted disabled:opacity-50"
                  >
                    {postgresRemoteBusy ? t("settings.switching") : t("settings.dbUseLocal")}
                  </Button>
                )}
              </div>
            </SettingRow>
          )}

          {!isRemote && (
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
                  : t("settings.exportLocalDBSub")}
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
                  <Button
                    variant="outline"
                    onClick={() => handleExport("local")}
                    disabled={exporting}
                    className="h-8 gap-1.5 px-3 rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    {t("settings.exportLocalDB")}
                  </Button>
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
          )}

          {!isRemote && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-xl px-5 divide-y divide-destructive/20">
              <SettingRow label={t("settings.importOverwrite")} sub={t("settings.importOverwriteSubLocal")}>
                <Button
                  variant="ghost"
                  onClick={handleChooseOverwriteFile}
                  disabled={overwriting || !canImport}
                  className="h-8 px-4 rounded-lg text-xs font-semibold border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                >
                  {overwriting ? t("settings.importOverwriteWorking") : t("settings.importOverwriteChoose")}
                </Button>
              </SettingRow>
            </div>
          )}
          </>
        ) : (
          <div className="space-y-3">
            {isDesktopHost ? (
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
                      onClick={() => setPostgresOpen((open) => !open)}
                      aria-expanded={postgresOpen}
                      className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
                    >
                      {t("settings.remoteDBConnect")}
                    </Button>
                  )}
                </div>
              </SettingRow>
            ) : (
              <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{t("settings.remoteAccessTitle")}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.remoteAccessSub")}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      postgresRemote?.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t(postgresRemote?.enabled ? "settings.remoteAccessOn" : "settings.remoteAccessOff")}
                  </span>
                </div>

                {postgresRemote?.enabled ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate rounded-lg border border-input bg-background px-3 py-2 font-mono text-[11px]" title={postgresRemote.url ?? ""}>
                        {postgresRemote.url}
                      </span>
                      <Button
                        variant="outline"
                        onClick={() => postgresRemote.url && navigator.clipboard.writeText(postgresRemote.url)}
                        className="h-8 shrink-0 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
                      >
                        {t("settings.remoteAccessCopyUrl")}
                      </Button>
                    </div>

                    {postgresRemoteJustRevealed && (
                      <p className="text-[11px] font-medium text-amber-600 dark:text-amber-500">
                        {t("settings.remoteAccessTokenWarn")}
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setConfirmRotatePostgresRemote(true)}
                        disabled={postgresRemoteBusy}
                        className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted disabled:opacity-50 transition-colors"
                      >
                        {t("settings.remoteAccessRotate")}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmDisconnect(true)}
                        disabled={postgresRemoteBusy}
                        className="h-8 px-3 rounded-lg text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                      >
                        {t("settings.remoteAccessDisable")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    onClick={handleEnablePostgresRemote}
                    disabled={postgresRemoteBusy}
                    className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {postgresRemoteBusy ? t("settings.remoteAccessWorking") : t("settings.remoteAccessEnable")}
                  </Button>
                )}
              </div>
            )}

            {postgresOpen && !isRemote && isDesktopHost && (
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
                  <span className="text-xs font-medium text-foreground">{t("settings.remoteDBPostgresUrl")}</span>
                  <input
                    type="password"
                    value={postgresUrl}
                    onChange={(e) => setPostgresUrl(e.target.value)}
                    placeholder={t("settings.remoteDBPostgresUrlPlaceholder")}
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-hidden focus:border-primary"
                  />
                  <span className="block text-[11px] text-muted-foreground">{t("settings.remoteDBPostgresUrlHint")}</span>
                </label>
                <div className="flex justify-end">
                  <Button
                    onClick={handleConnectPostgres}
                    disabled={connectingPostgres || !postgresUrl.trim()}
                    className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {connectingPostgres ? t("settings.remoteDBConnecting") : t("settings.remoteDBConnect")}
                  </Button>
                </div>
              </div>
            )}

            {isRemote && (
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

                {isDesktopHost && connection?.kind === "postgres" && (
                  <>
                    <SettingRow label={t("settings.exportDB")} sub={t("settings.exportPostgresDBSub")}>
                      <Button
                        size="icon"
                        onClick={() => handleExport("postgres")}
                        disabled={exporting}
                        title={exporting ? t("settings.exporting") : t("settings.exportDB")}
                        aria-label={exporting ? t("settings.exporting") : t("settings.exportDB")}
                        className="h-8 w-8 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        <DownloadIcon className={`w-4 h-4 ${exporting ? "animate-pulse" : ""}`} />
                      </Button>
                    </SettingRow>
                    {/* Table-by-table copy over the network can take a while
                      * for a real-sized database — a bare spinner with no
                      * sense of progress reads as hung. */}
                    {exporting && postgresExportProgress && (
                      <div className="space-y-1 pb-3.5">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            {t(`settings.importOverwritePhase.${postgresExportProgress.phase}`)}{" "}
                            {postgresExportProgress.table} ({postgresExportProgress.tableIndex}/{postgresExportProgress.tableTotal})
                          </span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                              width: `${Math.min(
                                100,
                                (postgresExportProgress.tableIndex / postgresExportProgress.tableTotal) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {isRemote && (
              <div className="bg-destructive/5 border border-destructive/20 rounded-xl px-5 divide-y divide-destructive/20">
                <SettingRow label={t("settings.importOverwrite")} sub={t("settings.importOverwriteSubCloud")}>
                  <Button
                    variant="ghost"
                    onClick={handleChooseOverwriteFile}
                    disabled={overwriting || !canImport}
                    className="h-8 px-4 rounded-lg text-xs font-semibold border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                  >
                    {overwriting ? t("settings.importOverwriteWorking") : t("settings.importOverwriteChoose")}
                  </Button>
                </SettingRow>
              </div>
            )}
          </div>
        )}
      </div>
  );
}
