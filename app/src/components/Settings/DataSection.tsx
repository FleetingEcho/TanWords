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
  const { confirmClear, pendingSwitchPath, switching, isRemote, setConfirmClear, setPendingSwitchPath, showExportPassword, pendingExportSource, showImportPassword, pendingImportPath, importPassword, importPlan, analyzing, importing, importProgress, importError, pendingOverwritePath, overwriting, overwriteProgress, postgresRemoteBusy, confirmRotatePostgresRemote, setConfirmRotatePostgresRemote, confirmDisconnect, setConfirmDisconnect, handleDisconnect, confirmSwitch, analyzeImport, handleImport, confirmOverwrite, handleConfirmRotatePostgresRemote, startExport, setImportPlan, setImportPassword, setImportError, setShowExportPassword, setShowImportPassword, setPendingImportPath, handleClearTranslations } = data;

  return (
    <div className="space-y-3">
      <DataSectionDatabaseCard data={data} t={t} />

      <ConfirmModal
        open={confirmRotatePostgresRemote}
        title={t("settings.remoteAccessRotateConfirmTitle")}
        message={t("settings.remoteAccessRotateConfirmMessage")}
        confirmLabel={postgresRemoteBusy ? t("settings.remoteAccessWorking") : t("settings.remoteAccessRotate")}
        danger
        confirmDisabled={postgresRemoteBusy}
        onCancel={() => setConfirmRotatePostgresRemote(false)}
        onConfirm={handleConfirmRotatePostgresRemote}
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
        onCancel={() => setPendingSwitchPath(null)}
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
