import { useState } from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { useAppLockStore } from "@/store/appLockStore";
import { useSettingsStore } from "@/store/settingsStore";
import { WindowControls } from "@/components/Layout/WindowControls";
import { isDesktopHost } from "@/platform";
import { maskedPasswordProps } from "@/lib/maskedInput";
import { SpecimenBackdrop, UnderlineField, WordmarkEntry } from "./authVisuals";

/** Full-screen password gate. Rendered instead of the app — not on top of it —
 *  so nothing behind it is ever painted, and no page keeps polling while
 *  locked.
 *
 *  Same dictionary-entry language as the web sign-in screen (see
 *  authVisuals), so locking and signing in are recognisably the same door.
 *  The specimen backdrop only shows when there is no wallpaper: over a photo
 *  it would be noise, and the photo is already doing that job. */
export function LockScreen({ pending = false }: { pending?: boolean }) {
  const t = useT();
  const verify = useAppLockStore((s) => s.verify);
  const setLocked = useAppLockStore((s) => s.setLocked);
  // Its own wallpaper, separate from the app canvas — same controls, set up
  // under App lock in Settings.
  const wallpaper = useSettingsStore((s) => s.lockScreenImage);
  const visible = useSettingsStore((s) => s.lockScreenVisible);
  const blur = useSettingsStore((s) => s.lockScreenBlur);
  const dimming = useSettingsStore((s) => s.lockScreenDimming);
  const position = useSettingsStore((s) => s.lockScreenImagePosition);
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
      className={`app-drag-region fixed inset-0 z-200 overflow-hidden bg-background ${
        leaving ? "animate-out fade-out duration-300" : "animate-in fade-in duration-300"
      }`}
    >
      {showWallpaper ? (
        <>
          {/* Entrance animation (its own transform, via Tailwind's animate-in/
            * zoom-in-105 utility classes) lives on this outer wrapper; the crop's
            * zoom (position.scale) on the one inside that; the blur-overscan
            * transform stays on the img itself. Three separate elements because
            * each needs its own transform-origin/timing and an inline
            * `style.transform` would otherwise clobber the class-driven one. */}
          <div className={`absolute inset-0 ${leaving ? "" : "animate-in fade-in zoom-in-105 duration-700"}`}>
            <div
              className="h-full w-full"
              style={position.scale && position.scale !== 1
                ? { transform: `scale(${position.scale})`, transformOrigin: `${position.x}% ${position.y}%` }
                : undefined}
            >
              <img
                src={wallpaper}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
                // Scaled up so a blurred edge never reveals empty space.
                style={{
                  filter: `blur(${blur}px)`,
                  transform: blur > 0 ? "scale(1.08)" : undefined,
                  objectPosition: `${position.x}% ${position.y}%`,
                }}
              />
            </div>
          </div>
          {/* Off by default — the photo shows exactly as picked, no forced
            * darkening. Same opt-in pattern as `appBackgroundDimming`: only
            * dims when the user sets it in Settings, for whichever photo
            * turns out to need the legibility help. */}
          {dimming > 0 && (
            <div className="absolute inset-0" style={{ backgroundColor: `rgb(0 0 0 / ${dimming}%)` }} />
          )}
        </>
      ) : (
        <SpecimenBackdrop />
      )}

      {/* The lock screen replaces the whole shell, CommandBar included, so it
        * has to carry these itself — otherwise a locked window cannot be
        * minimised, resized or closed. */}
      {isDesktopHost && (
        <div className="app-region-no-drag absolute right-3 top-3 z-10 flex items-center">
          <WindowControls />
        </div>
      )}

      <div className="relative mx-auto grid h-full w-full max-w-5xl items-center gap-8 px-6 py-12 sm:px-10 lg:grid-cols-[1fr_minmax(0,21rem)] lg:gap-20">
        <header
          className={`animate-in fade-in slide-in-from-bottom-3 duration-700 motion-reduce:animate-none ${
            showWallpaper ? "[&_h1]:text-white [&_p]:text-white/85" : ""
          }`}
        >
          <WordmarkEntry gloss={t("lock.gloss")} compact />
        </header>

        <form
          onSubmit={submit}
          onAnimationEnd={(event) => event.stopPropagation()}
          className={`app-region-no-drag w-full ${
            leaving
              ? "animate-out fade-out zoom-out-95 duration-200"
              : shake
              ? "animate-shake"
              : "animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:120ms] [animation-fill-mode:backwards] motion-reduce:animate-none"
          }`}
        >
          <div className="rounded-2xl border border-border/70 bg-card/70 p-6 shadow-[0_24px_60px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-8">
            <p className="font-serif text-lg font-semibold text-foreground">{t("lock.title")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("lock.subtitle")}</p>

            <div className="mt-6">
              <UnderlineField
                label={t("lock.placeholder")}
                type="password"
                autoComplete="off"
                key={pending ? "pending" : "ready"}
                // Mobile browsers can resize/scroll the visual viewport when an
                // autofocus lands while the startup cover is fading. That looks
                // like a screen flash even though the two canvases cross-fade.
                // Desktop keeps the keyboard-first unlock flow.
                autoFocus={!pending && isDesktopHost}
                value={password}
                onChange={(value) => { setPassword(value); setError(false); }}
                invalid={error}
                // The screen lock is not the account credential, and on web
                // both live on one origin: as a password field this one makes
                // the browser offer to overwrite the saved sign-in password
                // with the lock PIN on every unlock.
                inputProps={maskedPasswordProps("app-lock")}
              />
            </div>

            {error && (
              <p role="alert" className="mt-4 border-l-2 border-destructive pl-3 text-xs text-destructive">
                {t("lock.wrong")}
              </p>
            )}

            <Button
              type="submit"
              disabled={!password || busy}
              className="mt-6 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {busy ? t("lock.checking") : t("lock.unlock")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
