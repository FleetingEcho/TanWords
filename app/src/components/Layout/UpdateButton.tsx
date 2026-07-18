import React, { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { UpgradeIcon } from "@/components/ui/icons";
import { useUpdaterStore } from "@/store/updaterStore";
import { useT } from "@/hooks/useT";

const RELEASES_URL = "https://github.com/FleetingEcho/TanWords/releases/latest";

export function UpdateButton({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const { status, version, notes, progress, error, checkForUpdate, downloadAndInstall, restart } =
    useUpdaterStore();
  const [open, setOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const hasUpdate = status === "available" || status === "downloading" || status === "ready";

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // First manual open with nothing known yet — check on the spot.
    if (next && (status === "idle" || status === "upToDate" || status === "error")) {
      checkForUpdate();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          title={collapsed ? t("updater.tooltip") : undefined}
          className={`h-auto w-full flex items-center rounded-lg text-sm font-medium transition-colors duration-100 text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--muted))] ${
            collapsed ? "justify-center px-0 py-[9px]" : "gap-2.5 px-3 py-[7px]"
          }`}
        >
          <span className="relative shrink-0">
            <UpgradeIcon className="w-[18px] h-[18px]" />
            {hasUpdate && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
          </span>
          {!collapsed && <span className="flex-1 text-left">{t("updater.tooltip")}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold">{t("updater.title")}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {hasUpdate ? `${currentVersion} → ${version}` : `v${currentVersion}`}
            </p>
          </div>

          {status === "checking" && (
            <p className="text-sm text-muted-foreground animate-pulse">{t("updater.checking")}</p>
          )}

          {(status === "idle" || status === "upToDate") && (
            <>
              {status === "upToDate" && (
                <p className="text-sm text-muted-foreground">{t("updater.upToDate")}</p>
              )}
              <Button size="sm" variant="outline" className="w-full" onClick={() => checkForUpdate()}>
                {t("updater.checkNow")}
              </Button>
            </>
          )}

          {hasUpdate && notes && (
            <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2.5 text-xs whitespace-pre-wrap text-muted-foreground">
              {notes}
            </div>
          )}

          {status === "available" && (
            <>
              {error && <p className="text-xs text-destructive">{t("updater.error")}: {error}</p>}
              <Button size="sm" className="w-full" onClick={downloadAndInstall}>
                {error ? t("updater.retry") : t("updater.downloadInstall")}
              </Button>
            </>
          )}

          {status === "downloading" && (
            <div className="space-y-1.5">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {progress >= 100
                  ? t("updater.installing")
                  : t("updater.downloading", { percent: progress })}
              </p>
            </div>
          )}

          {status === "ready" && (
            <>
              <Button size="sm" className="w-full" onClick={restart}>
                {t("updater.restart")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("updater.restartHint")}</p>
            </>
          )}

          {status === "error" && (
            <>
              <p className="text-xs text-destructive break-all">{t("updater.error")}: {error}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => checkForUpdate()}>
                  {t("updater.retry")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => openUrl(RELEASES_URL)}
                >
                  {t("updater.openRelease")}
                </Button>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
