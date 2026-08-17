import React from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { useLayoutStore } from "@/store/layoutStore";

/** Sits behind the entire app (mounted once in App.tsx, z-index below everything
 *  else) when the user's set a custom background image in Settings. The page
 *  canvas (MainLayout's root bg-background) turns transparent to reveal it —
 *  cards/sidebar stay opaque, see Sidebar.tsx. An optional user-controlled
 *  dimming layer can improve legibility without silently changing the image. */
export function AppBackground({ disableBlur = false }: { disableBlur?: boolean }) {
  const image = useSettingsStore((s) => s.appBackgroundImage);
  const blur = useSettingsStore((s) => s.appBackgroundBlur);
  const visible = useSettingsStore((s) => s.appBackgroundVisible);
  const position = useSettingsStore((s) => s.appBackgroundImagePosition);
  const dimming = useSettingsStore((s) => s.appBackgroundDimming);
  const zenMode = useLayoutStore((s) => s.zenMode);

  const active = Boolean(image) && visible;
  const effectiveBlur = disableBlur ? 0 : blur;

  // The image sits at z-index -10, behind the app's page canvas, and can only
  // show through if that canvas — the <body> background — is transparent.
  // base.css (index.html now paints an explicit opaque <html> background, which
  // stops <body>'s background from propagating to the canvas, so a plain
  // `bg-background` body would otherwise still cover the image). Toggled off
  // documentElement so default pages keep the solid theme canvas untouched.
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("has-app-background", active);
    return () => root.classList.remove("has-app-background");
  }, [active]);

  if (!active) return null;

  // In zen mode the wallpaper is raised above the whole app shell so it both
  // shows through the (now transparent) zen overlay AND visually covers the
  // sidebar/topbar/dock behind it — hiding the navigation exactly as zen mode
  // intends. z-[45] sits above the chrome (top z-40) but below the zen overlay
  // (z-50) so the reader/editor content stays legible on top.
  const zClass = zenMode ? "z-[45]" : "-z-10";

  return (
    <div className={`fixed inset-0 ${zClass} overflow-hidden bg-background`}>
      {/* The crop's zoom (position.scale) lives on this wrapper, anchored at the
        * same x%,y% the pan uses — kept separate from the blur-overscan transform
        * on the img itself below, since the two need different transform-origins
        * (this one at the user's chosen focus point, that one at dead centre) and
        * CSS only has one `transform-origin` per element. */}
      <div
        className="h-full w-full"
        style={position.scale && position.scale !== 1
          ? { transform: `scale(${position.scale})`, transformOrigin: `${position.x}% ${position.y}%` }
          : undefined}
      >
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover"
          // Scaled up so a blurred edge never reveals empty space at the image boundary.
          // Terminal can opt out because a backdrop that has already been blurred
          // here cannot be made sharp again by its transparent foreground shell.
          style={{
            filter: effectiveBlur > 0 ? `blur(${effectiveBlur}px)` : "none",
            transform: effectiveBlur > 0 ? "scale(1.08)" : undefined,
            objectPosition: `${position.x}% ${position.y}%`,
          }}
        />
      </div>
      {dimming > 0 && (
        <div
          data-testid="app-background-dimming"
          className="absolute inset-0"
          style={{ backgroundColor: `rgb(0 0 0 / ${dimming}%)` }}
        />
      )}
    </div>
  );
}
