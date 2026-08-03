import { useState } from "react";
import { Lock } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { useAppLockStore } from "@/store/appLockStore";
import { useSettingsStore } from "@/store/settingsStore";
import { WindowControls } from "@/components/Layout/WindowControls";
import { isDesktopHost } from "@/platform";

/** Full-screen password gate. Rendered instead of the app — not on top of it —
 *  so nothing behind it is ever painted, and no page keeps polling while
 *  locked. */
export function LockScreen() {
  const t = useT();
  const verify = useAppLockStore((s) => s.verify);
  const setLocked = useAppLockStore((s) => s.setLocked);
  // Its own wallpaper, separate from the app canvas — same controls, set up
  // under App lock in Settings.
  const wallpaper = useSettingsStore((s) => s.lockScreenImage);
  const visible = useSettingsStore((s) => s.lockScreenVisible);
  const blur = useSettingsStore((s) => s.lockScreenBlur);
  const showWallpaper = Boolean(wallpaper) && visible;
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // Held on screen while the exit animation runs. Unmounting on the spot would
  // cut it off — the app would just pop in.
  const [leaving, setLeaving] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(false);
    try {
      if (await verify(password)) {
        setLeaving(true);
        return;
      }
      setError(true);
      setPassword("");
      // Restart the shake: removing and re-adding the class in one frame is a
      // no-op, so let the browser see it gone first.
      setShake(false);
      requestAnimationFrame(() => setShake(true));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onAnimationEnd={() => { if (leaving) setLocked(false); }}
      className={`app-drag-region fixed inset-0 z-200 flex items-center justify-center overflow-hidden bg-background ${
        leaving ? "animate-out fade-out duration-300" : "animate-in fade-in duration-300"
      }`}
    >
      {showWallpaper && (
        <img
          src={wallpaper}
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full object-cover ${leaving ? "" : "animate-in fade-in zoom-in-105 duration-700"}`}
          // Scaled up so a blurred edge never reveals empty space.
          style={{
            filter: `blur(${blur}px)`,
            transform: blur > 0 ? "scale(1.08)" : undefined,
          }}
        />
      )}
      {/* Always darkened, wallpaper or not: the card has to stay readable over
        * whatever photo the user picked. */}
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />

      {/* The lock screen replaces the whole shell, CommandBar included, so it
        * has to carry these itself — otherwise a locked window cannot be
        * minimised, resized or closed. */}
      {isDesktopHost && (
        <div className="app-region-no-drag absolute right-3 top-3 z-10 flex items-center">
          <WindowControls />
        </div>
      )}

      <form
        onSubmit={submit}
        onAnimationEnd={(event) => event.stopPropagation()}
        className={`app-region-no-drag relative w-[min(92vw,22rem)] rounded-2xl border border-white/15 bg-background/85 p-6 shadow-2xl backdrop-blur-xl ${
          leaving
            ? "animate-out fade-out zoom-out-95 duration-200"
            : shake
            ? "animate-shake"
            : "animate-in fade-in slide-in-from-bottom-4 duration-500"
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-sm font-semibold">{t("lock.title")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t("lock.subtitle")}</p>
        </div>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => { setPassword(event.target.value); setError(false); }}
          placeholder={t("lock.placeholder")}
          className={`mt-5 h-10 w-full rounded-xl border bg-background px-3 text-sm outline-hidden focus:ring-2 ${
            error ? "border-destructive focus:ring-destructive/30" : "border-input focus:ring-primary/30"
          }`}
        />
        {error && <p className="mt-1.5 text-xs text-destructive">{t("lock.wrong")}</p>}

        <Button
          type="submit"
          disabled={!password || busy}
          className="mt-3 h-10 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? t("lock.checking") : t("lock.unlock")}
        </Button>
      </form>
    </div>
  );
}
