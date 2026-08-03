import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock, Unlock } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { disableAppLock, setAppLockPassword, useAppLockStore } from "@/store/appLockStore";
import { useSettingsStore } from "@/store/settingsStore";
import { WallpaperSetting } from "./WallpaperSetting";
import { APP_BG_MAX_DIMENSION, MAX_APP_BG_UPLOAD_BYTES, fileToDownscaledDataUrl } from "./GeneralSection";

const FIELD =
  "h-8 w-full rounded-lg border border-input bg-background px-3 text-xs outline-hidden focus:ring-2 focus:ring-primary/30";

/** Set, change, or remove the password that gates the app at launch, plus the
 *  wallpaper shown behind the lock screen.
 *
 *  Changing or removing always asks for the current password: without that,
 *  anyone sitting at an already-unlocked window could quietly take the lock
 *  off, which makes the lock pointless the moment you step away. */
export function AppLockSection() {
  const t = useT();
  const enabled = useAppLockStore((s) => s.enabled);
  const refresh = useAppLockStore((s) => s.refresh);

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void refresh(); }, [refresh]);

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setOpen(false); };

  const save = async () => {
    if (next !== confirm) {
      toast.error(t("lock.mismatch"));
      return;
    }
    setBusy(true);
    try {
      await setAppLockPassword(enabled ? current : null, next);
      toast.success(enabled ? t("lock.changed") : t("lock.enabled"));
      reset();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current) {
      toast.error(t("lock.needCurrent"));
      return;
    }
    setBusy(true);
    try {
      await disableAppLock(current);
      toast.success(t("lock.disabled"));
      reset();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            {enabled ? <Lock className="h-4 w-4 text-primary" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
            {t("lock.settingsTitle")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {enabled ? t("lock.settingsOn") : t("lock.settingsOff")}
          </p>
          <p className="mt-1 hidden text-[11px] text-muted-foreground/75 lg:block">
            {t("lock.settingsCaveat")}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => (open ? reset() : setOpen(true))}
          className="h-8 shrink-0 rounded-lg px-3 text-xs"
        >
          {open ? t("common.cancel") : enabled ? t("lock.change") : t("lock.setUp")}
        </Button>
      </div>

      {open && (
        <div className="space-y-2.5 border-t border-border pt-3">
          {enabled && (
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{t("lock.currentPassword")}</span>
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={FIELD} />
            </label>
          )}
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("lock.newPassword")}</span>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={FIELD} />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("lock.confirmPassword")}</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={FIELD} />
          </label>
          <div className="flex items-center justify-end gap-2">
            {enabled && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void remove()}
                className="h-8 rounded-lg px-3 text-xs text-destructive hover:bg-destructive/10"
              >
                {t("lock.turnOff")}
              </Button>
            )}
            <Button
              disabled={busy || next.length < 4 || (enabled === true && !current)}
              onClick={() => void save()}
              className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? t("lock.saving") : t("lock.save")}
            </Button>
          </div>
        </div>
      )}

      {/* Its own picture and sliders — same component the app background uses,
        * so the two look and behave alike without sharing a setting. */}
      <div className="border-t border-border pt-1">
        <WallpaperSetting
          label={t("lock.wallpaper")}
          sub={t("lock.wallpaperSub")}
          emptyLabel={t("settings.appBackgroundNone")}
          maxDimension={APP_BG_MAX_DIMENSION}
          maxBytes={MAX_APP_BG_UPLOAD_BYTES}
          processFile={fileToDownscaledDataUrl}
          image={useSettingsStore((s) => s.lockScreenImage)}
          setImage={useSettingsStore((s) => s.setLockScreenImage)}
          blur={useSettingsStore((s) => s.lockScreenBlur)}
          setBlur={useSettingsStore((s) => s.setLockScreenBlur)}
          visible={useSettingsStore((s) => s.lockScreenVisible)}
          setVisible={useSettingsStore((s) => s.setLockScreenVisible)}
        />
      </div>

    </div>
  );
}
