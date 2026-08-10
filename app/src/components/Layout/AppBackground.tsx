import React from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { useLayoutStore } from "@/store/layoutStore";

/** Sits behind the entire app (mounted once in App.tsx, z-index below everything
 *  else) when the user's set a custom background image in Settings. The page
 *  canvas (MainLayout's root bg-background) turns transparent to reveal it —
 *  cards/sidebar stay opaque, see Sidebar.tsx. A fixed dark scrim keeps text
 *  legible regardless of how busy the source image or how little blur is applied. */
export function AppBackground() {
  const image = useSettingsStore((s) => s.appBackgroundImage);
  const blur = useSettingsStore((s) => s.appBackgroundBlur);
  const visible = useSettingsStore((s) => s.appBackgroundVisible);
  const zenMode = useLayoutStore((s) => s.zenMode);

  const active = Boolean(image) && visible;

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
      <img
        src={image}
        alt=""
        aria-hidden="true"
        className="w-full h-full object-cover"
        // Scaled up so a blurred edge never reveals empty space at the image boundary.
        style={{
          filter: `blur(${blur}px)`,
          transform: blur > 0 ? "scale(1.08)" : undefined,
        }}
      />
      <div className="absolute inset-0 bg-black/20 dark:bg-black/45" />
    </div>
  );
}
