import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock, Trash2, Unlock } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { disableAppLock, setAppLockPassword, useAppLockStore } from "@/store/appLockStore";
import { AUTO_LOCK_CHOICES, DEFAULT_BANNER_POSITION, useSettingsStore } from "@/store/settingsStore";
import { WallpaperSetting } from "./WallpaperSetting";
import { BannerPositionModal } from "./BannerPositionModal";
import { APP_BG_MAX_DIMENSION, MAX_APP_BG_UPLOAD_BYTES, fileToDownscaledDataUrl } from "./GeneralSection";
import { maskedPasswordProps } from "@/lib/maskedInput";

const FIELD =
  "h-8 w-full rounded-lg border border-input bg-background px-3 text-xs outline-hidden focus:ring-2 focus:ring-primary/30";

/** Set, change, or remove the password that gates the app at launch, plus the
 *  wallpaper shown behind the lock screen.
 *
 *  Changing or removing always asks for the current password: without that,
 *  anyone sitting at an already-unlocked window could quietly take the lock
 *  off, which makes the lock pointless the moment you step away. Turning off
 *  is its own confirm modal (just the current password) rather than living
 *  inside the change-password panel, which otherwise forced you through
 *  New/Confirm fields you have no intention of filling in just to turn the
 *  lock off. */
export function AppLockSection() {
  const t = useT();
  const enabled = useAppLockStore((s) => s.enabled);
  const refresh = useAppLockStore((s) => s.refresh);
  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes);
  const setAutoLockMinutes = useSettingsStore((s) => s.setAutoLockMinutes);

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnOffOpen, setTurnOffOpen] = useState(false);

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
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => (open ? reset() : setOpen(true))}
            className="h-8 rounded-lg px-3 text-xs"
          >
            {open ? t("common.cancel") : enabled ? t("lock.change") : t("lock.setUp")}
          </Button>
          {enabled && !open && (
            <Button
              variant="outline"
              size="icon"
              disabled={busy}
              onClick={() => setTurnOffOpen(true)}
              title={t("lock.turnOff")}
              aria-label={t("lock.turnOff")}
              className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-2.5 border-t border-border pt-3">
          {enabled && (
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{t("lock.currentPassword")}</span>
              <input {...maskedPasswordProps("app-lock-current")} value={current} onChange={(e) => setCurrent(e.target.value)} className={FIELD} />
            </label>
          )}
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("lock.newPassword")}</span>
            <input {...maskedPasswordProps("app-lock-new")} value={next} onChange={(e) => setNext(e.target.value)} className={FIELD} />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("lock.confirmPassword")}</span>
            <input {...maskedPasswordProps("app-lock-confirm")} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={FIELD} />
          </label>
          <div className="flex items-center justify-end gap-2">
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

      {/* Only offered once there is a password to lock behind: an interval on
        * its own would have nothing to do. Sits above the wallpaper because it
        * governs when the lock screen appears, not what it looks like. */}
      {enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-0">
            <p className="text-xs font-medium">{t("lock.autoLock")}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t("lock.autoLockSub")}</p>
          </div>
          <select
            value={autoLockMinutes}
            onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
            className="h-8 shrink-0 rounded-lg border border-input bg-background px-2 text-xs outline-hidden focus:ring-2 focus:ring-primary/30"
          >
            {AUTO_LOCK_CHOICES.map((value) => (
              <option key={value} value={value}>
                {value === 0
                  ? t("lock.autoLockNever")
                  : value === 60
                  ? t("lock.autoLockAfterHour")
                  : t("lock.autoLockAfter", { minutes: value })}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Its own picture and sliders — same component the app background uses,
        * so the two look and behave alike without sharing a setting. */}
      <LockScreenWallpaperSetting />

      <TurnOffLockModal
        open={turnOffOpen}
        onClose={() => setTurnOffOpen(false)}
        onDisabled={() => void refresh()}
      />
    </div>
  );
}

/** Confirm-and-disable modal: just the current password, nothing else. Kept
 *  separate from the change-password panel above so turning the lock off
 *  doesn't force you through New/Confirm fields you have no intention of
 *  filling in. */
function TurnOffLockModal({ open, onClose, onDisabled }: {
  open: boolean;
  onClose: () => void;
  onDisabled: () => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => { setPassword(""); onClose(); };

  const confirm = async () => {
    if (!password) {
      toast.error(t("lock.needCurrent"));
      return;
    }
    setBusy(true);
    try {
      await disableAppLock(password);
      toast.success(t("lock.disabled"));
      setPassword("");
      onClose();
      onDisabled();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="max-w-sm">
      <div className="space-y-4 p-5">
        <DialogTitle className="text-sm font-semibold">{t("lock.turnOffTitle")}</DialogTitle>
        <p className="text-xs text-muted-foreground">{t("lock.turnOffHint")}</p>
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">{t("lock.currentPassword")}</span>
          <input
            {...maskedPasswordProps("app-lock-turnoff")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
            className={FIELD}
            autoFocus
          />
        </label>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={close}
            className="h-8 rounded-lg px-3 text-xs"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !password}
            onClick={() => void confirm()}
            className="h-8 rounded-lg bg-destructive px-4 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {busy ? t("lock.saving") : t("lock.turnOff")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Split out (rather than inlined like the old direct `WallpaperSetting` call)
 *  because framing needs its own pending/adjusting state — same shape as
 *  `DashboardBannerSetting` in GeneralSection.tsx: a freshly picked image is
 *  held here until the user confirms its crop, so replacing the wallpaper
 *  never takes effect with the old (or default) framing still applied. */
function LockScreenWallpaperSetting() {
  const t = useT();
  const image = useSettingsStore((s) => s.lockScreenImage);
  const position = useSettingsStore((s) => s.lockScreenImagePosition);
  const setImage = useSettingsStore((s) => s.setLockScreenImage);
  const [pending, setPending] = useState<string | null>(null);
  const [framing, setFraming] = useState(false);

  const editing = pending ?? image;

  return (
    <div className="border-t border-border pt-1">
      <WallpaperSetting
        label={t("lock.wallpaper")}
        sub={t("lock.wallpaperSub")}
        emptyLabel={t("settings.appBackgroundNone")}
        maxDimension={APP_BG_MAX_DIMENSION}
        maxBytes={MAX_APP_BG_UPLOAD_BYTES}
        processFile={fileToDownscaledDataUrl}
        image={image}
        setImage={setImage}
        objectPosition={`${position.x}% ${position.y}%`}
        imageScale={position.scale}
        onPicked={(dataUrl) => { setPending(dataUrl); setFraming(true); }}
        onAdjust={() => { setPending(null); setFraming(true); }}
        blur={useSettingsStore((s) => s.lockScreenBlur)}
        setBlur={useSettingsStore((s) => s.setLockScreenBlur)}
        dimming={useSettingsStore((s) => s.lockScreenDimming)}
        setDimming={useSettingsStore((s) => s.setLockScreenDimming)}
        visible={useSettingsStore((s) => s.lockScreenVisible)}
        setVisible={useSettingsStore((s) => s.setLockScreenVisible)}
      />
      <BannerPositionModal
        open={framing}
        src={editing}
        initial={pending ? DEFAULT_BANNER_POSITION : position}
        frameAspect={16 / 9}
        allowZoom
        onCancel={() => setFraming(false)}
        onConfirm={(pos) => { setImage(editing, pos); setFraming(false); }}
      />
    </div>
  );
}
